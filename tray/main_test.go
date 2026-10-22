package main

import "testing"

func TestViewNotRunning(t *testing.T) {
	v := newView(nil, nil)
	if v.Running || v.Title != "mcTwain not running" {
		t.Fatalf("got %+v", v)
	}
	if v := newView(&status{OK: false}, nil); v.Running {
		t.Fatal("a status without ok must count as not running")
	}
}

func TestViewRunningWithScanners(t *testing.T) {
	v := newView(&status{OK: true, Version: "0.3.0"}, []device{{Name: "A", Model: "Model A"}, {Name: "B"}})
	if v.Title != "mcTwain v0.3.0 running" || !v.Running {
		t.Fatalf("title: %+v", v)
	}
	if v.Header != "2 scanners found" {
		t.Fatalf("header: %q", v.Header)
	}
	if len(v.Scanners) != 2 || v.Scanners[0] != "Model A" || v.Scanners[1] != "B" {
		t.Fatalf("scanners: %v", v.Scanners)
	}
}

func TestViewHeaders(t *testing.T) {
	st := &status{OK: true, Version: "1"}
	if h := newView(st, nil).Header; h != "No scanners found" {
		t.Fatal(h)
	}
	if h := newView(st, []device{{Name: "A"}}).Header; h != "1 scanner found" {
		t.Fatal(h)
	}
}

func TestViewSummarisesTooManyScanners(t *testing.T) {
	var many []device
	for i := 0; i < maxScanners+3; i++ {
		many = append(many, device{Name: "S"})
	}
	v := newView(&status{OK: true, Version: "1"}, many)
	if len(v.Scanners) != maxScanners {
		t.Fatalf("expected %d slots, got %d", maxScanners, len(v.Scanners))
	}
	if last := v.Scanners[len(v.Scanners)-1]; last != "+ 4 more" {
		t.Fatalf("last slot: %q", last)
	}
}

func TestIconsArePNGs(t *testing.T) {
	for name, b := range map[string][]byte{"template": printerTemplatePNG(), "colour": printerColorPNG()} {
		if len(b) < 8 || string(b[1:4]) != "PNG" {
			t.Fatalf("%s icon must be PNG bytes", name)
		}
	}
}

func TestIcoWrapsThePNG(t *testing.T) {
	p := printerColorPNG()
	ico := icoFromPNG(p, 44)
	if ico[2] != 1 || ico[4] != 1 { // type icon, one image
		t.Fatalf("bad ICO header: % x", ico[:6])
	}
	if ico[6] != 44 || ico[7] != 44 {
		t.Fatalf("bad ICO size: %d x %d", ico[6], ico[7])
	}
	if got := int(ico[14]) | int(ico[15])<<8 | int(ico[16])<<16 | int(ico[17])<<24; got != len(p) {
		t.Fatalf("directory says %d bytes, PNG has %d", got, len(p))
	}
	if string(ico[22:26]) != "\x89PNG" {
		t.Fatal("PNG data must start at offset 22")
	}
	if len(ico) != 22+len(p) {
		t.Fatalf("ICO length %d, want %d", len(ico), 22+len(p))
	}
}
