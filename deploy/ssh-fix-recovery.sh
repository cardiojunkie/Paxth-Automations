#!/bin/bash
# SSH Recovery Script for VPS
# Run this script AFTER connecting via SSH on port 22
# Usage: ssh root@37.187.139.100 -p 22
#        Then run: bash ssh-fix-recovery.sh

set -euo pipefail

echo "========================================="
echo "  SSH Recovery Script"
echo "  Fixing SSH on port 20018"
echo "========================================="
echo ""

# Step 1: Check current SSH configuration
echo "[1/5] Checking current SSH configuration..."
echo "Current SSH ports:"
grep -E "^Port" /etc/ssh/sshd_config || echo "No custom Port settings found"
echo ""

# Step 2: Ensure SSH listens on both port 22 and 20018
echo "[2/5] Configuring SSH to listen on port 20018..."

# Backup current config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup.$(date +%Y%m%d_%H%M%S)

# Add port 20018 if not already present
if ! grep -q "^Port 20018" /etc/ssh/sshd_config; then
    echo "Port 20018" >> /etc/ssh/sshd_config
    echo "  Added Port 20018 to sshd_config"
else
    echo "  Port 20018 already configured"
fi

# Ensure port 22 is also configured
if ! grep -q "^Port 22" /etc/ssh/sshd_config; then
    echo "Port 22" >> /etc/ssh/sshd_config
    echo "  Added Port 22 to sshd_config"
fi

# Step 3: Check and configure UFW firewall
echo ""
echo "[3/5] Checking firewall configuration..."
echo "Current UFW status:"
ufw status verbose
echo ""

# Ensure UFW allows both ports
echo "Ensuring UFW allows SSH ports..."
ufw allow 22/tcp comment 'SSH Standard Port' 2>/dev/null || true
ufw allow 20018/tcp comment 'SSH Custom Port' 2>/dev/null || true

echo "Updated UFW rules:"
ufw status | grep -E "(22|20018)" || echo "WARNING: Could not verify UFW rules"
echo ""

# Step 4: Restart SSH service
echo "[4/5] Restarting SSH service..."
systemctl restart sshd
sleep 2

# Verify SSH is running
if systemctl is-active --quiet sshd; then
    echo "  ✓ SSH service is running"
else
    echo "  ✗ SSH service is NOT running!"
    systemctl status sshd --no-pager
    exit 1
fi

# Verify SSH is listening on both ports
echo ""
echo "SSH listening ports:"
ss -tlnp | grep sshd || netstat -tlnp | grep sshd || echo "WARNING: Could not verify listening ports"
echo ""

# Step 5: Test local connectivity
echo "[5/5] Testing local connectivity..."
if nc -zv 127.0.0.1 22 2>/dev/null; then
    echo "  ✓ Port 22 is accessible locally"
else
    echo "  ✗ Port 22 is NOT accessible locally"
fi

if nc -zv 127.0.0.1 20018 2>/dev/null; then
    echo "  ✓ Port 20018 is accessible locally"
else
    echo "  ✗ Port 20018 is NOT accessible locally"
fi

echo ""
echo "========================================="
echo "  SSH Recovery Complete!"
echo "========================================="
echo ""
echo "IMPORTANT NEXT STEPS:"
echo ""
echo "1. DO NOT CLOSE YOUR CURRENT SSH SESSION yet!"
echo ""
echo "2. Open a NEW terminal and test connection on port 20018:"
echo "   ssh root@37.187.139.100 -p 20018"
echo ""
echo "3. If port 20018 still doesn't work, it may be blocked by your"
echo "   VPS provider's external firewall (OVH/cloud firewall)."
echo "   In that case, continue using port 22:"
echo "   ssh root@37.187.139.100 -p 22"
echo ""
echo "4. To make port 20018 work, you may need to:"
echo "   - Log into your VPS provider's control panel"
echo "   - Open port 20018 in their firewall settings"
echo "   - Or use their API to allow the port"
echo ""
echo "5. Once you've confirmed port 20018 works, you can close"
echo "   the old SSH session."
echo ""
echo "Current SSH configuration:"
echo "  - Port 22: Standard SSH (should work)"
echo "  - Port 20018: Custom SSH (may need provider firewall config)"
echo ""