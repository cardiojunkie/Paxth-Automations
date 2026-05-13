#!/usr/bin/env bash
set -euo pipefail

cd /app

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"

if [[ ! -f dist/index.html ]]; then
  echo "[start] dist/index.html missing, building frontend bundle..."
  npm run build
fi

if [[ ! -x ./node_modules/.bin/tsx ]]; then
  echo "[start] tsx runtime not found in node_modules. Ensure dependencies are installed."
  exit 1
fi

echo "[start] starting server on port ${PORT}"
exec ./node_modules/.bin/tsx server.ts
