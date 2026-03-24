#!/bin/bash
set -e

# OpenClaw Monitor - Install script (user-level systemd daemon)
# Usage: ./install.sh [install|uninstall|status|restart]

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="openclaw-monitor"
SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"

# Read port from config.yaml or default
PORT=$(python3 -c "
import yaml
try:
    with open('${PROJECT_DIR}/config.yaml') as f:
        cfg = yaml.safe_load(f)
    print(cfg.get('server', {}).get('port', 7777))
except:
    print(7777)
" 2>/dev/null || echo 7777)

install() {
    echo "🟢 OpenClaw Monitor - Installing..."

    # Check node
    if ! command -v node &>/dev/null; then
        echo "❌ Node.js not found. Please install Node.js first."
        exit 1
    fi

    # Install dependencies
    echo "📦 Installing dependencies..."
    cd "$PROJECT_DIR"
    npm install --production 2>/dev/null

    # Build bundle if esbuild is available
    if command -v npx &>/dev/null; then
        echo "🔨 Building bundle..."
        mkdir -p /tmp/esbuild-fix
        cp "$PROJECT_DIR/public/monitor-app.js" /tmp/esbuild-fix/app.js
        cd /tmp/esbuild-fix
        npx esbuild app.js --bundle --format=esm --outfile="$PROJECT_DIR/public/bundle.js" 2>/dev/null && echo "   ✅ Bundle built" || echo "   ⚠️  Bundle build skipped (esbuild not available)"
        cd "$PROJECT_DIR"
    fi

    # Create systemd user directory
    mkdir -p "$HOME/.config/systemd/user"

    # Create service file
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=OpenClaw Monitor 3D
After=network-online.target openclaw-gateway.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=$(which node) server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
Environment=NODE_ENV=production
Environment=HOME=${HOME}

[Install]
WantedBy=default.target
EOF

    # Reload, enable, and start
    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME"
    systemctl --user start "$SERVICE_NAME"

    # Enable lingering for user (so service starts at boot without login)
    loginctl enable-linger "$(whoami)" 2>/dev/null || true

    echo ""
    echo "✅ Installed and started!"
    echo "   Service: ${SERVICE_NAME}"
    echo "   Port:    ${PORT}"
    echo "   URL:     http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${PORT}"
    echo ""
    echo "Commands:"
    echo "   systemctl --user status ${SERVICE_NAME}"
    echo "   systemctl --user restart ${SERVICE_NAME}"
    echo "   journalctl --user -u ${SERVICE_NAME} -f"
}

uninstall() {
    echo "🗑️  Uninstalling OpenClaw Monitor..."
    systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload
    echo "✅ Uninstalled."
}

status() {
    systemctl --user status "$SERVICE_NAME" 2>/dev/null || echo "Service not installed."
}

case "${1:-install}" in
    install)   install ;;
    uninstall) uninstall ;;
    status)    status ;;
    restart)
        systemctl --user restart "$SERVICE_NAME"
        echo "🔄 Restarted."
        ;;
    *)
        echo "Usage: $0 {install|uninstall|status|restart}"
        exit 1
        ;;
esac
