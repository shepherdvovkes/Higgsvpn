#!/bin/bash
# Upload GUI file and restart server

set -e

SERVER="mail.s0me.uk"
SERVER_USER="${SSH_USER:-vovkes}"
BOSONSERVER_DIR="${BOSONSERVER_DIR:-~/Higgsvpn/bosonserver}"

echo "=== Uploading GUI to $SERVER ==="
echo ""

# Upload the HTML file
echo "1. Uploading index.html..."
rsync -avz public/index.html ${SERVER_USER}@${SERVER}:${BOSONSERVER_DIR}/public/index.html

# Restart server
echo ""
echo "2. Restarting bosonserver GUI on server..."
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
    PID=$(ps aux | grep "node.*dist/index.js\|node.*bosonserver" | grep -v grep | awk '{print $2}' | head -1)
    if [ -n "$PID" ]; then
      echo "Killing process $PID..."
      kill $PID
      sleep 2
    fi
    echo "Starting bosonserver..."
    cd ~/Higgsvpn/bosonserver
    nohup node dist/index.js > logs/bosonserver.log 2>&1 &
    echo "Bosonserver restarted. PID: $!"
  fi
EOF

echo ""
echo "=== Upload complete ==="
echo "GUI should be available at http://mail.s0me.uk:3030"

