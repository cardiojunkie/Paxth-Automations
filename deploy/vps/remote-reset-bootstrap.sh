#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/moosstudio"
SWAPFILE="/swapfile"

echo "[1/8] Installing base packages"
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release git ufw fail2ban nginx jq

if ! command -v docker >/dev/null 2>&1; then
  echo "[2/8] Installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
    tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable docker --now

echo "[3/8] Hard reset old deployment artifacts"
if [ -d "$APP_ROOT" ]; then
  if [ -f "$APP_ROOT/deploy/vps/docker-compose.yml" ]; then
    cd "$APP_ROOT/deploy/vps"
    docker compose down --volumes --remove-orphans || true
  fi
fi

docker rm -f moosstudio-app 2>/dev/null || true
docker image rm moosstudioza:latest 2>/dev/null || true

rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT"

echo "[4/8] Recreate persistent folders"
mkdir -p "$APP_ROOT/harvest"
mkdir -p "$APP_ROOT/jobs"
mkdir -p "$APP_ROOT/outputs"
mkdir -p "$APP_ROOT/images"
mkdir -p "$APP_ROOT/sku-index"
mkdir -p "$APP_ROOT/settings"

echo "[5/8] Ensure 2GB swap exists"
if ! swapon --show | grep -q "$SWAPFILE"; then
  if [ ! -f "$SWAPFILE" ]; then
    fallocate -l 2G "$SWAPFILE"
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE"
  fi
  swapon "$SWAPFILE"
fi
if ! grep -q "^$SWAPFILE" /etc/fstab; then
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
fi

echo "[6/8] Firewall baseline"
ufw allow OpenSSH
ufw allow 20018/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable fail2ban --now

echo "[7/8] Prepare nginx"
rm -f /etc/nginx/sites-enabled/default

if [ ! -f "$APP_ROOT/deploy/vps/nginx-moosstudio.conf" ]; then
  echo "Nginx app config not found yet (expected after code upload)."
fi

echo "[8/8] Bootstrap complete"
echo "Next: upload fresh code to $APP_ROOT, create $APP_ROOT/.env and $APP_ROOT/settings/allowlist.json, then run remote-deploy.sh"
