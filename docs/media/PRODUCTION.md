# Palette showcase — production notes

The README preview is a 15-second, silent product film built from authentic
Palette UI in a private GNOME Shell 46 Wayland session. The master is H.264,
1920 × 1080, 30 fps, YUV 4:2:0, with its MP4 index moved to the front for browser
playback. The GIF is 960 × 540 at 16 fps with one shared 192-colour palette.

## Direction and edit

The UI is the centerpiece. A fixed, restrained violet/indigo frame carries a
small Palette signature, one short benefit caption, and the relevant shortcut.
There are no title slides or scene wipes. A damped camera tracks the measured
native widget bounds, keeping filtered results centered as their popup shrinks.
Image preview dwell is retained while query preparation is trimmed into the
paste scene, so the caption always describes the visible action. Zoom is limited; the environment is blurred and dimmed around the actual UI.
The pointer is hidden because the demonstration uses keyboard navigation.

| Time | Interaction |
| --- | --- |
| 0–1.6 s | Clean history overview, subtle scale/brightness settle |
| 1.6–4.6 s | Type `invoice`, see matching items, navigate the results |
| 4.6–5.9 s | Pin a useful invoice and open the Pinned filter |
| 5.9–7.5 s | Filter images and toggle the real preview pane |
| 7.5–9.2 s | Restore a saved message into a real GTK editor |
| 9.2–12.4 s | Open emoji, search `rocket`, stage and insert `🚀` |
| 12.4–15 s | Return to history, with the minimal brand signature |

The ending eases back to the opening camera pose. Its last 0.6 seconds dissolve
to the authentic opening capture, matching the starting view and brightness.
This is an editorial loop join, not an animated or fabricated extension action.
All copy/search/selection/preview/pin/paste states in the film come from GNOME.

## Capture limitation and fallback

Native GNOME PipeWire screencasting was tried on the private session bus with
a private PipeWire daemon. The default pipeline did not start delivering frames;
a software encoding pipeline returned
`org.gnome.Shell.Screencast.Error.AllPipelinesFailed`.
The host bus, PipeWire instance and Wayland compositor were not modified.

The supported fallback records a continuous sequence of **actual 1920 × 1080
Shell screenshots**, with monotonic capture timestamps. The effective native
capture rate is lower than 30 fps and is recorded in [recording.json](recording.json).
The 30 fps master refers to the editing/rendering rate: smooth camera movement
runs between captured UI frames. No intermediate UI behavior is synthesized.
This distinction is deliberate; the output is not represented as native 30 fps
screen recording.

Only synthetic history is used. The capture driver checks the explicit private
installation path before enabling Palette. It verifies that an invoice was
pinned, the saved message reached the real editor, and the selected emoji
reached both clipboard history and the editor. No host extension reload or
clipboard manipulation is performed.

## Reproduce

Capture plus edit, from the repository root:

```sh
PALETTE_VMON=1920x1080 scripts/dev/session.sh
# In another terminal, substitute the printed directory:
python3 scripts/make-demo.py /tmp/palette-session.XXXXXX
```

The session gets an isolated HOME, bus, settings and clipboard. The driver resets
only its synthetic test history. Dependencies: GNOME Shell 46/GJS, Python with
Pillow, DejaVu Sans, and FFmpeg with libx264/FFV1 support. Native UI is not driven
through a browser or mocked API.

To re-edit the supplied lossless native capture without GNOME:

```sh
python3 scripts/dev/render-demo.py docs/media/source
```

[Source capture](source/palette-capture.mkv) is a lossless FFV1 Matroska file with
all original frames. [Source timestamps](source/recording.json) and
[automation events](source/events.json) preserve timing and real widget bounds.
The renderer extracts these frames into a private temporary directory, applies
camera/focus treatment, renders the MP4, and derives the GIF with a shared
palette and restrained ordered dithering. It also produces intermediate review
frames in that temporary directory. The source data is sufficient to reproduce
the edit; a running GNOME session is needed only to capture different behavior.

The [still gallery](README.md) has its own generator,
`scripts/dev/gallery.py`, and a separate [capture manifest](capture.json).
It does not overwrite the film.

## Review and refinement

The first render was rejected for duplicated editor chrome, distracting
background windows, and a stretched image sample. Refinement removed the extra
header bar, replaced the sample with the square logo, reduced the surrounding
brightness, added soft focus, and optimized GIF dithering/frame rate.

The next review inspected decoded GIF frames, not just pre-encode PNGs. It found
that filtering the emoji grid left a small popup too high in the frame. The
final pass records live widget geometry with each source frame and tracks that
geometry with a damped camera, keeping search and emoji results centered.

Final checks include H.264 compatibility, 1080p/30 fps/15-second duration,
fast-start metadata, complete GIF decoding, file size, key interaction frames,
lossless source frame recovery, and the decoded first/last frame difference.
Measured results are in [media QA](../validation/2026-10-20/premium-media.json).
No audio, runtime extension modifications, repository push or publication are
part of this delivery.


Export verification can be rerun with `python3 scripts/dev/check-demo.py`.
Pass `--original /tmp/palette-session.XXXXXX/artifacts/continuous-...` while the
original captures are available to compare every recovered source frame pixel
for pixel. [Encoded-frame contact sheet](qa/contact-sheet.jpg) records the
final framing review.
