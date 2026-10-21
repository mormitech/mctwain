#!/bin/sh
# Installs mctwain for the current user and starts it at login (systemd user service).
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HOME/.local/share/mctwain"
UNIT_DIR="$HOME/.config/systemd/user"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd not found. Copy 'mctwain' somewhere and run it manually." >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$UNIT_DIR"
systemctl --user stop mctwain.service 2>/dev/null || true
cp "$DIR/mctwain" "$BIN_DIR/mctwain"
chmod +x "$BIN_DIR/mctwain"

cat > "$UNIT_DIR/mctwain.service" <<UNITEOF
[Unit]
Description=mctwain local scanner helper

[Service]
ExecStart=$BIN_DIR/mctwain
Environment=MCTWAIN_ALLOWED_ORIGINS=__ALLOWED_ORIGINS__
Restart=on-failure

[Install]
WantedBy=default.target
UNITEOF

systemctl --user daemon-reload
systemctl --user enable --now mctwain.service

echo "mctwain is installed and running. It starts automatically at login."
echo "Logs: journalctl --user -u mctwain"
