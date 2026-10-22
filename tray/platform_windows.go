package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// All install methods (installer, Scoop, zip) put start.vbs here. It starts the helper and the tray, hidden.
func startScript() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "mctwain", "start.vbs")
}

func openURL(url string) error {
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

// startHelper runs the same launcher as the startup entry, so "Start mcTwain" behaves like logging in.
func startHelper() error {
	script := startScript()
	if _, err := os.Stat(script); err != nil {
		return errors.New("mcTwain is not installed (" + script + " not found)")
	}
	cmd := exec.Command("wscript.exe", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

// The Windows tray wants an .ico file.
func trayIcon() []byte { return icoFromPNG(printerColorPNG(), 44) }
