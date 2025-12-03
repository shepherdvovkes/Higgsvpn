#!/bin/bash
# Deploy and restart bosonserver on remote server

set -e

SERVER="mail.s0me.uk"
SERVER_USER="${SSH_USER:-vovkes}"
BOSONSERVER_DIR="${BOSONSERVER_DIR:-~/Higgsvpn/bosonserver}"

echo "=== Deploying bosonserver to $SERVER ==="
echo ""

# Build locally
echo "1. Building bosonserver..."
npm run build

# Copy files to server
echo ""
echo "2. Copying files to server..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  --exclude '.env' \
  dist/ \
  ${SERVER_USER}@${SERVER}:${BOSONSERVER_DIR}/dist/

rsync -avz \
  public/ \
  ${SERVER_USER}@${SERVER}:${BOSONSERVER_DIR}/public/

# Restart server
echo ""
echo "3. Restarting bosonserver on server..."
ssh ${SERVER_USER}@${SERVER} << 'EOF'
  cd ~/Higgsvpn/bosonserver
  
  # Try to find and restart the process
  if command -v pm2 &> /dev/null; then
    echo "Restarting with PM2..."
    pm2 restart bosonserver || pm2 start dist/index.js --name bosonserver
  elif systemctl list-units --type=service | grep -q bosonserver; then
    echo "Restarting with systemd..."
    sudo systemctl restart bosonserver
  else
    echo "Finding and restarting process..."
    PID=$(ps aux | grep "node.*dist/index.js" | grep -v grep | awk '{print $2}')
    if [ -n "$PID" ]; then
      echo "Killing process $PID..."
      kill $PID
      sleep 2
    fi
    echo "Starting bosonserver..."
    nohup node dist/index.js > logs/bosonserver.log 2>&1 &
    echo "Bosonserver restarted. PID: $!"
  fi
EOF

echo ""
echo "=== Deployment complete ==="
echo "Check logs: ssh ${SERVER_USER}@${SERVER} 'tail -f ${BOSONSERVER_DIR}/logs/bosonserver.log'"

