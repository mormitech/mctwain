#!/bin/bash
# Launcher of "Uninstall mctwain.app": removes mctwain for the current user.
LABEL="com.mctwain.helper"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/mctwain"

osascript -e 'display dialog "mctwain was removed." buttons {"OK"} default button "OK" with title "mctwain"'
