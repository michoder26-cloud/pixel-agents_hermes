#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_SRC="$PROJECT_DIR/systemd/pixel-office.service"
SERVICE_DST="/etc/systemd/system/pixel-office.service"

NODE_PATH=$(which node 2>/dev/null || echo "/usr/local/bin/node")
WORK_DIR="$PROJECT_DIR/pixel-agents"

if [ ! -f "$WORK_DIR/dist/cli.js" ]; then
    echo "ERROR: dist/cli.js not found. Run 'npm run build' first."
    exit 1
fi

# Generate service file with correct paths
cat > "$SERVICE_DST" << EOF
[Unit]
Description=Pixel Agents Office (Hermes bridge) - standalone
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$WORK_DIR
ExecStart=$NODE_PATH dist/cli.js --host 0.0.0.0 --port 3100
Restart=always
RestartSec=5
Environment=HOME=$HOME
Environment=NODE_ENV=production
StandardOutput=append:$HOME/pixel-office.log
StandardError=append:$HOME/pixel-office.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pixel-office
systemctl restart pixel-office
echo "✓ pixel-office.service installed, enabled, and started"
