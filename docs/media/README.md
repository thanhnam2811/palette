# Palette in action

[![Palette product showcase](palette-demo.gif)](palette-demo.mp4)

[Watch/download the 1080p MP4](palette-demo.mp4). A 15-second showcase with
continuous real UI interaction, eased camera motion, restrained violet lighting
and a soft loop join. The GIF preview is 960 px wide at 16 fps.

The isolated GNOME session was captured at 1920 × 1080 using timestamped genuine
Shell frames. Native 30 fps PipeWire recording failed in this environment; source
capture is slower than the 30 fps **rendered master**. This is an edited authentic
capture fallback, not a claim of native 30 fps recording. See the
[production and QA notes](PRODUCTION.md) and [timing manifest](recording.json).

Configured shortcuts are shown; new installations start without shortcuts.
All clipboard content was created for the demo. The feature gallery below is a
separate set of captioned stills with unmodified originals available alongside it.

| Clipboard history | Instant search |
| --- | --- |
| ![History](screenshots/01-history.png) | ![Search](screenshots/02-search.png) |
| Image preview | Multi-line text preview |
| ![Image preview](screenshots/03-image-preview.png) | ![Text preview](screenshots/04-text-preview.png) |
| Pin and filter | Emoji browser |
| ![Pinned snippets](screenshots/05-pinned.png) | ![Emoji](screenshots/06-emoji.png) |
| Build an emoji run | Private mode |
| ![Emoji run](screenshots/07-emoji-run.png) | ![Private mode](screenshots/08-private-mode.png) |

![Paste back into a real GTK application](screenshots/09-quick-paste.png)

The film verifies pinning, a saved message pasting into a real GTK editor, and
the selected `🚀` arriving in both clipboard history and that editor. The still
gallery separately demonstrates multi-emoji staging and private mode. Private mode does
not erase saved history or clear the system clipboard.

[Original full-screen captures](screenshots/raw/) are unmodified; the gallery
adds cropping, headings and hints outside the captured UI. The still-gallery manifest
is [capture.json](capture.json). [Light preferences](screenshots/raw/preferences-light.png)
shows the native settings window separately from the walkthrough.

To regenerate, start a fresh isolated session and run:

```sh
PALETTE_VMON=1920x1080 scripts/dev/session.sh
python3 scripts/make-demo.py /tmp/palette-session.XXXXXX
```

Capture dependencies: Pillow, DejaVu Sans, and ffmpeg, in addition to the
[GNOME testing prerequisites](../TESTING.md). These are development tools,
not runtime dependencies of the extension. The script refuses host installation
paths and only clears the synthetic history in its explicitly isolated session.


To render the supplied lossless capture without running GNOME:

```sh
python3 scripts/dev/render-demo.py docs/media/source
```

The still gallery is generated separately with
`python3 scripts/dev/gallery.py /tmp/palette-session.XXXXXX` in a 1280 × 800 session.
