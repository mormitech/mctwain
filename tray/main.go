// mctwain tray: a menu bar / tray icon that shows whether the mcTwain helper is running and which scanners it
// found. It only reads from the helper's local HTTP API (/status and /devices); starting and stopping the
// helper is left to the operating system's service manager.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"fyne.io/systray"
)

const (
	pollEvery   = 3 * time.Second
	maxScanners = 8 // menu slots for scanners; more are summarised as "+ N more"
	mcPrintURL  = "https://mormitech.com/mctools/mcprint/"
)

func baseURL() string {
	if u := os.Getenv("MCTWAIN_URL"); u != "" {
		return u
	}
	return "http://127.0.0.1:7788"
}

type status struct {
	OK      bool   `json:"ok"`
	Version string `json:"version"`
}

type device struct {
	Name  string `json:"name"`
	Model string `json:"model"`
}

// view is everything the menu shows, derived from what the helper reported.
type view struct {
	Title    string
	Running  bool
	Header   string
	Scanners []string
}

func newView(st *status, devices []device) view {
	if st == nil || !st.OK {
		return view{Title: "mcTwain not running", Header: "No scanners (mcTwain is not running)"}
	}
	v := view{Title: fmt.Sprintf("mcTwain v%s running", st.Version), Running: true}
	switch len(devices) {
	case 0:
		v.Header = "No scanners found"
	case 1:
		v.Header = "1 scanner found"
	default:
		v.Header = fmt.Sprintf("%d scanners found", len(devices))
	}
	for i, d := range devices {
		if i == maxScanners-1 && len(devices) > maxScanners {
			v.Scanners = append(v.Scanners, fmt.Sprintf("+ %d more", len(devices)-i))
			break
		}
		name := d.Model
		if name == "" {
			name = d.Name
		}
		v.Scanners = append(v.Scanners, name)
	}
	return v
}

var client = &http.Client{Timeout: 2 * time.Second}

func getJSON(path string, into any) error {
	res, err := client.Get(baseURL() + path)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: HTTP %d", path, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(into)
}

// poll asks the helper what it is doing. It never blocks the menu: it runs in its own goroutine.
func poll() view {
	var st status
	if err := getJSON("/status", &st); err != nil {
		return newView(nil, nil)
	}
	var list struct {
		Devices []device `json:"devices"`
	}
	if err := getJSON("/devices", &list); err != nil {
		return newView(&st, nil)
	}
	return newView(&st, list.Devices)
}

func main() { systray.Run(onReady, func() {}) }

func onReady() {
	systray.SetTemplateIcon(printerIcon(), printerIcon())
	systray.SetTooltip("mcTwain")

	title := systray.AddMenuItem("mcTwain", "")
	title.Disable()
	systray.AddSeparator()
	header := systray.AddMenuItem("Scanners", "")
	header.Disable()
	slots := make([]*systray.MenuItem, maxScanners)
	for i := range slots {
		slots[i] = systray.AddMenuItem("", "")
		slots[i].Disable()
		slots[i].Hide()
	}
	systray.AddSeparator()
	start := systray.AddMenuItem("Start mcTwain", "")
	start.Hide()
	open := systray.AddMenuItem("Open mcPrint", "")
	quit := systray.AddMenuItem("Quit tray", "")

	apply := func(v view) {
		title.SetTitle(v.Title)
		header.SetTitle(v.Header)
		for i, slot := range slots {
			if i < len(v.Scanners) {
				slot.SetTitle(v.Scanners[i])
				slot.Show()
			} else {
				slot.Hide()
			}
		}
		if v.Running {
			start.Hide()
		} else {
			start.Show()
		}
	}

	go func() {
		apply(poll())
		for range time.Tick(pollEvery) {
			apply(poll())
		}
	}()

	go func() {
		for {
			select {
			case <-open.ClickedCh:
				if err := openURL(mcPrintURL); err != nil {
					fmt.Fprintln(os.Stderr, "open:", err)
				}
			case <-start.ClickedCh:
				if err := startHelper(); err != nil {
					fmt.Fprintln(os.Stderr, "start:", err)
				}
			case <-quit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}
