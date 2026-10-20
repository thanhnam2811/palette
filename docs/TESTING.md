# Isolated GNOME 46 testing

Requires GNOME Shell 46, GJS, dbus-run-session, glib-compile-schemas, unzip,
Python 3 and GTK4 (already used by preferences). Software rendering is enabled.
No sudo, host extension installation, host bus calls, or host Shell restart.

1. Run `scripts/dev/session.sh`. It builds the release ZIP and prints a unique
   `/tmp/palette-session.XXXXXX` path. Keep the terminal open.
2. Run `scripts/dev/smoke.py /tmp/palette-session.XXXXXX` from another terminal.
3. Inspect `artifacts/shell.log`, `artifacts/results.json`, and the PNG screenshots.
4. Stop with Ctrl+C in the launcher terminal. The trap terminates only its child.
5. To reload changed code, stop and start a new session, then rerun smoke tests.
   This rebuilds and installs a clean ZIP; Wayland does not hot-reload JS modules.

Every run gets its own HOME, XDG config/data/cache/state/runtime, keyfile
GSettings backend, D-Bus session and Wayland compositor/clipboard. The driver
checks the exact child PID's HOME/runtime/bus before every command and checks
the installed extension path before enabling Palette. Palette initially stays
disabled. The test-only Eval D-Bus extension is installed solely in this private
session; it is excluded from the release ZIP. Never install devtools on a normal
desktop. Only the new private bus receives the isolated activation environment; the host bus is never updated.

Examples (replace SESSION with the printed path):

```sh
scripts/dev/control.py SESSION eval 'palette.store.size'
scripts/dev/control.py SESSION shot manual.png
scripts/dev/control.py SESSION gnome-extensions prefs palette@namtt
```

Screenshots go into SESSION/artifacts. Headless Wayland clipboard owners must
have focus: the smoke driver hides overview and activates the GTK test client.
The tests use actual GTK clipboard offers, Shell widgets and a virtual keyboard.
No mocked Shell APIs are used. Session artifacts deliberately remain for review;
remove only the explicit session directory after its processes have exited.

A missing login manager, camera, screencast service or geolocation permission
can produce Shell warnings in a headless session. Distinguish these from errors
containing `palette:` or paths inside the installed Palette extension.


## Feature screenshots and walkthrough

After smoke tests, capture a product walkthrough in the same isolated session:

```sh
python3 scripts/make-demo.py /tmp/palette-session.XXXXXX
```

This resets **only that isolated session's** history to synthetic demo content.
Use `PALETTE_VMON=1920x1080 scripts/dev/session.sh` for the film. It captures
a continuous timestamped native sequence and renders the 1080p MP4 and GIF under
`docs/media/`. A lossless source archive supports re-editing without GNOME; see
[production notes](media/PRODUCTION.md). The still gallery has a separate
`scripts/dev/gallery.py` generator for a 1280 × 800 test session. The film exercises actual search, keyboard
navigation, pinning, preview, emoji staging and paste into a GTK text view. The smoke suite separately covers privacy.
Pillow, DejaVu Sans and ffmpeg are needed only for capture/export. No clipboard
or extension data belonging to the host is read or cleared.
