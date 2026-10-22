package main

import "errors"

// TODO(linux): open the URL with xdg-open and start the helper with `systemctl --user start mctwain`.
// Not implemented yet.
func openURL(url string) error { return errors.New("not implemented on Linux yet") }

func startHelper() error { return errors.New("not implemented on Linux yet") }
