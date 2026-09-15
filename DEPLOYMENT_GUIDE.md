# Kurutu Keyboard Admin Panel - Cloud Deployment Guide 🌐

This guide explains how to deploy your **Kurutu Admin Panel** to **Render.com** (100% Free Hosting) so you can access and control it from your mobile phone 24/7 without turning on your computer!

---

## Step 1: Create a GitHub Repository (or Push Code)
1. Go to [GitHub.com](https://github.com) and create a new repository (e.g. `kurutu-admin-panel`).
2. Push your `admin-panel` directory to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Deploy Kurutu Admin Panel"
   git remote add origin https://github.com/YOUR_USERNAME/kurutu-admin-panel.git
   git push -u origin main
   ```

---

## Step 2: Deploy to Render.com (Free)
1. Sign up/Log in to [Render.com](https://render.com).
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository (`kurutu-admin-panel`).
4. Fill in the following settings:
   - **Name**: `kurutu-admin` (or any name you prefer)
   - **Environment**: `Node`
   - **Root Directory**: `admin-panel` (leave blank if repository only contains admin-panel)
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`

5. Under **Environment Variables**, add:
   - `ADMIN_SECRET_KEY` = `your_secret_password` (e.g. `kurutu_admin_secret_2026`)

6. Click **Create Web Service**.

---

## Step 3: Access from your Mobile Phone 📱
1. Once deployed, Render will give you a live URL, like:
   `https://kurutu-admin.onrender.com`
2. Open this URL in Chrome/Safari on your mobile phone anytime, anywhere!
3. Enter your Secret Key to log in.
4. (Optional) Save it to your phone's Home Screen for 1-tap app-like access!
