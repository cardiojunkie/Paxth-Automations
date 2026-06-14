# SSH Connection Fix Instructions

## 🔍 **Problem Diagnosed**

Your VPS at `37.187.139.100` is **UP and RUNNING**, but:
- ❌ **Port 20018** is **BLOCKED** (not accessible from outside)
- ✅ **Port 22** is **OPEN** and **WORKING**

**Root Cause:** Your VPS provider's external firewall (OVH/cloud firewall) is blocking custom port 20018, but allowing standard SSH port 22.

## 🚀 **Immediate Solution - Connect NOW**

### **Step 1: Connect via Port 22**
```bash
ssh root@37.187.139.100 -p 22
```
Enter your root password when prompted.

### **Step 2: Once connected, run the recovery script**

First, upload the recovery script to your VPS:
```bash
# From your local machine (in a new terminal, don't close SSH session)
scp -P 22 deploy/ssh-fix-recovery.sh root@37.187.139.100:/root/
```

Then, in your SSH session on the VPS:
```bash
bash /root/ssh-fix-recovery.sh
```

This script will:
1. Ensure SSH listens on both port 22 and 20018
2. Configure UFW firewall to allow both ports
3. Restart SSH service
4. Test connectivity
5. Provide next steps

### **Step 3: Test port 20018**
After the script completes, open a **NEW terminal** and test:
```bash
ssh root@37.187.139.100 -p 20018
```

## 🔧 **If Port 20018 Still Doesn't Work**

If port 20018 is still blocked after running the script, it means your **VPS provider's external firewall** is blocking it. You need to:

### **For OVH/VPS Providers:**

1. **Log into your VPS provider's control panel**
2. **Navigate to:**
   - Network/Firewall settings
   - or "IP Failover" / "Firewall" section
3. **Add firewall rules to allow:**
   - Port 20018 (TCP)
   - Port 22 (TCP) - already working
4. **Apply/Save the rules**

### **Alternative: Just Use Port 22**

If you can't open port 20018, simply use port 22 going forward:
```bash
ssh root@37.187.139.100 -p 22
```

You can also update your SSH config for easier access:

**Create/edit `~/.ssh/config`:**
```
Host moosstudio
    HostName 37.187.139.100
    User root
    Port 22
```

Then just run:
```bash
ssh moosstudio
```

## 📋 **Quick Reference Commands**

### **Check if VPS is up:**
```bash
ping -c 4 37.187.139.100
```

### **Test port connectivity:**
```bash
# Windows PowerShell
Test-NetConnection -ComputerName 37.187.139.100 -Port 20018
Test-NetConnection -ComputerName 37.187.139.100 -Port 22

# Linux/Mac
nc -zv 37.187.139.100 20018
nc -zv 37.187.139.100 22
```

### **Connect via SSH:**
```bash
# Port 22 (working)
ssh root@37.187.139.100 -p 22

# Port 20018 (if you get it working)
ssh root@37.187.139.100 -p 20018
```

### **Upload files to VPS:**
```bash
# Using SCP
scp -P 22 localfile.txt root@37.187.139.100:/remote/path/

# Using SFTP
sftp -P 22 root@37.187.139.100
```

## ⚠️ **Important Notes**

1. **Never close your SSH session** until you've confirmed you can connect via a new session
2. **Keep port 22 open** as a backup access method
3. **Your deployment scripts** configured UFW to allow both ports, but the external firewall is the issue
4. **Your website** should still be accessible at `http://paxthautomations.website` (port 80/443)

## 🆘 **Emergency Access**

If you get locked out completely:
1. Use your VPS provider's **web console** (KVM/IPMI)
2. Log in with root password
3. Check SSH status: `systemctl status sshd`
4. Check firewall: `ufw status verbose`
5. Restart SSH: `systemctl restart sshd`

## ✅ **Verification Checklist**

After fixing, verify:
- [ ] Can connect via `ssh root@37.187.139.100 -p 22`
- [ ] Can connect via `ssh root@37.187.139.100 -p 20018` (if provider firewall allows)
- [ ] Website accessible at `http://paxthautomations.website`
- [ ] UFW shows both ports allowed: `ufw status`
- [ ] SSH listening on both ports: `ss -tlnp | grep sshd`

---

**Need more help?** Check your VPS provider's documentation for opening firewall ports, or contact their support.