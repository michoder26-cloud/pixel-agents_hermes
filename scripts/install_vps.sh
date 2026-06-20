#!/bin/bash
set -e

echo "========================================"
echo " Pixel Agent Office — VPS Installer"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${YELLOW}[1/6]${NC} Building Office Server..."
cd "$PROJECT_DIR/pixel-agents"
npm install --legacy-peer-deps 2>&1 | tail -3
cd webview-ui && npm install --legacy-peer-deps 2>&1 | tail -3 && cd ..
cd server && npm install --legacy-peer-deps 2>&1 | tail -3 && cd ..
npm run build 2>&1 | tail -3
echo -e "${GREEN}✓ Office Server built${NC}"

echo -e "${YELLOW}[2/6]${NC} Installing Hermes plugin..."
bash "$SCRIPT_DIR/install_plugin.sh"
echo -e "${GREEN}✓ Plugin installed${NC}"

echo -e "${YELLOW}[3/6]${NC} Installing bridge script..."
mkdir -p ~/.hermes
cp "$PROJECT_DIR/bridge/pixel_agents_bridge.py" ~/.hermes/pixel_agents_bridge.py
echo -e "${GREEN}✓ Bridge installed${NC}"

echo -e "${YELLOW}[4/6]${NC} Setting up systemd service..."
bash "$SCRIPT_DIR/setup_systemd.sh"
echo -e "${GREEN}✓ Systemd service configured${NC}"

echo -e "${YELLOW}[5/6]${NC} Opening firewall port 3100..."
if command -v ufw &> /dev/null; then
    ufw allow 3100/tcp 2>/dev/null || true
    echo -e "${GREEN}✓ Firewall updated${NC}"
else
    echo -e "${YELLOW}⚠ ufw not found, skip firewall${NC}"
fi

echo -e "${YELLOW}[6/6]${NC} Verifying..."
sleep 3
if curl -s http://127.0.0.1:3100/api/health | grep -q '"ok"'; then
    VPS_IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN} ✅ Installation Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e " Open in browser: ${GREEN}http://${VPS_IP}:3100${NC}"
    echo ""
    echo " Next steps:"
    echo "   1. Run: hermes        (start a session)"
    echo "   2. Watch the office   (characters will appear)"
    echo ""
else
    echo -e "${RED}⚠ Office may not have started correctly.${NC}"
    echo "  Check: systemctl status pixel-office"
    echo "  Logs:  tail -30 /root/pixel-office.log"
fi
