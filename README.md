<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/efa482b0-be5e-4020-b79b-2bf5bb11d6e0

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy on Render

This repository includes `render.yaml` and `Dockerfile` so Render can deploy it as a Docker web service.

1. Push your latest `main` branch to GitHub.
2. In Render, click **New +** -> **Blueprint**.
3. Select this repository and confirm the detected `render.yaml`.
4. In Render service settings, add required environment variables:
   - `GROQ_API_KEY`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (paste full JSON as a single string)
   - Optional: `FIRESTORE_MODE` (`all` by default)
5. Deploy and wait for the first image build to complete.

Default app port is `3000`, and health checks run on `/api/sku/index`.
