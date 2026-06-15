#!/bin/bash
# Update password on VPS - RUN WITH YOUR CREDENTIALS
VPS_USER="root"
VPS_IP="37.187.139.100"
ENV_PATH="/opt/moosstudio/.env"

# Update .env file with new password
ssh -p 20018 $VPS_USER@$VPS_IP "sed -i 's/AUTH_LOGIN_CODE=.*/AUTH_LOGIN_CODE=potusdown2230/' $ENV_PATH"

# Restart Docker containers
ssh -p 20018 $VPS_USER@$VPS_IP "cd /opt/moosstudio && docker-compose down && docker-compose up -d"

# Verify update
echo "Update complete. Verify with:"
echo "ssh $VPS_USER@$VPS_IP 'grep AUTH_LOGIN_CODE $ENV_PATH'"
echo "ssh $VPS_USER@$VPS_IP 'docker logs moosstudio-app'"
echo ""
echo "Test login at: https://yourdomain.com/login"