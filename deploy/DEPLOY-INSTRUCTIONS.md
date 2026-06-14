# Complete VPS Deployment - Quick Start

## What I created for you

✅ **deploy/vps-full-deploy.sh** - Automated script that does all 13 steps
- Includes all your secrets (AI Credits, Firebase, generated session keys)
- Handles DNS wait, SSL cert, firewall, Docker, everything

## Step 1: Set up DNS FIRST (do this now while waiting)

Go to your domain registrar for **paxthautomations.website** and add these DNS records:

```
Type: A
Host: @
Value: 37.187.139.100
TTL: 300 or Auto

Type: A  
Host: www
Value: 37.187.139.100
TTL: 300 or Auto
```

**DNS takes 5-15 minutes to propagate.** The script will wait for it.

## Step 2: Upload and run the script

### Option A: Direct upload (recommended)

Open PowerShell in the project folder and run:

```powershell
scp -P 20018 deploy/vps-full-deploy.sh root@37.187.139.100:/root/
```

When prompted, enter password: `6BsbUcvRBc_D44C6`

Then SSH in:

```powershell
ssh root@37.187.139.100 -p 20018
```

Run the script:

```bash
chmod +x /root/vps-full-deploy.sh
bash /root/vps-full-deploy.sh
```

### Option B: Manual copy-paste (if SCP fails)

1. SSH into VPS:
   ```powershell
   ssh root@37.187.139.100 -p 20018
   ```

2. Create the script:
   ```bash
   nano /root/vps-full-deploy.sh
   ```

3. Copy the entire content of `deploy/vps-full-deploy.sh` from VSCode and paste into nano
   - Press Ctrl+X, then Y, then Enter to save

4. Run it:
   ```bash
   chmod +x /root/vps-full-deploy.sh
   bash /root/vps-full-deploy.sh
   ```

## What happens when you run it

The script will:
1. Install Docker, nginx, certbot
2. Remove all old deployment residue
3. Clone your GitHub repo fresh
4. Create .env.prod with all secrets
5. Build Docker image (~5-10 minutes)
6. Start the app container
7. Configure nginx reverse proxy
8. Wait for DNS propagation
9. Get Let's Encrypt HTTPS certificate
10. Set up firewall (SSH, HTTP, HTTPS only)
11. Show you the final status

## After deployment completes

The script will print:
- Your app URL: https://paxthautomations.website
- Your AUTH_LOGIN_CODE (save this!)
- How to view logs and restart

## If something goes wrong

The script shows logs automatically. If you need more:

```bash
cd /opt/moosstudio
docker compose logs --tail=200 app
```

## DNS not propagated yet?

If DNS isn't ready when script runs, you can manually add HTTPS later:

```bash
certbot --nginx -d paxthautomations.website -d www.paxthautomations.website
```

## Security reminder

After first successful deployment:
1. Change root password: `passwd`
2. Set up SSH key authentication
3. Delete the script: `rm /root/vps-full-deploy.sh`
