# VPS Deployment (Clean Rebuild)

This folder contains a destructive reset + clean redeploy path for MoosStudio on Ubuntu 24.04.

## 0) Security first

You exposed root credentials in chat history. Rotate these immediately after first login:

1. Change root password.
2. Create SSH key auth.
3. Disable password login in sshd after key auth works.

## 1) DNS setup for paxthautomations.website

If your registrar UI is confusing, follow this exact target state:

1. Create an `A` record:
- Host/Name: `@`
- Value: `37.187.139.100`
- TTL: Auto or 300

1. Create another `A` record for `www`:
- Host/Name: `www`
- Value: `37.187.139.100`
- TTL: Auto or 300

1. Do not add `AAAA` yet (optional later after IPv6 inbound is confirmed).

## 2) Copy code to VPS

From your local project root:

```bash
scp -P 20018 -r . root@37.187.139.100:/opt/moosstudio
```

## 3) Run reset/bootstrap on VPS

SSH in:

```bash
ssh root@37.187.139.100 -p 20018
```

Then run:

```bash
cd /opt/moosstudio/deploy/vps
chmod +x remote-reset-bootstrap.sh remote-deploy.sh
./remote-reset-bootstrap.sh
```

## 4) Create production env and allowlist

```bash
cd /opt/moosstudio/deploy/vps
cp .env.prod.example .env.prod
```

Edit `.env.prod` with real secrets:

- `AI_CREDITS_API_KEY`
- `SESSION_SECRET` (32+ chars)
- `AUTH_LOGIN_CODE` (12+ chars)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (single-line JSON)

Create allowlist with your admin email:

```bash
cat > /opt/moosstudio/deploy/vps/data/settings/allowlist.json << 'EOF'
[
  {
    "email": "you@example.com",
    "role": "admin",
    "addedAt": "2026-06-14T00:00:00Z"
  }
]
EOF
```

## 5) Deploy app

```bash
cd /opt/moosstudio/deploy/vps
./remote-deploy.sh
```

## 6) Enable HTTPS (Let's Encrypt)

After DNS resolves to your VPS:

```bash
apt-get update && apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d paxthautomations.website -d www.paxthautomations.website
```

Choose redirect to HTTPS when asked.

## 7) Verify

```bash
curl -I https://paxthautomations.website/api/health
docker compose -f /opt/moosstudio/deploy/vps/docker-compose.yml ps
docker compose -f /opt/moosstudio/deploy/vps/docker-compose.yml logs --tail=200 app
```

## 8) Useful operations

Restart app:

```bash
docker compose -f /opt/moosstudio/deploy/vps/docker-compose.yml restart app
```

Update after code changes:

```bash
cd /opt/moosstudio/deploy/vps
docker compose build --no-cache
docker compose up -d
```
