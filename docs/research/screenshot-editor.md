# Research: screenshot annotation

Status: **research only, nothing implemented.** Measurements were taken in the dev
shell (GNOME Shell 46, Wayland, 1280x800, scale 1) while the host was busy; treat
them as best-of-run figures and re-measure before optimising.

Baseline for comparison: popup open is 1.9-2.0 ms (E9), extension JS is 2187 lines.

## Verdict

| Piece | Feasible | Effort | Risk | Recommendation |
|---|---|---|---|---|
| Screenshot area capture | yes | S (~150 lines) | low | separate first step |
| Crop / rect / arrow / text annotation | yes | L (~900 lines total) | medium | optional, lazy-loaded |
| Pixelate, highlighter, badges, undo | yes, same engine | +S | low | after the first four |
| Copy to clipboard / save to file | yes | S | none | part of the first step |

## Measured evidence

Executed from in-shell JS, the same process an extension runs in.

| Operation | Result |
|---|---|
| `Shell.Screenshot.screenshot_area(x, y, w, h, stream)` (async, promisified) | works; writes PNG bytes to a `GOutputStream`, no D-Bus, no portal, no extra permission |
| Capture 400x300 | 19-23 ms, 38.9 KB PNG |
| Capture 1280x800 | 190-206 ms |
| Cairo `ImageSurface.createFromPNG` 1280x800 | 22 ms |
| Draw 1 highlight + 2 arrows on 1280x800 | 5 ms |
| Pango text draw | 0.1-0.7 ms per layout; first call ~48 ms (font map init) |
| PNG encode 1280x800 / synthetic 4K | 157 ms / 285 ms |
| `gjs` + cairo + pango process | 0.04 s start, 25 MB RSS |
| `St.Clipboard.set_content(mime, bytes)` | present; an exported PNG can go straight to the clipboard |

Binding notes: GJS cairo here is camelCase (`createFromPNG`, `writeToPNG`,
`getWidth`) and does not expose `createForData`, so pixels travel as PNG
files/streams, not as raw buffers.

## 1. Capture

`Shell.Screenshot` is available in-process and its area method is async.
Coordinates are logical; the returned image is at physical resolution, which is
what we want on HiDPI - needs a 2x screen test before shipping.

Capture is the slowest single step at full screen (190-206 ms at 1280x800, likely
350-450 ms at 1080p). The flow must therefore close the popup first, show a
"Capturing..." state, and only then display the editor.

Area selection is a fullscreen overlay: dimmed stage actor, rubber-band rectangle
with handles, `Enter`/click to confirm, `Esc` to cancel, monitor picked from the
pointer. This is the same modal-grab pattern the popup already uses.

## 2. Annotation engine

An operation list, not a bitmap history: `{crop, rect, ellipse, arrow, text,
highlight, pixelate, badge}` with geometry, colour and width. Rendering happens
with Cairo (image) plus PangoCairo (text); undo/redo is pop/push on the list, so
it costs no image copies. Crop is an op too, applied at export time.

Preview is a `St.DrawingArea` that paints the source surface scaled to the panel
width and replays the ops on every repaint (~5 ms at 1280x800, text < 1 ms after
the first layout). During a drag only the rubber band changes.

## 3. Export

PNG encoding dominates: 157 ms at 1280x800, 285 ms at 4K. Encode in a child
process (`gjs`, 0.04 s, 25 MB) fed with `{source png, ops, output path}`; the
shell only receives the finished path, so the compositor never blocks and the
shell never holds a full-resolution surface.

Output goes to the clipboard as `image/png` (`St.Clipboard.set_content`), which
means it immediately shows up in the existing history with a thumbnail - a
genuinely nice integration. Optional save to `~/Pictures/Screenshots`.

## 4. Features beyond the four requested

- pixelate/blur for hiding secrets (cheap: scaled-down/up draw with nearest filter)
- highlighter (thick translucent stroke) and ellipse
- numbered badges 1/2/3, the usual bug-report annotation
- undo/redo, colour/width presets (3-4 colours, 2 widths)
- annotate an image already in the clipboard history (same engine, source from the store)
- delay capture (3/5 s) for menus and hover states

Deliberately skipped: freehand pen, stickers, OCR (external dependency), video
capture, cloud upload.

## 5. Performance rules for this work

- Heavy modules (`annotate.js`, the annotator UI) are loaded with a dynamic
  `import()` on first use; zero cost at login and for users who never open it.
- Only a downscaled surface lives in the shell (<= 1600 px wide, ~6 MB); the
  full-resolution image is path + ops, decoded again in the export process.
- Release surfaces, ops and the source surface on close.
- No capture at extension start, no background indexing, no polling.
- Benchmarks before optimising: E16 capture per area size, E17 export wall time,
  E18 shell RSS delta while the editor is open.

## 6. Risks

- **Scope**: a screenshot annotator is roughly 40% of the current codebase on its
  own; it is a review question on extensions.gnome.org.
- **Privacy**: the capability is sensitive even though capture is user-initiated;
  document it in the README.
- **Screenshot API**: `Shell.Screenshot` is shell-internal and has changed across
  GNOME versions; fine for the 46-only support policy, but needs a runtime guard.
- **HiDPI / multi-monitor**: logical vs physical coordinates, and the overlay must
  cover the right monitor.
- **Text tool input**: needs a small `St.Entry` overlay on the stage; focus and
  grab handling must not fight the annotator's own modal grab.
