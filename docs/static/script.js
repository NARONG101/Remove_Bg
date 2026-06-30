// Backend URL - Set this to your hosted backend (e.g., Render, Vercel, etc.)
const BACKEND_URL = 'https://my-remove-bg.onrender.com'; // Change this to your hosted backend!

const themeToggle = document.getElementById('themeToggle');
const body = document.body;
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const primaryUploadBtn = document.getElementById('primaryUploadBtn');
const pasteBtn = document.getElementById('pasteBtn');
const fileCount = document.getElementById('fileCount');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('previewImg');
const submitBtn = document.getElementById('submitBtn');
const loading = document.getElementById('loading');
const result = document.getElementById('result');
const resultTitle = document.getElementById('resultTitle');
const resultImg = document.getElementById('resultImg');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');

// Click primary upload button to open file picker
if (primaryUploadBtn) {
    primaryUploadBtn.addEventListener('click', () => {
        fileInput.click();
    });
}

// Update Range Values
const rangeInputs = document.querySelectorAll('input[type="range"]');
rangeInputs.forEach(input => {
    input.addEventListener('input', (e) => {
        const valueSpan = e.target.nextElementSibling;
        if (valueSpan && valueSpan.classList.contains('range-value')) {
            valueSpan.textContent = e.target.value;
        }
    });
});
let processedBlob = null;
let selectedFiles = [];
let transparentBlob = null; // Store the transparent PNG
let currentFormat = 'png';
let currentQuality = 100;
let originalImageForRefine = null;
let processedImageForRefine = null;

// Refinement Editor Variables
const refineModal = document.getElementById('refineModal');
const refineBtn = document.getElementById('refineBtn');
const closeModal = document.querySelector('.close-modal');
const editorCanvas = document.getElementById('editorCanvas');
const ctx = editorCanvas.getContext('2d', { willReadFrequently: true });
const brushSizeInput = document.getElementById('brushSize');
const brushSizeVal = document.getElementById('brushSizeVal');
const brushHardnessInput = document.getElementById('brushHardness');
const brushHardnessVal = document.getElementById('brushHardnessVal');
const brushRestore = document.getElementById('brushRestore');
const brushRemove = document.getElementById('brushRemove');
const smartSelectionToggle = document.getElementById('smartSelection');
const wandControls = document.getElementById('wandControls');
const wandToleranceInput = document.getElementById('wandTolerance');
const toleranceVal = document.getElementById('toleranceVal');
const brushSizeControl = document.getElementById('brushSizeControl');
const selectionCanvas = document.getElementById('selectionCanvas');
const sctx = selectionCanvas.getContext('2d');
const undoRefine = document.getElementById('undoRefine');
const saveRefine = document.getElementById('saveRefine');
const brushCursor = document.getElementById('brushCursor');

let isDrawing = false;
let currentTool = 'restore';
let selectionMask = null;
let history = [];
const maxHistory = 15;

// Open Refine Modal
refineBtn.addEventListener('click', () => {
    if (!processedBlob) return;
    
    const originalUrl = URL.createObjectURL(selectedFiles[0]);
    const processedUrl = URL.createObjectURL(processedBlob);
    
    originalImageForRefine = new Image();
    processedImageForRefine = new Image();
    
    let loadedCount = 0;
    const onImageLoad = () => {
        loadedCount++;
        if (loadedCount === 2) {
            setupEditor();
            refineModal.style.display = 'block';
        }
    };
    
    originalImageForRefine.onload = onImageLoad;
    processedImageForRefine.onload = onImageLoad;
    
    originalImageForRefine.src = originalUrl;
    processedImageForRefine.src = processedUrl;
});

closeModal.addEventListener('click', () => {
    refineModal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === refineModal) {
        refineModal.style.display = 'none';
    }
});

// Tool Selection
brushRestore.addEventListener('click', () => {
    currentTool = 'restore';
    brushRestore.classList.add('active');
    brushRemove.classList.remove('active');
    updateToolControls();
});

brushRemove.addEventListener('click', () => {
    currentTool = 'remove';
    brushRemove.classList.add('active');
    brushRestore.classList.remove('active');
    updateToolControls();
});

smartSelectionToggle.addEventListener('change', updateToolControls);

function updateToolControls() {
    const isSmart = smartSelectionToggle.checked;
    wandControls.style.display = isSmart ? 'flex' : 'none';
    
    if (isSmart) {
        brushCursor.style.display = 'none';
    } else {
        // Only show brush cursor if we are actually hovering (handled by mouseenter)
    }
}

wandToleranceInput.addEventListener('input', (e) => {
    toleranceVal.textContent = e.target.value;
});

function setupEditor() {
    // Set canvas dimensions to match image
    editorCanvas.width = processedImageForRefine.naturalWidth;
    editorCanvas.height = processedImageForRefine.naturalHeight;
    selectionCanvas.width = editorCanvas.width;
    selectionCanvas.height = editorCanvas.height;
    
    // Initial draw
    ctx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
    ctx.drawImage(processedImageForRefine, 0, 0);
    
    // Reset selection
    selectionMask = new Uint8Array(editorCanvas.width * editorCanvas.height);
    sctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    
    // Reset history
    history = [ctx.getImageData(0, 0, editorCanvas.width, editorCanvas.height)];
    
    updateBrushCursor();
    updateToolControls();
}

// Brush Settings
brushSizeInput.addEventListener('input', (e) => {
    brushSizeVal.textContent = e.target.value;
    updateBrushCursor();
});

brushHardnessInput.addEventListener('input', (e) => {
    brushHardnessVal.textContent = e.target.value;
});

function updateBrushCursor() {
    const size = parseInt(brushSizeInput.value);
    brushCursor.style.width = `${size}px`;
    brushCursor.style.height = `${size}px`;
}

// Drawing Logic
editorCanvas.addEventListener('mousedown', startDrawing);
editorCanvas.addEventListener('mousemove', draw);
window.addEventListener('mouseup', stopDrawing);

// Touch Support
editorCanvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    editorCanvas.dispatchEvent(mouseEvent);
}, { passive: false });

editorCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    editorCanvas.dispatchEvent(mouseEvent);
}, { passive: false });

editorCanvas.addEventListener('touchend', (e) => {
    const mouseEvent = new MouseEvent('mouseup', {});
    window.dispatchEvent(mouseEvent);
});

editorCanvas.addEventListener('mouseenter', () => {
    if (!smartSelectionToggle.checked) brushCursor.style.display = 'block';
});
editorCanvas.addEventListener('mouseleave', () => brushCursor.style.display = 'none');

function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY,
        cursorX: evt.clientX - rect.left,
        cursorY: evt.clientY - rect.top
    };
}

function startDrawing(e) {
    if (smartSelectionToggle.checked) {
        const pos = getMousePos(editorCanvas, e);
        applySmartAction(Math.round(pos.x), Math.round(pos.y));
        return;
    }
    isDrawing = true;
    draw(e);
}

function stopDrawing() {
    if (isDrawing) {
        saveToHistory();
    }
    isDrawing = false;
}

function draw(e) {
    const pos = getMousePos(editorCanvas, e);
    
    // Update cursor position
    const container = document.getElementById('canvasContainer');
    if (container && !smartSelectionToggle.checked) {
        const rect = container.getBoundingClientRect();
        brushCursor.style.left = `${e.clientX - rect.left}px`;
        brushCursor.style.top = `${e.clientY - rect.top}px`;
    }
    
    if (!isDrawing) return;

    const size = parseInt(brushSizeInput.value);
    const hardness = parseInt(brushHardnessInput.value) / 100;
    
    ctx.globalCompositeOperation = currentTool === 'restore' ? 'source-over' : 'destination-out';
    
    if (currentTool === 'restore') {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = editorCanvas.width;
        tempCanvas.height = editorCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        const gradient = tempCtx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, size / 2);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(hardness, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        tempCtx.fillStyle = gradient;
        tempCtx.beginPath();
        tempCtx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
        tempCtx.fill();
        
        tempCtx.globalCompositeOperation = 'source-in';
        tempCtx.drawImage(originalImageForRefine, 0, 0);
        
        ctx.drawImage(tempCanvas, 0, 0);
    } else {
        const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, size / 2);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(hardness, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function applySmartAction(startX, startY) {
    const width = editorCanvas.width;
    const height = editorCanvas.height;
    const tolerance = parseInt(wandToleranceInput.value);
    
    // Selection source depends on tool: Restore from Original, Erase from Current
    const sourceImage = originalImageForRefine;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tctx = tempCanvas.getContext('2d');
    tctx.drawImage(sourceImage, 0, 0);
    const imageData = tctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    const startIdx = (startY * width + startX) * 4;
    const startR = data[startIdx];
    const startG = data[startIdx + 1];
    const startB = data[startIdx + 2];
    
    const visited = new Uint8Array(width * height);
    const stack = [[startX, startY]];
    const newSelection = new Uint8Array(width * height);
    
    while (stack.length > 0) {
        const [x, y] = stack.pop();
        const idx = y * width + x;
        if (visited[idx]) continue;
        visited[idx] = 1;
        const dIdx = idx * 4;
        const dist = Math.sqrt(
            Math.pow(data[dIdx] - startR, 2) + 
            Math.pow(data[dIdx + 1] - startG, 2) + 
            Math.pow(data[dIdx + 2] - startB, 2)
        );
        if (dist <= tolerance) {
            newSelection[idx] = 255;
            if (x > 0) stack.push([x - 1, y]);
            if (x < width - 1) stack.push([x + 1, y]);
            if (y > 0) stack.push([x, y - 1]);
            if (y < height - 1) stack.push([x, y + 1]);
        }
    }
    
    // Apply immediately to image
    const currentImgData = ctx.getImageData(0, 0, width, height);
    
    // For Restore: Copy from Original. For Erase: Set alpha to 0.
    if (currentTool === 'restore') {
        const originalData = data; // Already have it
        for (let i = 0; i < newSelection.length; i++) {
            if (newSelection[i]) {
                const dIdx = i * 4;
                currentImgData.data[dIdx] = originalData[dIdx];
                currentImgData.data[dIdx+1] = originalData[dIdx+1];
                currentImgData.data[dIdx+2] = originalData[dIdx+2];
                currentImgData.data[dIdx+3] = originalData[dIdx+3];
            }
        }
    } else {
        for (let i = 0; i < newSelection.length; i++) {
            if (newSelection[i]) {
                currentImgData.data[i * 4 + 3] = 0;
            }
        }
    }
    
    ctx.putImageData(currentImgData, 0, 0);
    saveToHistory();
    showStatus(`Smart ${currentTool === 'restore' ? 'Restored' : 'Erased'} connected colors!`, 'success');
}

function renderSelection() {
    // No longer needed for persistent selection, but keep for future use if needed
    sctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
}

window.addEventListener('keydown', (e) => {
    if (refineModal.style.display === 'block') {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoRefine.click();
        }
        if (e.key === 'Escape') {
            refineModal.style.display = 'none';
        }
        if (smartSelectionToggle.checked) {
            if (e.key === '[') {
                wandToleranceInput.value = Math.max(1, parseInt(wandToleranceInput.value) - 5);
                toleranceVal.textContent = wandToleranceInput.value;
            }
            if (e.key === ']') {
                wandToleranceInput.value = Math.min(100, parseInt(wandToleranceInput.value) + 5);
                toleranceVal.textContent = wandToleranceInput.value;
            }
        }
    }
});

function saveToHistory() {
    history.push(ctx.getImageData(0, 0, editorCanvas.width, editorCanvas.height));
    if (history.length > maxHistory) history.shift();
}

undoRefine.addEventListener('click', () => {
    if (history.length > 1) {
        history.pop();
        const lastState = history[history.length - 1];
        ctx.putImageData(lastState, 0, 0);
    }
});

saveRefine.addEventListener('click', () => {
    editorCanvas.toBlob((blob) => {
        processedBlob = blob;
        const url = URL.createObjectURL(blob);
        resultImg.src = url;
        refineModal.style.display = 'none';
        showStatus('✨ Manual refinements applied!', 'success');
    }, 'image/png');
});

// Theme toggle
themeToggle.addEventListener('click', function() {
    body.classList.toggle('light');
    themeToggle.textContent = body.classList.contains('light') ? '🌙' : '☀️';
    localStorage.setItem('theme', body.classList.contains('light') ? 'light' : 'dark');
});

// Load saved theme
if (localStorage.getItem('theme') === 'light') {
    body.classList.add('light');
    themeToggle.textContent = '🌙';
}

// Background options
const bgOptions = document.querySelectorAll('input[name="background_type"]');
const bgColorGroup = document.querySelector('.bg-color-group');

bgOptions.forEach(option => {
    option.addEventListener('change', function() {
        if (this.value === 'color') {
            bgColorGroup.style.display = 'block';
        } else {
            bgColorGroup.style.display = 'none';
        }

        if (transparentBlob && selectedFiles.length > 0) {
            applyBackgroundClientSide();
        }
    });
});

// Color presets
const colorPresets = document.querySelectorAll('.color-preset');
const bgColorInput = document.getElementById('bgColor');

colorPresets.forEach(preset => {
    preset.addEventListener('click', function() {
        const color = this.dataset.color;
        bgColorInput.value = color;
        colorPresets.forEach(p => p.classList.remove('selected'));
        this.classList.add('selected');

        // Apply background client-side
        if (transparentBlob && selectedFiles.length > 0) {
            applyBackgroundClientSide();
        }
    });
});

// Color picker change
bgColorInput.addEventListener('input', function() {
    colorPresets.forEach(p => p.classList.remove('selected'));

    // Apply background client-side
    if (transparentBlob && selectedFiles.length > 0) {
        applyBackgroundClientSide();
    }
});

// Quality slider display
const qualitySlider = document.getElementById('quality');
if (qualitySlider) {
    qualitySlider.addEventListener('input', (e) => {
        // Optional: add a label if needed, but the slider is intuitive
    });
}

// Preset backgrounds (only if they exist)
const presetBgs = document.querySelectorAll('.preset-bg');
let selectedPresetUrl = null;

presetBgs.forEach(preset => {
    preset.addEventListener('click', function() {
        presetBgs.forEach(p => p.classList.remove('selected'));
        this.classList.add('selected');
        selectedPresetUrl = this.dataset.url;
        
        // Clear custom file input when preset is selected
        const bgImageEl = document.getElementById('bgImage');
        if (bgImageEl) bgImageEl.value = '';
        const fileNameEl = document.querySelector('.file-name');
        if (fileNameEl) fileNameEl.textContent = 'Choose image...';

        if (transparentBlob && selectedFiles.length > 0) {
            applyBackgroundClientSide();
        }
    });
});
// Advanced Controls (with safety checks)
const superPrecision = document.getElementById('super_precision');
const autoShadow = document.getElementById('auto_shadow');
const brightnessSlider = document.getElementById('subject-brightness');
const contrastSlider = document.getElementById('subject-contrast');
const saturationSlider = document.getElementById('subject-saturation');

// Update value displays
if (brightnessSlider) {
    brightnessSlider.addEventListener('input', (e) => {
        const valDisplay = document.getElementById('brightness-val');
        if (valDisplay) valDisplay.textContent = e.target.value + '%';
        applyBackgroundClientSide();
    });
}
if (contrastSlider) {
    contrastSlider.addEventListener('input', (e) => {
        const valDisplay = document.getElementById('contrast-val');
        if (valDisplay) valDisplay.textContent = e.target.value + '%';
        applyBackgroundClientSide();
    });
}
if (saturationSlider) {
    saturationSlider.addEventListener('input', (e) => {
        const valDisplay = document.getElementById('saturation-val');
        if (valDisplay) valDisplay.textContent = e.target.value + '%';
        applyBackgroundClientSide();
    });
}
if (autoShadow) {
    autoShadow.addEventListener('change', applyBackgroundClientSide);
}

const superPrecisionToggle = document.getElementById('super_precision');
const edgeCleaningContainer = document.getElementById('edge_cleaning_container');
if (superPrecisionToggle && edgeCleaningContainer) {
    superPrecisionToggle.addEventListener('change', (e) => {
        edgeCleaningContainer.style.display = e.target.checked ? 'block' : 'none';
    });
    // Initial state
    edgeCleaningContainer.style.display = superPrecisionToggle.checked ? 'block' : 'none';
}

const edgeCleaningInput = document.getElementById('edge_cleaning');
const edgeCleaningVal = document.getElementById('edge_cleaning_val');
if (edgeCleaningInput && edgeCleaningVal) {
    edgeCleaningInput.addEventListener('input', (e) => {
        edgeCleaningVal.textContent = e.target.value;
    });
}

// Disable background options when Enhancement is active (if exists)
const enhanceBgInput = document.getElementById('enhance_bg');
if (enhanceBgInput) {
    enhanceBgInput.addEventListener('change', function() {
        const bgOptionInputs = document.querySelectorAll('input[name="background_type"]');
        bgOptionInputs.forEach(input => {
            input.disabled = this.checked;
            // Add a visual indicator
            const bgOption = input.closest('.bg-option');
            if (bgOption) {
                bgOption.style.opacity = this.checked ? '0.5' : '1';
                bgOption.style.pointerEvents = this.checked ? 'none' : 'auto';
            }
        });
        
        if (this.checked) {
            showStatus('Background Enhancement will preserve the original background and make it dramatic.', 'info');
        }
    });
}

// Store original files for comparison
let originalFiles = [];

// Before/After Toggle
function addComparisonToggle(container, originalSrc, processedSrc) {
    const btn = document.createElement('button');
    btn.className = 'comparison-toggle';
    btn.textContent = 'View Original';
    
    const img = container.querySelector('.result-image');
    
    btn.addEventListener('mousedown', () => {
        img.src = originalSrc;
        btn.textContent = 'Original';
    });
    
    btn.addEventListener('mouseup', () => {
        img.src = processedSrc;
        btn.textContent = 'View Original';
    });

    btn.addEventListener('mouseleave', () => {
        img.src = processedSrc;
        btn.textContent = 'View Original';
    });

    container.appendChild(btn);
}

// Custom background image change (if bgImage exists)
const bgImageInput = document.getElementById('bgImage');
if (bgImageInput) {
    bgImageInput.addEventListener('change', function(e) {
        const fileName = e.target.files[0] ? e.target.files[0].name : 'Choose image...';
        const fileNameEl = document.querySelector('.file-name');
        if (fileNameEl) fileNameEl.textContent = fileName;
        
        // Clear preset selection when custom file is chosen
        presetBgs.forEach(p => p.classList.remove('selected'));
        selectedPresetUrl = null;

        if (transparentBlob && selectedFiles.length > 0) {
            applyBackgroundClientSide();
        }
    });
}

// Update applyBackgroundClientSide to handle presets and blur
async function applyBackgroundClientSide() {
    if (!transparentBlob) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = function() {
        let width = img.width;
        let height = img.height;
        const maxSizeEl = document.getElementById('max_size');
        const maxSize = maxSizeEl ? parseInt(maxSizeEl.value) : 0;
        
        // ONLY resize if user explicitly selected a max size, keep original otherwise!
        if (maxSize > 0 && maxSize < Math.max(width, height)) {
            if (width > height) {
                height = (height * maxSize) / width;
                width = maxSize;
            } else {
                width = (width * maxSize) / height;
                height = maxSize;
            }
        }
        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(img, 0, 0, width, height);
        
        const bgTypeInput = document.querySelector('input[name="background_type"]:checked');
        const bgType = bgTypeInput ? bgTypeInput.value : 'transparent';

        if (bgType === 'white') {
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            finalizeCanvas();
        } else if (bgType === 'color' && bgColorInput) {
            const color = bgColorInput.value;
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            finalizeCanvas();
        } else {
            finalizeCanvas();
        }
    };

    img.src = URL.createObjectURL(transparentBlob);

    function finalizeCanvas() {
        let mimeType = 'image/png';
        if (currentFormat === 'jpg') mimeType = 'image/jpeg';
        else if (currentFormat === 'webp') mimeType = 'image/webp';
        const quality = currentFormat === 'png' ? undefined : currentQuality / 100;
        canvas.toBlob(function(blob) {
            processedBlob = blob;
            const url = URL.createObjectURL(blob);
            resultImg.src = url;
            showStatus('Background updated!', 'success');
        }, mimeType, quality);
    }
}

// Auto-detect background color button
const autoDetectBtn = document.getElementById('autoDetectColor');
if (autoDetectBtn && selectedFiles.length > 0) {
    autoDetectBtn.addEventListener('click', async () => {
        try {
            const formData = new FormData();
            formData.append('image', selectedFiles[0]);
            
            const backendUrl = `${BACKEND_URL}/detect-background-color`;
            const response = await fetch(backendUrl, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Failed to detect background color');
            }
            
            const result = await response.json();
            if (result.success) {
                bgColorInput.value = result.color;
                colorPresets.forEach(p => p.classList.remove('selected'));
                showStatus(`Detected background color: ${result.color}`, 'success');
                
                // Apply the detected color if we have a processed image
                if (transparentBlob && selectedFiles.length > 0) {
                    applyBackgroundClientSide();
                }
            }
        } catch (error) {
            console.error('Error detecting background color:', error);
            showStatus('Failed to detect background color', 'error');
        }
    });
}

// Daily use preset background buttons
const presetBgBtns = document.querySelectorAll('.preset-bg-btn');
presetBgBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Select this preset
        presetBgBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        
        // Set the color
        const color = btn.dataset.color;
        bgColorInput.value = color;
        colorPresets.forEach(p => p.classList.remove('selected'));
        
        // Select the 'color' background type
        document.querySelector('input[name="background_type"][value="color"]').checked = true;
        bgColorGroup.style.display = 'block';
        
        // Apply the background if we have a processed image
        if (transparentBlob && selectedFiles.length > 0) {
            applyBackgroundClientSide();
        }
        
        showStatus('Applied preset background!', 'success');
    });
});

// Set initial selected color
const initialColor = document.querySelector('.color-preset[data-color="#ffffff"]');
if (initialColor) initialColor.classList.add('selected');

// Drag and drop functionality
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    uploadArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    uploadArea.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
    uploadArea.addEventListener(eventName, unhighlight, false);
});

function highlight(e) {
    uploadArea.classList.add('dragover');
}

function unhighlight(e) {
    uploadArea.classList.remove('dragover');
}

uploadArea.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

fileInput.addEventListener('change', function(e) {
    handleFiles(e.target.files);
});

pasteBtn.addEventListener('click', async function() {
    try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            for (const type of item.types) {
                if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    const file = new File([blob], 'pasted-image.png', { type: blob.type });
                    handleFiles([file]);
                    return;
                }
            }
        }
        showStatus('No image found in clipboard. Copy an image first.', 'error');
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            showStatus('Clipboard access denied. Please allow clipboard permissions.', 'error');
        } else {
            showStatus('Failed to read from clipboard. Try using the file upload instead.', 'error');
        }
    }
});

function handleFiles(files) {
    selectedFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (selectedFiles.length > 0) {
        fileInput.files = new DataTransfer().files; // Clear
        const dt = new DataTransfer();
        selectedFiles.forEach(file => dt.items.add(file));
        fileInput.files = dt.files;

        showPreview(selectedFiles[0]); // Show first image preview
        updateFileCount();
        result.style.display = 'none'; // Hide previous result
        status.textContent = '';
        status.className = 'status';
        
        // Re-bind auto-detect button event listener now that we have a file
        const autoDetectBtn = document.getElementById('autoDetectColor');
        if (autoDetectBtn) {
            // Remove existing listeners (if any) by cloning
            const newBtn = autoDetectBtn.cloneNode(true);
            autoDetectBtn.parentNode.replaceChild(newBtn, autoDetectBtn);
            
            newBtn.addEventListener('click', async () => {
                try {
                    const formData = new FormData();
                    formData.append('image', selectedFiles[0]);
                    
                    const backendUrl = `${BACKEND_URL}/detect-background-color`;
                    const response = await fetch(backendUrl, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error('Failed to detect background color');
                    }
                    
                    const result = await response.json();
                    if (result.success) {
                        bgColorInput.value = result.color;
                        colorPresets.forEach(p => p.classList.remove('selected'));
                        showStatus(`Detected background color: ${result.color}`, 'success');
                        
                        // Apply the detected color if we have a processed image
                        if (transparentBlob && selectedFiles.length > 0) {
                            applyBackgroundClientSide();
                        }
                    }
                } catch (error) {
                    console.error('Error detecting background color:', error);
                    showStatus('Failed to detect background color', 'error');
                }
            });
        }
    } else {
        showStatus('Please select valid image files.', 'error');
    }
}

function updateFileCount() {
    if (selectedFiles.length === 1) {
        fileCount.textContent = '1 file selected';
    } else {
        fileCount.textContent = `${selectedFiles.length} files selected`;
    }
}

function showPreview(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        previewImg.src = e.target.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    try {
        const formData = new FormData(this);

        // Append options to formData
        const maxSize = document.getElementById('max_size')?.value || '0';
        const quality = document.getElementById('quality')?.value || '95';
        
        formData.append('max_size', maxSize);
        formData.append('quality', quality);
        
        // Auto-detect best settings
        formData.append('model', 'u2net_human_seg'); // Specifically trained for human portraits!
        formData.append('format', 'png'); // PNG default for transparency
        
        const bgTypeInput = document.querySelector('input[name="background_type"]:checked');
        const bgType = bgTypeInput ? bgTypeInput.value : 'transparent';
        formData.append('background_type', bgType);
        
        const bgColorInputEl = document.getElementById('bgColor');
        formData.append('bg_color', bgColorInputEl ? bgColorInputEl.value : '#ffffff');
        
        // Add advanced settings (if they exist)
        const superPrecisionEl = document.getElementById('super_precision');
        if (superPrecisionEl) {
            formData.append('super_precision', superPrecisionEl.checked);
        }

        const edgeCleaningEl = document.getElementById('edge_cleaning');
        if (edgeCleaningEl) {
            formData.append('edge_cleaning', edgeCleaningEl.value);
        }

        const enhanceBgEl = document.getElementById('enhance_bg');
        if (enhanceBgEl) {
            formData.append('enhance_bg', enhanceBgEl.checked);
        }

        const alphaMattingEl = document.getElementById('alpha_matting');
        if (alphaMattingEl) {
            formData.append('alpha_matting', alphaMattingEl.checked);
            formData.append('alpha_matting_foreground_threshold', document.getElementById('af_threshold')?.value || '240');
            formData.append('alpha_matting_background_threshold', document.getElementById('ab_threshold')?.value || '10');
            formData.append('alpha_matting_erode_size', document.getElementById('ae_size')?.value || '10');
        }

        const bgImageFile = document.getElementById('bgImage')?.files[0];
        if (bgImageFile) {
            formData.append('bg_image', bgImageFile);
        }

        // Get current settings
        currentFormat = 'png'; 
        currentQuality = parseInt(quality);

        // Show loading
        loading.style.display = 'block';
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="btn-icon">⏳</span> Working Magic...';
        status.textContent = '';
        status.className = 'status';

        // Use absolute URL if on a different port (e.g., Live Server)
        const backendUrl = `${BACKEND_URL}/upload`;

        const response = await fetch(backendUrl, {
            method: 'POST',
            body: formData
        });

        loading.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-icon">✨</span> Magic Remove Background';

        if (!response.ok) {
            const data = await response.json().catch(() => ({ error: 'Server error occurred' }));
            throw new Error(data.error || 'Upload failed. Please try again.');
        }

        const contentType = response.headers.get('content-type');
        const blob = await response.blob();
        
        if (contentType && contentType.includes('application/zip')) {
            // Batch processing result (ZIP)
            resultTitle.textContent = `Processed ${selectedFiles.length} Images Successfully`;
            resultImg.style.display = 'none';
            
            // Create a temporary link to download the ZIP
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'processed_images.zip';
            document.body.appendChild(a);
            a.click();
            a.remove();
            
            showStatus(`✅ All ${selectedFiles.length} images processed! ZIP downloaded.`, 'success');
        } else {
            // Single file result
            transparentBlob = blob; // Store transparent PNG
            processedBlob = blob; // Initially same

            resultTitle.textContent = 'Your Background-Removed Image';
            const url = URL.createObjectURL(blob);
            resultImg.src = url;
            resultImg.style.display = 'block';
            refineBtn.style.display = 'inline-block';

            // Clear existing toggle if any
            const resultContainer = document.querySelector('.result-container');
            const existingToggle = resultContainer.querySelector('.comparison-toggle');
            if (existingToggle) existingToggle.remove();

            // Add Before/After toggle for single images
            if (selectedFiles.length === 1) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    addComparisonToggle(resultContainer, e.target.result, url);
                };
                reader.readAsDataURL(selectedFiles[0]);
            }

            // Apply background if not transparent and enhancement is NOT active
            // If enhancement is active, the server already returned the full enhanced image
            const enhanceBgChecked = document.getElementById('enhance_bg')?.checked;
            if (bgType !== 'transparent' && !enhanceBgChecked) {
                applyBackgroundClientSide();
            }
            showStatus('Your background-removed image is ready!', 'success');
        }
        
        result.style.display = 'block';
        result.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('Error processing image:', error);
        loading.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="btn-icon">✨</span> Magic Remove Background';
        showStatus('Error: ' + error.message, 'error');
    }
});

downloadBtn.addEventListener('click', function() {
    if (processedBlob) {
        const url = URL.createObjectURL(processedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `removed_bg.${currentFormat}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
});



function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status ' + type;
}
