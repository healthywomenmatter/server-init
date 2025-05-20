# Server Setup Automation System

## Overview

This repository contains an automated setup system for configuring a production-ready server with:
- Node.js environment
- MySQL database
- Nginx web server
- SSL certificates (via Certbot)
- Application deployment

## Prerequisites

Before running the setup:
1. A fresh Ubuntu 20.04/22.04 server
2. SSH access with sudo privileges
3. Domain name pointed to your server (for SSL)

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/healthywomenmatter/server-init.git
cd server-init
```

### 2. Make Scripts Executable

```bash
chmod +x setup.sh setup.js setup-mysql.js
```

### 3. Run the Setup

```bash
sudo ./setup.sh
```

## What the Setup Scripts Do

### `setup.sh`
1. Installs system dependencies (Node.js, npm)
2. Installs project dependencies via npm
3. Launches the main setup script

### `setup.js` (Main Configuration)
1. Sets up:
   - Node.js environment (with your specified version)
   - MySQL database
   - Nginx web server
   - SSL certificates (if domain provided)
2. Configures:
   - Application directories
   - Environment variables
   - Process management (PM2)
3. Deploys your application

### `setup-mysql.js` (Database Setup)
1. Installs and configures MySQL
2. Creates database and user
3. Sets up proper permissions
4. Configures database connection in your `.env` file

## Interactive Setup Process

When you run `setup.sh`, you'll be guided through an interactive process:

1. **Application Type Selection**
   - Choose between Node.js or PHP application

2. **Environment Configuration**
   - Specify Node.js version (if applicable)
   - Enter domain name (optional for SSL)
   - Set up database credentials

3. **Repository Setup**
   - Provide Git repository URL
   - Specify clone directory

4. **Final Configuration**
   - Build options (for Node.js apps)
   - Development vs production mode

## Post-Setup Instructions

After successful setup:

1. **For SSL Setup**:
   - Your site will be available at `https://yourdomain.com`
   - Certificates auto-renew every 60 days

2. **For Database**:
   - Connection details saved in `.env` file
   - Credentials displayed at end of setup

3. **Application Management**:
   - Node.js apps run under PM2
   - Use `pm2 logs` to view application logs
   - Use `pm2 restart all` to restart services

## Troubleshooting

### Common Issues

1. **Certbot Fails**:
   - Ensure port 80 is open: `sudo ufw allow 80/tcp`
   - Verify DNS points to your server: `dig yourdomain.com`

2. **MySQL Connection Issues**:
   - Check `.env` file for correct credentials
   - Verify MySQL service is running: `sudo systemctl status mysql`

3. **Nginx Errors**:
   - Test configuration: `sudo nginx -t`
   - Check logs: `sudo tail -f /var/log/nginx/error.log`

### Manual Recovery

To restart the setup process:
```bash
sudo ./setup.sh
```

## Maintenance

### Updating Certificates
Certificates auto-renew, but you can manually renew:
```bash
sudo certbot renew
```

### Updating Node.js Apps
1. Pull latest changes:
```bash
cd /your/app/directory
git pull
```
2. Restart application:
```bash
pm2 restart all
```

## Security Notes

1. The setup will:
   - Generate secure database credentials
   - Set proper file permissions
   - Configure firewalls for required ports

2. After setup:
   - Remove any temporary files
   - Secure your SSH access
   - Regularly update system packages

## Support

For issues with the setup process, please:
1. Check the error logs displayed during setup
2. Open an issue in this repository
3. Include:
   - Ubuntu version
   - Node.js version
   - Exact error message

---
