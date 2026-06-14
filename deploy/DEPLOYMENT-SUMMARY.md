# MoosStudio VPS Deployment Summary

## Deployment Completed Successfully ✅

**Date:** June 15, 2026  
**Server:** Ubuntu 24.04 (AIC Cloud VPS)  
**IP:** 37.187.139.100  
**SSH Port:** 20018  
**Domain:** paxthautomations.website  

## What Was Deployed

- **Application:** MoosStudio (Vite + React + TypeScript + Firebase + Express)
- **Container:** Docker with health checks
- **Web Server:** Nginx (reverse proxy)
- **Firewall:** UFW (configured and enabled)
- **Auto-restart:** Docker restart policy + systemd

## Server Architecture

```
Internet → Port 80/443 → Nginx (port 80) → Docker Container (port 3000)
                         ↓
                    Port 22/20018 → SSH
```

## Firewall Configuration (UFW)

```bash
# Allowed ports
22/tcp      - SSH (internal)
20018/tcp   - SSH (external mapped)
80/tcp      - HTTP
443/tcp     - HTTPS
```

**Status:** Active and enabled on system startup

## Container Status

```bash
# Check running containers
docker ps

# Expected output:
# CONTAINER ID   IMAGE                 STATUS
# 79d5b97f9a1f   moosstudioza:latest   Up (healthy)
```

## Management Commands

### Start/Restart Application

```bash
# Restart the container
docker restart moosstudio-app

# Stop the container
docker stop moosstudio-app

# Start the container
docker start moosstudio-app
```

### View Logs

```bash
# Live logs (follow mode)
docker logs -f moosstudio-app

# Last 100 lines
docker logs --tail 100 moosstudio-app

# Logs with timestamps
docker logs -f --timestamps moosstudio-app
```

### Check Container Health

```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' moosstudio-app

# Full container info
docker inspect moosstudio-app
```

### View Resource Usage

```bash
# Container resource usage
docker stats moosstudio-app --no-stream

# Disk usage
docker system df
```

## Nginx Management

```bash
# Check nginx status
systemctl status nginx

# Restart nginx
systemctl restart nginx

# Test nginx configuration
nginx -t

# View nginx logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

## Firewall Management

```bash
# Check firewall status
ufw status verbose

# View all rules
ufw status numbered

# Disable firewall (emergency only)
ufw disable
```

## Environment Variables

The application uses the following environment variables (set via `.env` in container):

```
NODE_ENV=production
PORT=3000
FIREBASE_API_KEY=***********
FIREBASE_AUTH_DOMAIN=paxth-automations.firebaseapp.com
FIREBASE_PROJECT_ID=paxth-automations
FIREBASE_STORAGE_BUCKET=paxth-automations.appspot.com
FIREBASE_MESSAGING_SENDER_ID=939634970387
FIREBASE_APP_ID=1:939634970387:web:99e972a5ccaf07f65b9035
SESSION_SECRET=***********
ADMIN_UID=***********
ALLOWED_USER_IDS=***********
MAX_WORKERS=2
```

## Security Measures Implemented

1. ✅ **Firewall enabled** with minimal required ports
2. ✅ **Container isolation** - app runs in Docker
3. ✅ **Non-root container user** (node user)
4. ✅ **Health checks** - automatic restart on failure
5. ✅ **Environment variables** - secrets not hardcoded
6. ✅ **Nginx reverse proxy** - adds security layer
7. ✅ **Swap file** - 2GB for stability

## Accessing the Application

### Via Domain (recommended)
```
http://paxthautomations.website
http://www.paxthautomations.website
```

### Via IP (for testing)
```
http://37.187.139.100
```

### Health Check Endpoint
```bash
# Direct container access
curl http://127.0.0.1:3000/api/health

# Returns: {"ok":true,"status":"ok","ts":...}
```

## Troubleshooting

### Container Not Starting
```bash
# Check if container exists
docker ps -a

# View container logs
docker logs moosstudio-app

# Check container inspect
docker inspect moosstudio-app
```

### Application Errors
```bash
# View live logs
docker logs -f moosstudio-app

# Check if port is in use
ss -tlnp | grep 3000

# Restart container
docker restart moosstudio-app
```

### Nginx Issues
```bash
# Test configuration
nginx -t

# Restart nginx
systemctl restart nginx

# Check error logs
tail -50 /var/log/nginx/error.log
```

### Cannot Access Application
1. Check if container is running: `docker ps`
2. Check if nginx is running: `systemctl status nginx`
3. Check firewall: `ufw status`
4. Check logs: `docker logs moosstudio-app`

### SSH Lockout Prevention
If UFW blocks SSH, access the VPS via AIC Cloud console and run:
```bash
ufw allow 22/tcp
ufw allow 20018/tcp
ufw reload
```

## Backup and Recovery

### Backup Application Data
```bash
# The application stores data in Docker volumes
# List volumes
docker volume ls

# Inspect volume
docker volume inspect moosstudio_data
```

### Restore from Backup
```bash
# Stop container
docker stop moosstudio-app

# Restore data to volume
# (specific commands depend on backup method)

# Start container
docker start moosstudio-app
```

## Update Deployment

To update the application with new code:

```bash
# Navigate to project directory
cd /opt/moosstudio

# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose down
docker compose up -d --build

# Check logs
docker logs -f moosstudio-app
```

## Important Notes

1. **SSH Port:** External port 20018 maps to internal port 22
2. **UFW:** Never disable without allowing SSH first
3. **Docker:** Container auto-restarts on failure
4. **Domain:** DNS must point to 37.187.139.100 for domain access
5. **Secrets:** Never commit .env files or hardcode secrets

## Files on Server

```
/opt/moosstudio/          - Application directory
  ├── .env                - Environment variables (production)
  ├── docker-compose.yml  - Docker compose configuration
  ├── allowlist.json      - Admin allowlist
  └── moosstudio/         - Git repository

/etc/nginx/
  ├── nginx.conf          - Main nginx config
  └── sites-enabled/
      └── moosstudio.conf - App proxy configuration

/var/lib/docker/          - Docker data
```

## Deployment Script Used

The deployment was performed using `deploy/vps-full-deploy-fixed.sh` which:
- Installs Docker and dependencies
- Creates swap file for stability
- Clones fresh repository
- Builds Docker image
- Configures nginx
- Sets up firewall safely
- Starts application with health checks

---

**Deployment Status:** ✅ Complete and Verified  
**Last Verified:** June 15, 2026, 03:20 AM IST