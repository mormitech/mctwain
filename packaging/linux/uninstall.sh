#!/bin/sh
# Removes mctwain for the current user.
systemctl --user disable --now mctwain.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/mctwain.service"
rm -rf "$HOME/.local/share/mctwain"
systemctl --user daemon-reload 2>/dev/null || true
echo "mctwain was removed."
