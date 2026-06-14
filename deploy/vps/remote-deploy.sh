#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/moosstudio"
DEPLOY_DIR="$APP_ROOT/deploy/vps"

if [ ! -f "$DEPLOY_DIR/docker-compose.yml" ]; then
  echo "Missing $DEPLOY_DIR/docker-compose.yml"
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/.env.prod" ]; then
  echo "Missing $DEPLOY_DIR/.env.prod"
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/data/settings/allowlist.json" ]; then
  echo "Missing $DEPLOY_DIR/data/settings/allowlist.json"
  echo "Create it with at least one admin email before deploy."
  exit 1
fi

cd "$DEPLOY_DIR"

echo "[1/5] Build image"
docker compose build --no-cache

echo "[2/5] Start app"
docker compose up -d

echo "[3/5] Install nginx site config"
cp "$DEPLOY_DIR/nginx-moosstudio.conf" /etc/nginx/sites-available/moosstudio.conf
ln -sf /etc/nginx/sites-available/moosstudio.conf /etc/nginx/sites-enabled/moosstudio.conf
nginx -t
systemctl reload nginx

echo "[4/5] Health check"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    echo "App is healthy on localhost:3000"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "Health check failed"
    docker compose logs --tail=200 app
    exit 1
  fi
done

echo "[5/5] Current container status"
docker compose ps

echo "Done. Next: run certbot after DNS propagation."
