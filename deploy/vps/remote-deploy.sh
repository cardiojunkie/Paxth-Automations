#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/moosstudio"
DEPLOY_DIR="$APP_ROOT/deploy/vps"
ENV_PATH="$APP_ROOT/.env"
ALLOWLIST_PATH="$APP_ROOT/settings/allowlist.json"

if [ ! -f "$DEPLOY_DIR/docker-compose.yml" ]; then
  echo "Missing $DEPLOY_DIR/docker-compose.yml"
  exit 1
fi

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing $ENV_PATH"
  exit 1
fi

if [ ! -f "$ALLOWLIST_PATH" ]; then
  echo "Missing $ALLOWLIST_PATH"
  echo "Create it with at least one admin email before deploy."
  exit 1
fi

mkdir -p "$APP_ROOT/harvest" "$APP_ROOT/jobs" "$APP_ROOT/outputs" "$APP_ROOT/images" "$APP_ROOT/sku-index" "$APP_ROOT/settings"

cd "$DEPLOY_DIR"

echo "[1/6] Build image"
docker compose build --no-cache

echo "[2/6] Start app"
if docker ps -a --format '{{.Names}}' | grep -qx 'moosstudio-app' \
  && ! docker compose ps --services --all | grep -qx 'app'; then
  echo "Removing stale moosstudio-app container not owned by this compose project"
  docker rm -f moosstudio-app
fi
docker compose up -d

echo "[3/6] Install nginx site config"
cp "$DEPLOY_DIR/nginx-moosstudio.conf" /etc/nginx/sites-available/moosstudio.conf
ln -sf /etc/nginx/sites-available/moosstudio.conf /etc/nginx/sites-enabled/moosstudio.conf
nginx -t
systemctl enable nginx --now
systemctl reload nginx

echo "[4/6] Install health watchdog"
install -m 0755 "$DEPLOY_DIR/watchdog.sh" /usr/local/bin/moosstudio-watchdog.sh
cat > /etc/systemd/system/moosstudio-watchdog.service <<'EOF'
[Unit]
Description=MoosStudio health watchdog
Wants=docker.service nginx.service
After=docker.service nginx.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/moosstudio-watchdog.sh
EOF

cat > /etc/systemd/system/moosstudio-watchdog.timer <<'EOF'
[Unit]
Description=Run MoosStudio health watchdog every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=15s
Unit=moosstudio-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now moosstudio-watchdog.timer

echo "[5/6] Health check"
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

echo "[6/6] Current container status"
docker compose ps

echo "Done. Next: run certbot after DNS propagation."
