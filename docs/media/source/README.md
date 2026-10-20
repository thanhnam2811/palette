# Authentic source footage

`palette-capture.mkv` preserves the real 1920 × 1080 Shell screenshots losslessly
using FFV1. `recording.json` lists each original frame's monotonic timestamp and
native widget bounds; `events.json` lists the automation/caption events.
All clipboard contents and editor text are synthetic.

The source has a lower native frame rate than the rendered master. See
[production notes](../PRODUCTION.md) for the capture limitation and editing steps.

Re-render from the repository root:

```sh
python3 scripts/dev/render-demo.py docs/media/source
```
