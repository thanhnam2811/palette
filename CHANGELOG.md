# Changelog

## Unreleased — EGO release candidate

- Organize technical documentation under docs/ with a navigation index.
- Replace the old demo with a captioned feature walkthrough, fresh screenshots, GIF and MP4.

- Keep password-manager clipboard exclusions when GNOME preserves an exiting owner.
- Include the Unicode data license in the release package.
- Original Palette logo, symbolic panel icon, banner, and branding guide.
- Isolated GNOME 46 test sessions built from the release ZIP, with real GTK clipboard tests.
- New-install shortcuts are unset to follow EGO clipboard rules; saved custom bindings persist.
- Panel menu now opens the emoji picker directly.


All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Clipboard history for GNOME Shell 46: text and images, deduplication by content
  hash, instant search, pinning, quick paste (`Alt+1..9`), quick filters, preview
  pane.
- Emoji picker in the same popup (`Super`+`.` by default): 1923 emoji generated
  from Unicode 18.0 `emoji-test.txt`, search by name, group filters, insertion
  through the clipboard and the existing paste path. Data is committed as
  `extension/data/emoji.json`; `scripts/gen-emoji.js` regenerates it.
- Shortcut rows in the preferences record the keys you press instead of asking
  for accelerator syntax; `Backspace` clears a shortcut.
- Emoji run bar: `Enter` or a click appends the selected emoji so several can be
  inserted at once (like `Win`+`.` on Windows) without losing the search; `Tab`
  walks search → run → `Paste`, the run being an editable field, and `Esc`, a
  click outside or `Enter` on `Paste` inserts and closes. Nothing reaches the
  clipboard until that insert.
- Clearing the history from the panel menu asks for confirmation and keeps
  pinned entries.
- Compact density (the default): 24px rows, 12px labels and tighter padding, so
  the fixed 340px list shows 13 history lines instead of 11; a `comfortable`
  option keeps the roomier 28px rows. Density trades pixels, not milliseconds
  (E9). The emoji group chips were tightened so all ten fit one row.
- `popup-position=caret`: put the popup at the text cursor of the focused window
  (Windows-style) instead of the pointer, using the caret rectangle GNOME keeps
  for the input method; falls back to the pointer when the app reports none.
- Popup at the pointer or centred, with a virtualised row pool: ~2 ms to open at
  50 or 500 entries.
- Image rows draw a 128px JPEG written next to the blob when the image is copied,
  instead of decoding the full photo: the first paint of a history full of 12MP
  photos drops from ~356 ms to ~17 ms and the row RAM from ~7 MB to ~0.1 MB (E10).
  Images copied before this version fall back to the blob until a background pass
  fills their thumbnail in.
- Preferences window and GSettings schema. Private mode, excluded apps and the
  password-manager hint are honoured; data lives in `~/.local/share/palette`
  (`0600` files in a `0700` directory).
- Development harness: headless nested shell, D-Bus eval/screenshot/virtual-keyboard
  helpers, unit tests (`gjs -m test/run.js`), and the benchmarks behind
  `docs/BENCH.md`.

### Changed

- Renamed the extension from `clipx` to `palette` (uuid `palette@namtt`); data
  directory and GSettings schema follow the new name.
- The history shortcut now defaults to `Super+V` and is set by pressing the keys
  in the preferences.
- Clipboard content that was already present when the extension starts is no
  longer recorded unless the new `capture-on-start` setting is enabled (off by
  default).

### Fixed

- Store: replay validates every op schema (id, hash, kind, mime, size, ts,
  preview, inline, pin/touch), so one corrupt line can no longer poison the
  size accounting, evict the whole history or turn a hash into a path; invalid
  lines are skipped and compaction repairs the log.
- Store: a failed blob write now drops the entry and commits no add op, instead
  of leaving a log entry whose content is missing.
- Store: a re-enabled extension waits for the previous store to finish opening
  or closing, so a queued compaction can no longer overwrite the new session's
  log.
- Store: compacting an empty history deletes the log instead of calling Gio's
  replace with an empty buffer, which hangs the write queue forever.
- Capture: private mode is re-checked after the clipboard read and the hash, and
  oversized content is rejected before it is copied a second time.
- The history popup releases its modal grab (and hides the backdrop) if opening
  it throws.
- Delete in the history search now edits the query when it has text, instead of
  deleting the highlighted clipboard entry.
- The emoji picker opens before its data is read, so keys typed right after the
  shortcut are no longer swallowed by the first open; the results refilter when
  the table arrives.
- Picking an emoji no longer clears the search or jumps the selection back to the
  first cell.
- Emoji search ranks exact and whole-word name matches first.
- Clicking outside the popup now closes it. The old check compared the event
  source with the backdrop, but `clutter_event_get_source()` is only set for
  `ENTER`/`LEAVE` events; the handler now tests whether the event actor is inside
  the popup box.

### Planned

- Recently used emoji first, and skin-tone variants (v1 ships the 1923 base emoji
  only).
