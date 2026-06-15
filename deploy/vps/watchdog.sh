#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/moosstudio}"
DEPLOY_DIR="${DEPLOY_DIR:-$APP_ROOT/deploy/vps}"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
SERVICE_NAME="${SERVICE_NAME:-app}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[watchdog] Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

systemctl enable docker --now >/dev/null 2>&1 || true
systemctl enable nginx --now >/dev/null 2>&1 || true

cd "$DEPLOY_DIR"

if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
  exit 0
fi

echo "[watchdog] Health check failed; starting $SERVICE_NAME"
docker compose up -d --no-build "$SERVICE_NAME"
sleep 10

if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
  exit 0
fi

echo "[watchdog] Still unhealthy; restarting $SERVICE_NAME"
docker compose restart "$SERVICE_NAME"
sleep 20

if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null; then
  exit 0
fi

echo "[watchdog] App remains unhealthy after restart" >&2
docker compose ps >&2 || true
docker compose logs --tail=100 "$SERVICE_NAME" >&2 || true
exit 1
