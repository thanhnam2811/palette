# Architecture

A clipboard history for GNOME Shell 46 on Wayland: lightweight, feature-complete
for daily use, compact/modern UI. Written from scratch in GJS; no code is taken
from Clipboard Indicator or Clipboard History (only the idea; both are MIT). This
project is MIT as well.

## 1. Goals / non-goals

**Goals**

- Text and images in the history, pinning, instant search, quick paste from the
  keyboard.
- Lowest possible cost on the `gnome-shell` main loop: on every copy, and on
  every popup open.
- RAM that does not grow with the total size of the stored text and images.
- Privacy: private mode, per-app exclusion, password-manager hint, files `0600`
  inside a `0700` directory.
- Clear layering: the logic layer does not depend on the shell, so it can be
  tested and benchmarked with plain `gjs`.

**Non-goals (v1)**: tags, import/export, machine sync, OCR, PRIMARY selection,
storing `text/html`.

## 2. Layout

```
extension/
├─ metadata.json, stylesheet.css, schemas/*.gschema.xml
├─ extension.js        lifecycle: enable() builds, disable() tears down cleanly
│                      (no leaked signal, source or actor)
├─ prefs.js            Adw preferences
└─ lib/
   ├─ core/            shell-free (runs under `gjs -m`, used by tests and benches)
   │   ├─ hash.js        content hashing (algorithm picked by benchmark)
   │   ├─ codec.js       encode/decode one log op
   │   ├─ store.js       history: append-only log + blob files + compaction +
   │   │                 serialised write queue
   │   ├─ search.js      match against the preview (case-insensitive)
   │   ├─ text.js        preview building, whitespace normalisation
   │   └─ yield.js       slice a big computation over main-loop turns
   ├─ watcher.js       owner-changed → pick mimetype → hash → store.add (shell)
   ├─ paste.js         virtual keyboard: Ctrl+V / Ctrl+Shift+V in terminals (shell)
   ├─ settings.js      GSettings wrapper returning normalised values (shell)
   └─ ui/
       ├─ popup.js       modal overlay: search, list, preview, keys
       ├─ row.js         one row (icon/thumbnail, one-line preview, pin/delete on hover)
       └─ indicator.js   panel icon + small menu (private mode, clear, settings)
test/                  tests run by `gjs -m` (store, codec, search, text)
bench/                 benchmarks of the alternatives (run by `gjs -m`); results in docs/BENCH.md
scripts/               dev-shell.sh (nested shell), dev-restart.sh, dev.sh, dev-seed.sh, pack.sh
docs/                  ARCHITECTURE.md (this file), BENCH.md (numbers + decisions)
```

## 3. Data model

- **Entry** (in RAM, small): `{id, hash, kind: 'text'|'image', mime, size, ts, pinned, preview}`.
  `preview` is at most 200 normalised characters; for short text the preview *is*
  the whole content (no blob needed). Long text and every image live in
  `blobs/<hash>` and are read only when the entry is chosen or previewed.
- **Log** `history.log`: append-only, one absolute-valued op per line, so replay
  is idempotent: `a` (add), `d` (delete), `p` (pin 0/1), `u` (touch: update ts).
- **Compaction**: when wasted ops exceed `max(200, 2×live)` or at startup. The
  snapshot is serialised *synchronously* when it is queued, then written to `tmp`
  and renamed, so its order relative to later ops is always correct.
- **Serialised write queue**: every I/O (blob, append, compaction, blob delete)
  goes through one promise chain; I/O is async and never blocks the main loop. A
  blob is always fully written before the `a` op that references it.
- **Dedup** via `Map<hash, id>`: a repeated copy only touches the entry.
- **Limits**: entry count (pinned not counted), maximum bytes per item, total blob
  size; over the limit the oldest unpinned entries are evicted.

## 4. Copy hot path

`owner-changed(CLIPBOARD)` → private/excluded-app check → one `get_mimetypes()` →
drop if `x-kde-passwordManagerHint` is present → pick one mimetype (text first,
then image) → one `get_content` → size check → hash → `store.add()` (RAM updated
synchronously, I/O queued).

## 5. UI

- The overlay is built with `St`, holds a modal grab (`Main.pushModal`), and is
  placed at the pointer or centred (clamped to the work area).
- Focus stays in the search entry; rows are selected by index (no St focus
  traversal) → simpler and faster.
- Fixed row height (~30px); pin/delete buttons appear on hover or selection.
- Virtualised list: a pool of 20 reused `Row`s between two spacers (measured in
  E9: 1.8 ms to open the popup, independent of history length).
- Keys: `↑↓` select, `Enter` paste, `Del` remove, `Ctrl+P` pin, `Alt+1..9` quick
  paste, `Tab` toggle preview, `Esc` close.
- Quick filters: All / Pinned / Text / Images.

## 6. Settings (GSettings)

`history-size`(50) · `max-text-kb`(1024) · `max-image-mb`(8; 0 disables images) ·
`max-total-mb`(256) · `toggle-shortcut`(`<Super><Shift>v`) ·
`popup-position`(`cursor`|`center`) · `paste-on-select`(true) ·
`private-mode`(false) · `excluded-apps`(as) · `terminal-apps`(as, pasted with
Ctrl+Shift+V) · `show-indicator`(true)

## 7. Optimisation method (measure, then choose)

Rule: a correct MVP first, then for every bottleneck define **at least 2–3
alternatives**, measure them with the same scenario, record the numbers in
`docs/BENCH.md`, pick the winner and write down why. Nothing unmeasured is
optimised.

| ID | Bottleneck | Alternatives compared | Where | Metric |
|----|------------|-----------------------|-------|--------|
| E1 | Content hashing | SHA-256 / SHA-1 / MD5 (`GLib.compute_checksum_for_bytes`) · 32-bit `Bytes.hash()` · FNV-1a in JS | `bench/hash.js` (gjs) | ms for 1KB/100KB/1MB/5MB |
| E2 | Log format | JSONL · tab-separated lines · binary `DataOutputStream` | `bench/codec.js` (gjs) | load time for N=100/1k/10k ops, bytes/op, encode time |
| E3 | How to append | open stream + async write · open/append/close per op · sync write | `bench/append.js` (gjs) | µs/op on the main thread, total for N ops |
| E4 | Loading at startup | `load_contents` + split · `DataInputStream.read_line` · deferred (idle) parse | `bench/load.js` (gjs) | main-loop block time |
| E5 | Preview | regex `\s+`→' ' · manual char scan · truncate first, then normalise | `bench/text.js` (gjs) | µs for 1KB/100KB/1MB of text |
| E6 | Search | `toLowerCase().includes` (cached lower) · regex · fuzzy subsequence | `bench/search.js` (gjs) | ms for 1k/10k entries |
| E7 | Inline vs blob threshold | 0 / 200 / 1024 / 4096 characters | `bench/inline.js` (gjs) | number of files, load time, RAM |
| E8 | Clipboard capture | `get_mimetypes` + one `get_content` · probe mimetypes one by one | nested shell (timing log) | ms per copy |
| E9 | List construction | all rows · pages of 30 · virtualised pool | nested shell | ms to open the popup, actor count, RSS |
| E10 | Image thumbnails | `Gio.FileIcon` on the full image · small thumbnail generated at copy time (GdkPixbuf) | nested shell | ms to load a row, RSS |

Experiments inside the shell need a nested shell; the pure-logic ones (E1–E7) run
under plain `gjs`, so they iterate fast and reproduce.

## 8. Test strategy

- `test/*.js` under `gjs -m`: codec round-trip, store (add/dedup/touch/pin/
  delete/evict/compaction/replay/crash mid-write), search, text. They run in a
  temporary directory and never touch real data.
- Smoke test in the nested shell: enable the extension, `wl-copy` a few kinds of
  content, check the log, open the popup, read the journal for errors.
- `disable()` check: enable/disable repeatedly and assert no signal, timeout or
  actor is left behind (counted through debug logs).

## 9. Milestones

| # | Work | Done when |
|---|------|-----------|
| 0 | Project skeleton, plan, metadata, schema, dev scripts | `glib-compile-schemas` ok, nested shell picks the extension up |
| 1 | `core/` + tests | `gjs -m test/run.js` green |
| 2 | watcher + paste + settings + lifecycle | text/image copies reach the store in the nested shell |
| 3 | popup + indicator + prefs (feature-complete MVP) | usable daily from the keyboard |
| 4 | Benchmarks E1–E7, apply the winners | `docs/BENCH.md` has numbers + decisions |
| 5 | In-shell measurements E8–E10, apply | same |
| 6 | Packaging (`scripts/pack.sh`), README, `disable()` check | the zip installs |
| 7 | Emoji picker in the same popup (`Super`+`.`) | planned: see [Roadmap](../README.md#roadmap) |

## 10. Known risks

- Wayland cannot reload extensions → iterate in the nested shell
  (`--nested --wayland`) or `--headless` for smoke tests.
- Automatic pasting differs per app (terminals need Ctrl+Shift+V) → configurable
  `terminal-apps` list.
- GNOME bug #8233 (the mimetype changes from the second copy on): accept
  `UTF8_STRING`/`STRING`/`text/plain` as well.
- Only GNOME 46 has been tested; `metadata.json` declares 46 and we widen it once
  someone tests another version.

## 11. Decision log

Numbers and detailed decisions: `docs/BENCH.md`. Summary: SHA-256 in 256KB slices
(`hashData`, `core/yield.js`), JSONL, long-lived async stream, sliced replay,
truncate-then-normalise preview, cached lowercase, inline ≤1024, one
`get_content` per copy, pool of 20 rows. E10 (thumbnails) is still unmeasured.
