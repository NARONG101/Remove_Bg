from flask import Flask, request, send_file, render_template, jsonify
from flask_cors import CORS
from rembg import remove, new_session
from PIL import Image
import io
import zipfile
import os
import logging
import cv2
import numpy as np

app = Flask(__name__)
CORS(app) # Enable CORS for all routes
app.secret_key = 'your-secret-key-here'  # Add a secret key for security

# Cache for rembg sessions
sessions = {}

def get_session(model_name):
    if model_name not in sessions:
        sessions[model_name] = new_session(model_name)
    return sessions[model_name]

def detect_background_color(pil_image):
    """
    Detect the dominant background color from the original image
    by analyzing the corners and edges of the image.
    """
    # Convert PIL to OpenCV (RGB)
    cv_image = cv2.cvtColor(np.array(pil_image.convert('RGB')), cv2.COLOR_RGB2BGR)
    height, width = cv_image.shape[:2]
    
    # Define regions to sample (corners and edges)
    regions = []
    # Top-left corner
    regions.append(cv_image[0:height//4, 0:width//4])
    # Top-right corner
    regions.append(cv_image[0:height//4, width*3//4:width])
    # Bottom-left corner
    regions.append(cv_image[height*3//4:height, 0:width//4])
    # Bottom-right corner
    regions.append(cv_image[height*3//4:height, width*3//4:width])
    # Top edge
    regions.append(cv_image[0:height//10, 0:width])
    # Bottom edge
    regions.append(cv_image[height*9//10:height, 0:width])
    # Left edge
    regions.append(cv_image[0:height, 0:width//10])
    # Right edge
    regions.append(cv_image[0:height, width*9//10:width])
    
    # Combine all regions
    sampled_pixels = np.vstack([region.reshape(-1, 3) for region in regions])
    
    # Try simple methods first (median and mean) since they're fast
    try:
        # Try median first - robust to outliers
        dominant_color_bgr = np.median(sampled_pixels, axis=0)
    except Exception:
        # Fallback to mean
        dominant_color_bgr = np.mean(sampled_pixels, axis=0)
    
    # Convert BGR to RGB then to hex
    dominant_color_rgb = dominant_color_bgr.astype(int)[::-1]
    hex_color = '#{:02x}{:02x}{:02x}'.format(
        max(0, min(255, dominant_color_rgb[0])),
        max(0, min(255, dominant_color_rgb[1])),
        max(0, min(255, dominant_color_rgb[2]))
    )
    
    return hex_color

def refine_mask(pil_image, min_area=50, edge_cleaning_intensity=1.0):
    """
    Minimal refinement - just clean up tiny noise, preserve original mask quality!
    """
    # Convert PIL to OpenCV (RGBA)
    cv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGBA2BGRA)
    
    # Extract channels
    b, g, r, alpha = cv2.split(cv_image)
    
    # Keep original alpha channel - only remove very small specks
    _, binary = cv2.threshold(alpha, 1, 255, cv2.THRESH_BINARY)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    new_mask = np.zeros_like(alpha)
    
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= 10:  # Keep everything except tiny specks
            new_mask[labels == i] = 255
    
    final_alpha = cv2.bitwise_and(alpha, new_mask)
    
    # That's it! No extra processing - keep the original model's sharp output
    cv_image[:, :, 3] = final_alpha
    return Image.fromarray(cv2.cvtColor(cv_image, cv2.COLOR_BGRA2RGBA))

def enhance_background_logic(original_pil, mask_pil):
    """
    Enhances the background of an image while keeping the subject intact.
    Focuses on dramatic lighting, contrast, and depth.
    """
    # Convert to OpenCV
    original_cv = cv2.cvtColor(np.array(original_pil.convert('RGB')), cv2.COLOR_RGB2BGR)
    
    # Get mask from alpha channel of mask_pil (which is the rembg output)
    mask_rgba = np.array(mask_pil.convert('RGBA'))
    mask_cv = mask_rgba[:, :, 3] # Use alpha channel as mask
    
    # 1. Separate Subject and Background
    # subject = cv2.bitwise_and(original_cv, original_cv, mask=mask_cv)
    background = cv2.bitwise_and(original_cv, original_cv, mask=cv2.bitwise_not(mask_cv))
    
    # 2. Enhance Background
    # A. Increase Contrast and adjust lighting
    # Use CLAHE for better local contrast enhancement without over-blowing highlights
    lab = cv2.cvtColor(background, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    l_enhanced = cv2.merge((cl, a, b))
    background_enhanced = cv2.cvtColor(l_enhanced, cv2.COLOR_LAB2BGR)
    
    # B. Apply Sigmoid Curve for dramatic effect (crushing blacks slightly)
    # This makes the background "pop"
    lookUpTable = np.empty((1, 256), np.uint8)
    for i in range(256):
        # Sigmoid-like curve
        lookUpTable[0, i] = np.clip(255 / (1 + np.exp(-0.05 * (i - 128))), 0, 255)
    background_enhanced = cv2.LUT(background_enhanced, lookUpTable)
    
    # C. Add Depth via Subtle Vignette
    rows, cols = background_enhanced.shape[:2]
    # Create a Gaussian kernel for vignette
    kernel_x = cv2.getGaussianKernel(cols, cols/2)
    kernel_y = cv2.getGaussianKernel(rows, rows/2)
    kernel = kernel_y * kernel_x.T
    mask = kernel / kernel.max()
    
    # Apply vignette (darken the edges)
    vignette = np.copy(background_enhanced)
    for i in range(3):
        vignette[:, :, i] = vignette[:, :, i] * mask
    
    # Blend vignette with original enhanced background (subtle effect)
    background_enhanced = cv2.addWeighted(background_enhanced, 0.7, vignette, 0.3, 0)
    
    # 3. Re-composite
    # The subject should remain exactly as it was
    subject_part = cv2.bitwise_and(original_cv, original_cv, mask=mask_cv)
    final_cv = cv2.add(subject_part, cv2.bitwise_and(background_enhanced, background_enhanced, mask=cv2.bitwise_not(mask_cv)))
    
    # Convert back to PIL
    return Image.fromarray(cv2.cvtColor(final_cv, cv2.COLOR_BGR2RGB))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB limit
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_format_from_filename(filename):
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else 'png'
    if ext == 'jpeg':
        return 'jpg'
    return ext if ext in ['png', 'jpg', 'webp'] else 'png'

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    if 'files' not in request.files:
        return jsonify({'error': 'No files uploaded'}), 400

    files = request.files.getlist('files')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'No files selected'}), 400

    # Get processing options
    model_name = request.form.get('model', 'u2net_human_seg')
    if model_name == 'undefined' or not model_name:
        model_name = 'u2net_human_seg'
        
    super_precision = request.form.get('super_precision') == 'true'
    enhance_bg = request.form.get('enhance_bg') == 'true'
    edge_cleaning = float(request.form.get('edge_cleaning', 1.0))
    alpha_matting = request.form.get('alpha_matting') == 'true'
    af_threshold = int(request.form.get('alpha_matting_foreground_threshold', 240))
    ab_threshold = int(request.form.get('alpha_matting_background_threshold', 10))
    ae_size = int(request.form.get('alpha_matting_erode_size', 10))
    
    quality = int(request.form.get('quality', 100))
    output_format = request.form.get('format', 'png').lower()

    max_size = int(request.form.get('max_size', 0))
    background_type = request.form.get('background_type', 'transparent')
    bg_color = request.form.get('bg_color', '#ffffff')
    bg_image_file = request.files.get('bg_image')

    processed_files = []

    try:
        session = get_session(model_name)
    except Exception as e:
        logger.error(f'Error creating session for model {model_name}: {str(e)}')
        session = None

    for file in files:
        if file.filename == '' or not allowed_file(file.filename):
            continue

        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        if file_size > MAX_FILE_SIZE:
            return jsonify({'error': f'File {file.filename} is too large. Maximum size is 10MB.'}), 400

        try:
            input_image = file.read()
            
            # FIRST: Get the ORIGINAL input size and keep track of it to enforce at end!
            orig_input_pil = Image.open(io.BytesIO(input_image))
            orig_w, orig_h = orig_input_pil.size
            orig_size = (orig_w, orig_h)
            
            # Use human-specific model with optimized alpha matting
            output_image = remove(
                input_image, 
                session=session,
                alpha_matting=True,
                alpha_matting_foreground_threshold=254,  # Very strict on foreground
                alpha_matting_background_threshold=1,     # Very strict on background
                alpha_matting_erode_size=5                # Less erosion
            )

            # Convert to PIL Image
            pil_image = Image.open(io.BytesIO(output_image))

            # Always apply refinement to remove halos/shadows
            pil_image = refine_mask(pil_image, edge_cleaning_intensity=1.0)

            # Apply additional Super Precision Refinement if requested
            if super_precision:
                pil_image = refine_mask(pil_image, edge_cleaning_intensity=edge_cleaning)

            # ONLY resize if user explicitly selected a max size (1920/1280/800),
            # keep original size otherwise!
            target_size = orig_size
            if max_size > 0 and max_size < max(target_size):
                # Use LANCZOS for high quality downscaling
                temp_img = orig_input_pil.copy()
                temp_img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                target_size = temp_img.size

            # Make sure the processed image has EXACTLY the correct target size!
            if pil_image.size != target_size:
                pil_image = pil_image.resize(target_size, Image.Resampling.LANCZOS)

            # Apply Background Enhancement if requested
            if enhance_bg:
                orig_pil = orig_input_pil.resize(target_size, Image.Resampling.LANCZOS)
                pil_image = enhance_background_logic(orig_pil, pil_image)

            # For single file, handle return
            if len(files) == 1:
                if not enhance_bg:
                    if pil_image.mode != 'RGBA':
                        pil_image = pil_image.convert('RGBA')
                
                output_buffer = io.BytesIO()
                save_format = 'PNG'
                if output_format == 'jpg': save_format = 'JPEG'
                elif output_format == 'webp': save_format = 'WebP'
                
                pil_image.save(output_buffer, format=save_format, quality=quality, optimize=True)
                output_buffer.seek(0)
                
                return send_file(
                    output_buffer,
                    mimetype=f'image/{output_format}',
                    as_attachment=False,
                    download_name=os.path.splitext(file.filename)[0] + f'_bg_removed.{output_format}'
                )
            else:
                # Multiple files - apply background server-side
                format_type = get_format_from_filename(file.filename)

                # Apply background replacement
                if background_type == 'color' or background_type == 'white':
                    color = '#ffffff' if background_type == 'white' else bg_color
                    color_tuple = tuple(int(color[i:i+2], 16) for i in (1, 3, 5))
                    if pil_image.mode == 'RGBA':
                        background = Image.new('RGBA' if format_type == 'png' else 'RGB', pil_image.size, color_tuple)
                        background.paste(pil_image, mask=pil_image.split()[-1])
                        pil_image = background
                    if format_type in ['jpg', 'jpeg']:
                        pil_image = pil_image.convert('RGB')
                elif background_type == 'image' and bg_image_file:
                    bg_image_data = bg_image_file.read()
                    bg_pil = Image.open(io.BytesIO(bg_image_data)).convert('RGBA')
                    bg_pil = bg_pil.resize(pil_image.size, Image.Resampling.LANCZOS)
                    bg_pil.paste(pil_image, mask=pil_image.split()[-1])
                    pil_image = bg_pil
                    if format_type in ['jpg', 'jpeg']:
                        pil_image = pil_image.convert('RGB')

                output_buffer = io.BytesIO()
                save_format = 'PNG'
                if format_type == 'jpg': save_format = 'JPEG'
                elif format_type == 'webp': save_format = 'WebP'
                
                pil_image.save(output_buffer, format=save_format, quality=quality)
                output_buffer.seek(0)
                processed_files.append((
                    os.path.splitext(file.filename)[0] + f'_bg_removed.{format_type}',
                    output_buffer.getvalue()
                ))

        except Exception as e:
            logger.error(f'Error processing file {file.filename}: {str(e)}', exc_info=True)
            continue

    if not processed_files:
        return jsonify({'error': 'No files could be processed. Please check your images and try again.'}), 500

    # Create ZIP for multiple files
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w') as zf:
        for filename, data in processed_files:
            zf.writestr(filename, data)
    memory_file.seek(0)

    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name='processed_images.zip'
    )

@app.route('/detect-background-color', methods=['POST'])
def detect_background_color_endpoint():
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Open the image
        pil_image = Image.open(io.BytesIO(file.read()))
        
        # Detect background color
        hex_color = detect_background_color(pil_image)
        
        return jsonify({'success': True, 'color': hex_color})
    except Exception as e:
        logger.error(f'Error detecting background color: {str(e)}', exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/refine', methods=['POST'])
def refine():
    try:
        data = request.json
        image_data = data.get('image')
        if not image_data:
            return jsonify({'error': 'No image data provided'}), 400

        # Process the base64 image data if needed on server
        # For now, the client handles the manual refinement canvas logic
        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f'Error in refine: {str(e)}')
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)