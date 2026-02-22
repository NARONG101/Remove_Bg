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

def refine_mask(pil_image, min_area=100, edge_cleaning_intensity=1.0):
    """
    Advanced refinement using Bilateral Filtering, Edge Decontamination, 
    and precise morphological operations to fix haloing and color bleeding.
    """
    # Convert PIL to OpenCV (RGBA)
    cv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGBA2BGRA)
    
    # Extract channels
    b, g, r, alpha = cv2.split(cv_image)
    
    # 1. Edge Decontamination (Remove color bleeding from original background)
    # Find the transition area (edges)
    edge_mask = cv2.threshold(alpha, 0, 255, cv2.THRESH_BINARY)[1]
    # Dilate edges slightly to find "bleeding" areas
    kernel_edge = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    alpha_eroded = cv2.erode(alpha, kernel_edge, iterations=1)
    
    # Create a mask of semi-transparent pixels
    semi_transparent = cv2.bitwise_and(cv2.threshold(alpha, 1, 255, cv2.THRESH_BINARY)[1], 
                                     cv2.threshold(alpha, 250, 255, cv2.THRESH_BINARY_INV)[1])
    
    if np.any(semi_transparent):
        # Use Inpainting or simple color expansion to fix edge colors
        # For simplicity and speed, we'll use a slightly eroded version of the image 
        # to fill color into the semi-transparent edges
        mask_for_fix = cv2.threshold(alpha, 200, 255, cv2.THRESH_BINARY)[1]
        
        # Simple decontamination: replace edge colors with interior colors
        # We'll use a median blur on the color channels only where alpha is low
        # but only in the transition regions
        temp_img = cv_image[:, :, :3].copy()
        decontaminated = cv2.medianBlur(temp_img, 5)
        
        # Blend original and decontaminated based on alpha
        # Lower alpha = more decontamination
        for i in range(3):
            cv_image[:, :, i] = np.where(alpha < 200, decontaminated[:, :, i], cv_image[:, :, i])

    # 2. Alpha Channel Refinement
    # Bilateral Filter on alpha to smooth noise while keeping edges sharp
    alpha_smooth = cv2.bilateralFilter(alpha, 9, 75, 75)
    
    # 3. Morphological Operations to clean up
    # Slightly erode to remove the outermost halo pixels if intensity is high
    if edge_cleaning_intensity > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        # Use a soft erosion (weighted blend) to avoid harsh jagged edges
        eroded = cv2.erode(alpha_smooth, kernel, iterations=1)
        
        # Ensure intensity is within safe bounds [0, 3.33] to keep weights positive
        safe_intensity = max(0.0, min(edge_cleaning_intensity, 3.0))
        weight_eroded = 0.3 * safe_intensity
        weight_orig = 1.0 - weight_eroded
        
        alpha_smooth = cv2.addWeighted(alpha_smooth, weight_orig, 
                                      eroded, weight_eroded, 0)
    
    # 4. Remove small background "points" (noise)
    _, binary = cv2.threshold(alpha_smooth, 10, 255, cv2.THRESH_BINARY)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    new_mask = np.zeros_like(alpha_smooth)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            new_mask[labels == i] = 255
            
    # 5. Final Edge Softening & Cleanup
    # Combine original smooth alpha with cleaned mask
    final_alpha = cv2.bitwise_and(alpha_smooth, new_mask)
    
    # Apply a final slight blur to edges only
    final_alpha = cv2.GaussianBlur(final_alpha, (3, 3), 0)
    
    # Update alpha channel
    cv_image[:, :, 3] = final_alpha
    
    # Convert back to PIL
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
    # Auto-select best model if not provided
    model_name = request.form.get('model', 'isnet-general-use')
    if model_name == 'undefined' or not model_name:
        model_name = 'isnet-general-use'
        
    super_precision = request.form.get('super_precision') == 'true'
    enhance_bg = request.form.get('enhance_bg') == 'true'
    edge_cleaning = float(request.form.get('edge_cleaning', 1.0))
    alpha_matting = request.form.get('alpha_matting') == 'true'
    af_threshold = int(request.form.get('alpha_matting_foreground_threshold', 240))
    ab_threshold = int(request.form.get('alpha_matting_background_threshold', 10))
    ae_size = int(request.form.get('alpha_matting_erode_size', 10))
    
    quality = int(request.form.get('quality', 95))
    output_format = request.form.get('format', 'png').lower()
    
    # Auto-detect format from first file if format is not explicitly set or is 'auto'
    if (output_format == 'undefined' or output_format == 'png') and len(files) > 0:
        # Default to PNG for transparency, but we can check the input file
        pass 

    max_size = int(request.form.get('max_size', 0))
    background_type = request.form.get('background_type', 'transparent')
    bg_color = request.form.get('bg_color', '#ffffff')
    bg_image_file = request.files.get('bg_image')

    processed_files = []

    try:
        session = get_session(model_name)
    except Exception as e:
        logger.error(f'Error creating session for model {model_name}: {str(e)}')
        session = None # Fallback to default in remove()

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
            
            # Use specified model and alpha matting settings
            output_image = remove(
                input_image, 
                session=session,
                alpha_matting=alpha_matting,
                alpha_matting_foreground_threshold=af_threshold,
                alpha_matting_background_threshold=ab_threshold,
                alpha_matting_erode_size=ae_size
            )

            # Convert to PIL Image
            pil_image = Image.open(io.BytesIO(output_image))

            # Apply Super Precision Refinement if requested
            if super_precision:
                pil_image = refine_mask(pil_image, edge_cleaning_intensity=edge_cleaning)

            # Resize if max_size is specified
            if max_size > 0 and max_size < max(pil_image.size):
                pil_image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            # Apply Background Enhancement if requested
            # This must happen after resizing to maintain consistency
            if enhance_bg:
                # We need the original image at the same size as pil_image
                orig_pil = Image.open(io.BytesIO(input_image))
                orig_pil = orig_pil.resize(pil_image.size, Image.Resampling.LANCZOS)
                # Enhance background using the mask from rembg
                pil_image = enhance_background_logic(orig_pil, pil_image)

            # For single file, handle return
            if len(files) == 1:
                # If we enhanced the background, we return the full image (RGB/RGBA)
                # If not, we return transparent PNG for client-side processing
                if not enhance_bg:
                    if pil_image.mode != 'RGBA':
                        pil_image = pil_image.convert('RGBA')
                
                output_buffer = io.BytesIO()
                # Determine format
                save_format = 'PNG'
                if output_format == 'jpg': save_format = 'JPEG'
                elif output_format == 'webp': save_format = 'WebP'
                
                pil_image.save(output_buffer, format=save_format, quality=quality, optimize=True)
                output_buffer.seek(0)
                
                return send_file(
                    output_buffer,
                    mimetype=f'image/{output_format}',
                    as_attachment=False,
                    download_name=os.path.splitext(file.filename)[0] + f'_enhanced.{output_format}'
                )
            else:
                # Multiple files - apply background server-side
                format_type = get_format_from_filename(file.filename)

                # Apply background replacement
                if background_type == 'color':
                    color = tuple(int(bg_color[i:i+2], 16) for i in (1, 3, 5))
                    if pil_image.mode == 'RGBA':
                        background = Image.new('RGBA' if format_type == 'png' else 'RGB', pil_image.size, color)
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
                    os.path.splitext(file.filename)[0] + f'_removed.{format_type}',
                    output_buffer.getvalue()
                ))

        except Exception as e:
            logger.error(f'Error processing file {file.filename}: {str(e)}')
            continue

    if not processed_files:
        return jsonify({'error': 'No files could be processed'}), 500

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
    app.run(debug=True, port=5000)