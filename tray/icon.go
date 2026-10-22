package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
)

// drawPrinter draws a small printer on a 44x44 canvas. `body` colours the printer, `paper` the sheets (transparent
// leaves them as outlines cut out of the body, which is what a macOS template image needs).
func drawPrinter(body color.RGBA) *image.RGBA {
	const n = 44
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	fill := func(x0, y0, x1, y1 int) {
		for y := y0; y < y1; y++ {
			for x := x0; x < x1; x++ {
				img.Set(x, y, body)
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
	return img
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// printerTemplatePNG is black on transparent; macOS tints template images to match the menu bar.
func printerTemplatePNG() []byte { return encodePNG(drawPrinter(color.RGBA{0, 0, 0, 255})) }

// printerColorPNG is a blue printer that stays visible on both light and dark taskbars (Windows, Linux).
func printerColorPNG() []byte { return encodePNG(drawPrinter(color.RGBA{0x2F, 0x6F, 0xEB, 255})) }

// icoFromPNG wraps a PNG in an .ico file (Windows 10/11 read PNG-compressed icons).
func icoFromPNG(pngData []byte, size int) []byte {
	var buf bytes.Buffer
	w := func(v any) { _ = binary.Write(&buf, binary.LittleEndian, v) }
	w(uint16(0))              // reserved
	w(uint16(1))              // type: icon
	w(uint16(1))              // image count
	buf.WriteByte(byte(size)) // width
	buf.WriteByte(byte(size)) // height
	buf.WriteByte(0)          // palette colours
	buf.WriteByte(0)          // reserved
	w(uint16(1))              // colour planes
	w(uint16(32))             // bits per pixel
	w(uint32(len(pngData)))   // image size
	w(uint32(6 + 16))         // image offset
	buf.Write(pngData)
	return buf.Bytes()
}
