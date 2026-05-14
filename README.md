<div align="center">
<img width="1200" height="475" alt="MoosStudio Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# MoosStudio

**AI-powered product content engine — scrape, enrich, export.**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

</div>

---

## What is MoosStudio?

MoosStudio is a full-stack product content automation platform built for e-commerce teams. It scrapes product pages using a stealth browser, structures raw data against configurable attribute sets, enriches content with an LLM (Groq), and exports ready-to-import XLSX or JSON files.

### Key Capabilities

| Feature | Details |
|---|---|
| **Stealth Scraping** | CloakBrowser (Chromium) with Playwright fallback — bypasses most bot-detection |
| **Product Discovery** | Crawl a PLP to pull all product URLs automatically |
| **AI Enrichment** | Groq LLM maps scraped data to configurable attribute schemas |
| **Image Extraction** | Downloads, resizes, and stores product images via Sharp |
| **PDF Upload** | Parse supplier PDFs and extract structured product data |
| **Batch Jobs** | Queue and run multi-SKU enrichment jobs with live progress logs |
| **XLSX / JSON Export** | One-click exports formatted for catalogue import |
| **Firestore Sync** | All data optionally mirrors to Firebase Firestore in real time |
| **Admin Auth** | Email allowlist + session key gate on all `/api/*` routes |

---

## Tech Stack

- **Frontend** — React 19, Vite, Tailwind CSS v4, Framer Motion
- **Backend** — Node.js, Express, TypeScript (tsx)
- **Browser Automation** — CloakBrowser, Playwright Chromium
- **AI** — Groq SDK (LLaMA / Mixtral)
- **Database** — Firebase Admin SDK + Firestore
- **Storage** — Local filesystem (with optional Firestore mirror)
- **Containerisation** — Docker (multi-stage, Playwright base image)

---

## Project Structure

```
├── server.ts              # Express API server + Vite dev middleware
├── src/
│   ├── App.tsx            # Main React dashboard
│   ├── auth.ts            # API fetch wrapper (injects admin key)
│   └── services/db.ts     # Firestore + filesystem abstraction layer
├── settings/
│   ├── app_settings.json  # Attribute sets, LLM rules, saved presets
│   └── allowlist.json     # Authorised user emails and roles
├── sku-index/master.json  # Persistent SKU registry
├── harvest/               # Raw scraped markdown per SKU
├── outputs/               # Enriched JSON and XLSX exports
├── public/images/         # Downloaded product images
├── jobs/                  # Queued batch job definitions
├── Dockerfile             # Multi-stage production image
├── render.yaml            # Render blueprint (one-click deploy)
└── docker/start.sh        # Container entrypoint
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/sku/index` | List all SKUs |
| `POST` | `/api/sku/index` | Add SKU to index |
| `DELETE` | `/api/sku/index/:sku` | Remove SKU |
| `POST` | `/api/scrape` | Scrape a product URL |
| `POST` | `/api/discover` | Discover product URLs from a PLP |
| `POST` | `/api/analyze` | AI-enrich scraped harvest data |
| `POST` | `/api/inspect` | Inspect raw page content |
| `GET` | `/api/harvest` | List harvested SKUs |
| `GET` | `/api/harvest/:filename` | Get raw harvest content |
| `DELETE` | `/api/harvest/:filename` | Delete a harvest |
| `POST` | `/api/save-batch` | Save a batch of enriched outputs |
| `GET` | `/api/outputs/json/:filename` | Get a single output JSON |
| `GET` | `/api/outputs/xlsx` | Download full XLSX export |
| `POST` | `/api/outputs/:sku` | Save output for a SKU |
| `DELETE` | `/api/outputs/:sku` | Delete output for a SKU |
| `POST` | `/api/upload-pdf` | Upload a supplier PDF for parsing |
| `GET` | `/api/pdf/:sku` | Retrieve parsed PDF content |
| `GET` | `/api/jobs` | List batch jobs |
| `POST` | `/api/jobs/run` | Run a batch job |
| `POST` | `/api/images/extract` | Extract and download product images |
| `POST` | `/api/images/render` | Render/resize images |
| `DELETE` | `/api/images/:sku` | Delete images for a SKU |
| `GET` | `/api/settings` | Get app settings |
| `POST` | `/api/settings` | Save app settings |
| `POST` | `/api/admin/login` | Admin session login |
| `GET` | `/api/admin/status` | Server status |
| `GET` | `/api/health/firestore` | Firestore connection health |

---

## Local Development

**Prerequisites:** Node.js 20+, Docker (optional)

```bash
# 1. Install dependencies (also installs Playwright Chromium)
npm install

# 2. Add your environment variables
cp .env.example .env
# Set GROQ_API_KEY and optionally FIREBASE_SERVICE_ACCOUNT_JSON

# 3. Start the dev server (hot-reload via Vite)
npm run dev
```

App runs at **http://localhost:3000**

To restart after a crash or port conflict:

```bash
fuser -k 3000/tcp 24678/tcp 2>/dev/null; npm run dev
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | Groq API key for LLM enrichment |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Recommended | Full Firebase service account JSON as a single string |
| `FIRESTORE_MODE` | No | `all` (default) · `outputs-only` · `off` |
| `NODE_ENV` | No | `production` in deployed environments |
| `PORT` | No | Server port (default `3000`) |
| `CORS_ORIGINS` | Recommended for cross-origin UI | Comma-separated allowed browser origins (set `*` only in trusted internal networks) |
| `MAX_CONCURRENT_BROWSER_TASKS` | No | Max parallel browser sessions (default `2`) |
| `ADMIN_KEY` | Yes | Static key for admin API auth (server fails to start without it) |

> **Security:** Never commit `firebase-service-account.json` or `GROQ_API_KEY` to version control. Use environment variables in all deployed environments.

---

## Deploy with Docker (Any Platform)

Use the included multi-stage `Dockerfile` on any Docker-compatible host (VPS, Railway, Fly.io, Kubernetes, ECS, etc.).

### Required runtime environment

1. Set `ADMIN_KEY` (required to boot).
2. Set `GROQ_API_KEY` if AI enrichment is needed.
3. Set `FIREBASE_SERVICE_ACCOUNT_JSON` for Firestore access.
4. Set `CORS_ORIGINS` when frontend is served from a different origin.

### Recommended runtime settings

| Setting | Value |
|---|---|
| Runtime | Docker |
| Dockerfile path | `./Dockerfile` |
| Port | `3000` |
| Health check path | `/api/admin/status` |

### Persistent storage (optional)

Mount these paths if you need files to survive container restarts:

| Mount Path | Purpose |
|---|---|
| `/app/outputs` | Enriched JSON & XLSX files |
| `/app/harvest` | Raw scraped data |
| `/app/public/images` | Downloaded product images |

---

## Docker

```bash
# Build
docker build -t moosstudioza .

# Run
docker run -p 3000:3000 \
  -e ADMIN_KEY=change-this \
  -e GROQ_API_KEY=your_key \
  -e CORS_ORIGINS=https://your-frontend-domain.com \
  -e FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' \
  moosstudioza
```

---

## License

Private — all rights reserved.
