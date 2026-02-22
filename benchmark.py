import os
import io
import time
import cv2
import numpy as np
from PIL import Image
from rembg import remove, new_session
import requests

def get_metrics(pil_image):
    """Calculates metrics for a background-removed image (RGBA)."""
    cv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGBA2BGRA)
    alpha = cv_image[:, :, 3]
    _, binary = cv2.threshold(alpha, 1, 255, cv2.THRESH_BINARY)
    
    # Count disconnected components
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    
    # Components smaller than 100 pixels (likely noise)
    noise_components = [i for i in range(1, num_labels) if stats[i, cv2.CC_STAT_AREA] < 100]
    
    return {
        "total_components": num_labels - 1,
        "noise_components_count": len(noise_components),
        "mask_density": np.sum(binary == 255) / (binary.shape[0] * binary.shape[1])
    }

def refine_mask_internal(pil_image, min_area=100):
    cv_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGBA2BGRA)
    alpha = cv_image[:, :, 3]
    _, binary = cv2.threshold(alpha, 1, 255, cv2.THRESH_BINARY)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    new_mask = np.zeros_like(binary)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            new_mask[labels == i] = 255
    inverted = cv2.bitwise_not(new_mask)
    num_labels_inv, labels_inv, stats_inv, _ = cv2.connectedComponentsWithStats(inverted, connectivity=8)
    for i in range(1, num_labels_inv):
        if stats_inv[i, cv2.CC_STAT_AREA] < min_area:
            new_mask[labels_inv == i] = 255
    smoothed_mask = cv2.GaussianBlur(new_mask, (3, 3), 0)
    final_alpha = cv2.addWeighted(alpha, 0.3, smoothed_mask, 0.7, 0)
    cv_image[:, :, 3] = final_alpha
    return Image.fromarray(cv2.cvtColor(cv_image, cv2.COLOR_BGRA2RGBA))

def run_benchmark(image_path):
    print(f"\n--- Benchmarking: {os.path.basename(image_path)} ---")
    
    with open(image_path, "rb") as f:
        img_data = f.read()
    
    session = new_session("u2net")
    
    # 1. Standard rembg
    start_time = time.time()
    standard_out = remove(img_data, session=session)
    standard_time = time.time() - start_time
    standard_pil = Image.open(io.BytesIO(standard_out))
    standard_metrics = get_metrics(standard_pil)
    
    # 2. Enhanced (Super Precision)
    start_time = time.time()
    enhanced_pil = refine_mask_internal(standard_pil)
    enhanced_time = standard_time + (time.time() - start_time) # Total time
    enhanced_metrics = get_metrics(enhanced_pil)
    
    print(f"{'Metric':<30} | {'Standard':<15} | {'Super Precision':<15} | {'Improvement'}")
    print("-" * 85)
    
    metrics_to_show = [
        ("Noise Components (<100px)", "noise_components_count", False), # Lower is better
        ("Total Disconnected Blobs", "total_components", False), # Lower is better
        ("Processing Time (s)", "time", False), # Lower is better
    ]
    
    for label, key, higher_better in metrics_to_show:
        v1 = standard_metrics.get(key) if key != "time" else standard_time
        v2 = enhanced_metrics.get(key) if key != "time" else enhanced_time
        
        if v1 == 0 and v2 == 0:
            diff = "0%"
        elif v1 == 0:
            diff = "N/A"
        else:
            change = ((v1 - v2) / v1) * 100 if not higher_better else ((v2 - v1) / v1) * 100
            diff = f"{change:+.1f}%"
            
        print(f"{label:<30} | {v1:<15.4f} | {v2:<15.4f} | {diff}")

if __name__ == "__main__":
    # For testing, we'll try to find any image in the current directory or backend/static
    sample_images = []
    for root, dirs, files in os.walk("."):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                sample_images.append(os.path.join(root, file))
                if len(sample_images) >= 1: break
        if len(sample_images) >= 1: break
        
    if sample_images:
        run_benchmark(sample_images[0])
    else:
        print("No sample images found for benchmarking. Please place an image in the directory.")
