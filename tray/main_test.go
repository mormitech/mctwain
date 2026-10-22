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

func TestIconIsAPNG(t *testing.T) {
	b := printerIcon()
	if len(b) < 8 || string(b[1:4]) != "PNG" {
		t.Fatal("printerIcon must return PNG bytes")
	}
}
