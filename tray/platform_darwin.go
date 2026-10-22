package main

import (
	"errors"
	"os"
	"os/exec"
)

func openURL(url string) error { return exec.Command("open", url).Start() }

// startHelper starts the Homebrew service that runs the helper (also at login).
func startHelper() error {
	for _, brew := range []string{"/opt/homebrew/bin/brew", "/usr/local/bin/brew"} {
		if _, err := os.Stat(brew); err == nil {
			return exec.Command(brew, "services", "start", "mctwain").Start()
		}
	}
	return errors.New("Homebrew not found; start mcTwain another way")
}
