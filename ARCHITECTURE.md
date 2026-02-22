# Database-Free Background Remover Architecture

This project is a stateless, database-free web application for removing image backgrounds using AI. It is designed to be lightweight, easy to deploy, and highly performant.

## Architecture Overview

The application follows a client-server architecture but maintains no persistent data on the server side (no database).

### 1. Backend (Flask)
- **Framework**: Flask (Python)
- **AI Engine**: `rembg` library (based on U2-Net/IS-Net) for background removal.
- **Image Processing**: `OpenCV` and `Pillow` for advanced refinement, edge cleaning, and background enhancement.
- **Statelessness**: No user data, images, or processing history are stored on the server. Images are processed in-memory and returned directly to the client.
- **Concurrency**: Handled by Flask's built-in server (development) or can be deployed with Gunicorn/Uvicorn.
- **Session Caching**: AI model sessions are cached in-memory using a simple dictionary to avoid reloading models for every request.

### 2. Frontend (Vanilla JS/CSS)
- **Logic**: Handles image uploads (drag & drop, paste, browse), client-side background replacement (solid color/custom image), and manual refinement.
- **Refinement Tool**: Features a custom-built canvas editor with "Smart Mode" (flood-fill color selection) and manual brush/restore tools.
- **Processing**: Large images are optionally resized client-side or server-side based on user preference.
- **Responsiveness**: Fully responsive CSS with dark/light mode support.

## Data Flow

1. **Upload**: User provides images via the UI.
2. **Processing Request**: The frontend sends a `POST` request to `/upload` with the image(s) and processing parameters (model, quality, alpha matting, etc.).
3. **AI Removal**: The backend uses `rembg` to remove the background.
4. **Refinement (Optional)**: If "Super Precision" is enabled, the backend applies additional OpenCV-based morphological operations and bilateral filtering.
5. **Response**: 
   - For a single image: The server returns the processed image (PNG/JPG/WebP).
   - For multiple images: The server bundles them into a ZIP file and returns it.
6. **Client-Side Finalization**: The frontend applies background colors, custom images, or lighting adjustments using the HTML5 Canvas API before the final download.

## Deployment Instructions

### Prerequisites
- Python 3.9+
- pip

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd Remove_Bg
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   *(Note: Ensure you have `flask`, `flask-cors`, `rembg`, `pillow`, `opencv-python`, and `numpy` installed.)*

### Running Locally

1. Start the Flask server:
   ```bash
   python backend/app.py
   ```
2. Open your browser and navigate to `http://localhost:5000`.

### Production Deployment

For production, it is recommended to use a WSGI server like Gunicorn:

```bash
gunicorn --bind 0.0.0.0:5000 backend.app:app --workers 4 --timeout 120
```

## Key Features (Database-Free)
- **Zero Persistence**: No GDPR/privacy concerns regarding data storage.
- **Fast Startup**: No database migrations or setup required.
- **Portability**: The entire app can be containerized (Docker) and deployed anywhere easily.
- **Memory Efficient**: Uses in-memory processing and streaming responses.
