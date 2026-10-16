# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Clipboard history for GNOME Shell 46: text and images, deduplication by content
  hash, instant search, pinning, quick paste (`Alt+1..9`), quick filters, preview
  pane.
- Emoji picker in the same popup (`Super`+`.` by default): 1898 emoji generated
  from Unicode 15.1 `emoji-test.txt`, search by name, group filters, insertion
  through the clipboard and the existing paste path. Data is committed as
  `extension/data/emoji.json`; `scripts/gen-emoji.js` regenerates it.
- Shortcut rows in the preferences record the keys you press instead of asking
  for accelerator syntax; `Backspace` clears a shortcut.
- Popup at the pointer or centred, with a virtualised row pool: ~2 ms to open at
  50 or 500 entries.
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

### Fixed

- Clicking outside the popup now closes it. The old check compared the event
  source with the backdrop, but `clutter_event_get_source()` is only set for
  `ENTER`/`LEAVE` events; the handler now tests whether the event actor is inside
  the popup box.

### Planned

- Recently used emoji first, and skin-tone variants (v1 ships the 1898 base emoji
  only).
