# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Clipboard history for GNOME Shell 46: text and images, deduplication by content
  hash, instant search, pinning, quick paste (`Alt+1..9`), quick filters, preview
  pane.
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

### Fixed

- Clicking outside the popup now closes it. The old check compared the event
  source with the backdrop, but `clutter_event_get_source()` is only set for
  `ENTER`/`LEAVE` events; the handler now tests whether the event actor is inside
  the popup box.

### Planned

- Emoji picker on `Super`+`.` in the same popup, with search over Unicode emoji
  names and insertion through the existing paste path.
