#!/usr/bin/env bash
set -euo pipefail

# Update the production login access code without committing the secret.
# Usage:
#   AUTH_LOGIN_CODE='new-private-code' ./deploy/update_password.sh
# Or run interactively and enter the code at the prompt.

VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-37.187.139.100}"
VPS_PORT="${VPS_PORT:-20018}"
APP_ROOT="${APP_ROOT:-/opt/moosstudio}"
ENV_PATH="${ENV_PATH:-$APP_ROOT/.env}"
COMPOSE_DIR="${COMPOSE_DIR:-$APP_ROOT/deploy/vps}"

if [ -z "${AUTH_LOGIN_CODE:-}" ]; then
  read -r -s -p "New AUTH_LOGIN_CODE: " AUTH_LOGIN_CODE
  echo
fi

if [ "${#AUTH_LOGIN_CODE}" -lt 12 ]; then
  echo "AUTH_LOGIN_CODE must be at least 12 characters." >&2
  exit 1
fi

REMOTE="${VPS_USER}@${VPS_HOST}"

printf '%s' "$AUTH_LOGIN_CODE" | ssh -p "$VPS_PORT" "$REMOTE" \
  "set -euo pipefail
   tmp=\$(mktemp)
   cat > \"\$tmp\"
   touch '$ENV_PATH'
   chmod 600 '$ENV_PATH'
   code=\$(cat \"\$tmp\")
   awk -v code=\"\$code\" '
     BEGIN { updated = 0 }
     /^AUTH_LOGIN_CODE=/ {
       print \"AUTH_LOGIN_CODE=\" code
       updated = 1
       next
     }
     { print }
     END {
       if (!updated) print \"AUTH_LOGIN_CODE=\" code
     }
   ' '$ENV_PATH' > '$ENV_PATH.tmp'
   cat '$ENV_PATH.tmp' > '$ENV_PATH'
   rm -f '$ENV_PATH.tmp'
   rm -f \"\$tmp\"
   cd '$COMPOSE_DIR'
   docker compose up -d --no-build app
   docker compose restart app
   curl -fsS http://127.0.0.1:3000/api/health >/dev/null"

echo "Access code updated and app health check passed."
