#!/bin/bash
# Launcher of "Install mctwain.app": installs mctwain for the current user and starts it at login.
LABEL="com.mctwain.helper"
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
APP="$HOME/Library/Application Support/mctwain"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/mctwain"

fail() {
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with icon stop with title \"mctwain\""
  exit 1
}

mkdir -p "$APP" "$LOGS" "$HOME/Library/LaunchAgents" || fail "Could not create the mctwain folders."

# Stop a previous version if one is running.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null

cp "$RES/mctwain" "$APP/mctwain" || fail "Could not copy mctwain."
chmod +x "$APP/mctwain"
xattr -dr com.apple.quarantine "$APP/mctwain" 2>/dev/null

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP/mctwain</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>MCTWAIN_ALLOWED_ORIGINS</key><string>__ALLOWED_ORIGINS__</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$LOGS/mctwain.log</string>
  <key>StandardErrorPath</key><string>$LOGS/mctwain.log</string>
</dict>
</plist>
PLISTEOF

launchctl bootstrap "gui/$(id -u)" "$PLIST" || fail "Could not start mctwain. See $LOGS/mctwain.log."

osascript -e 'display dialog "mctwain is installed and running. It starts automatically at login.\n\nYou can go back to the web page now." buttons {"OK"} default button "OK" with title "mctwain"'
