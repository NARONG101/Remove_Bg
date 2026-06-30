# Background Remover

## Hosting Instructions

### Frontend (GitHub Pages)
This folder contains the static frontend files. To host on GitHub Pages:
1. Go to your repo settings
2. Find "Pages" section
3. Set "Source" to "Deploy from a branch"
4. Choose "main" (or your default branch)
5. Set "Folder" to "/docs"
6. Save!

### Backend Hosting
You need to host the backend separately (GitHub Pages can't run Python). Free options:
- **Render**: https://render.com
- **Vercel**: https://vercel.com (with Functions)
- **Railway**: https://railway.app

#### Hosting on Render:
1. Push your code to GitHub
2. Go to Render → New → Web Service
3. Connect your repo
4. Configure:
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt`
   - Start command: `python app.py`
5. Deploy!

Once your backend is deployed, update `BACKEND_URL` in `docs/static/script.js` to your Render URL (e.g., `https://your-app.onrender.com`)
