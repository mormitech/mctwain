package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
)

// printerIcon draws a small printer as a template image (black on transparent); macOS tints it to match the
// menu bar in light and dark mode.
func printerIcon() []byte {
	const n = 44
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	ink := color.RGBA{0, 0, 0, 255}
	fill := func(x0, y0, x1, y1 int) {
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				img.Set(x, y, ink)
			}
		}
	}
	clear := func(x0, y0, x1, y1 int) {
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				img.Set(x, y, color.RGBA{})
			}
		}
	}
	// paper going in (outline)
	fill(12, 4, 32, 16)
	clear(15, 7, 29, 16)
	// printer body
	fill(4, 15, 40, 32)
	// paper coming out (outline, with a gap to the body)
	clear(12, 27, 32, 30)
	fill(12, 28, 32, 40)
	clear(15, 31, 29, 40)
	// status light
	clear(32, 19, 36, 23)
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}
