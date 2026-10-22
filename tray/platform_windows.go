package main

import "errors"

// TODO(windows): open the URL with rundll32 url.dll,FileProtocolHandler and start the helper through its
// startup entry / scheduled task. Not implemented yet.
func openURL(url string) error { return errors.New("not implemented on Windows yet") }

func startHelper() error { return errors.New("not implemented on Windows yet") }
