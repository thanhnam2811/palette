# Benchmarks & decisions

The machine was noisy (Blender rendering) so every number is the **minimum of N
runs**. Reproduce with `gjs -m bench/<x>.js`; the in-shell ones (E8–E13) need the
dev shell (`scripts/dev-restart.sh`, `bash bench/shell/e8.sh`, then eval the
contents of `bench/shell/e9.js`, `e10.js` and `e13.js` in it).

| ID | Key result | Decision |
|----|------------|----------|
| E1 hashing | SHA-256 1MB 4.5ms, 5MB 23ms; SHA-1 about 2× faster; 32-bit `Bytes.hash` is the fastest but collides. Hashing 5–8MB in one go blocks the main loop for 25–39ms; 256KB slices bring that down to ≤2.5ms (wall time barely changes). | **SHA-256, 256KB slices** for payloads > 512KB (`core/hash.js`, `hashData`). No weak hash, because the hash is also the blob name and the dedup key. |
| E2 log | JSONL vs TSV: TSV is ~25% faster but cannot hold arbitrary text; binary is 3–4× slower under GJS. Decoding 4000 JSONL ops takes 6.8ms. | **JSONL** (debuggable, parsed by native `JSON.parse`). |
| E3 appending | Long-lived stream + async write: 0.7–1µs/op on the main thread; open/close per op is 8× slower in a burst of 500; sync writes block the main loop. | **Stream kept open, async, serialised queue**. |
| E4 log loading | 30k lines: a single parse blocks for 124ms; 500-line slices block for at most 6.4ms. | **Sliced replay + idle yield** (`REPLAY_SLICE=500`). |
| E5 preview | Regex over 1MB of text: 28ms; truncate first, then regex: 8µs. | **Truncate first, then normalise**; a manual character scan is not meaningfully better. |
| E6 search | 10k entries: cached lowercase + `includes` 0.9–1.4ms; lowercasing every time 1.7–2.1ms; regex about the same; fuzzy 2–5ms. | **Cached `lc` + `includes`, AND over terms**. Fuzzy is not worth it. |
| E7 inline | Threshold 1024: 156 blobs per 1000 entries, open 4.6ms, `readContent` 0.03ms; 4096 doubles RAM/log size and opens in 7ms. | **Inline ≤ 1024 characters**. |
| E8 capture (real shell, GTK4 client) | `get_mimetypes` ~5µs; one `get_content` + `toArray`: 1KB 0.16ms, 1MB 2.1ms, 5MB image 13ms; probing mimetypes one by one is not faster. | **One `get_mimetypes` + one `get_content`**. A 5MB image is ~50ms end to end, but hashing is sliced, so the main loop is never blocked in one chunk. |
| E9 popup open | Before (render all / pages of 30): 17ms at 30 rows, 317ms at 500 rows. **Virtualised pool of 20 rows: 1.9ms (sync) / 3.4ms (to paint) at 50, 2.0 / 3.5ms at 500 entries, RSS +0.0MB.** Re-measured per density: compact 1.92 / 3.36ms (50) and 1.95 / 3.37ms (500), comfortable 1.92 / 3.35 and 2.03 / 3.48ms — the difference is below noise. Density buys space, not time: rows are 24px (compact) vs 28px (comfortable), so the fixed 340px list shows 13 vs 11 history lines and 13 vs 10 emoji grid lines. | **Pool of 20 rows + 2 spacers** inside a ScrollView (keeps the native scrollbar). Cost does not depend on history length. |
| E10 image rows | 21 images of 4032×3024 (the shape of a phone photo). Row icon = the stored blob: opening the popup blocks the **first paint for 220–356 ms** and adds **5.1–7.1 MB** RSS — the decoder scales in power-of-two steps, so a 4032px photo still becomes a ~504px pixbuf (~0.5 MB) each. Row icon = a 128px JPEG written when the image is copied: **6.2–8.8 ms** to open, **15.6–17.2 ms** to paint, **0.1–0.6 MB**. Building that thumbnail costs 7.5–8.3 ms of CPU, sliced into 6 turns with a **worst turn of 1.2 ms**, and 1.2–1.4 KB on disk. (A `Gio.Task` worker thread is not an option: GJS blocks JS callbacks on other threads.) | **A 128px JPEG next to each image blob** (`lib/thumbs.js`, 16 KB slices). `store.iconFile()` draws the thumbnail and falls back to the blob, the thumbnail is deleted with the blob, `sweepOrphans()` keeps `X.thumb` with `X`, and `fillMissingThumbnails()` catches up on images copied earlier. |
| E11 emoji data | `emoji-test.txt` (Unicode 18.0) → 1923 emoji, 9 groups, **55.1 KiB** committed as `data/emoji.json`. Lazy read + parse + materialise on the first open: **0.91 ms** async, 0.63 ms sync (plain `gjs`), 2–4 ms cold inside the shell; further opens are cached. Async is the slower of the two but shexli/EGO flags blocking file I/O inside the shell (EGO-X-004), so it is the variant shipped. The same data as an ES module costs **+1.4–6.6 ms on every login** (55.1 KiB parsed at import, noisy host) and cannot be lazy. | **Generated `data/emoji.json`, read on demand** (`core/emoji.js`, `EmojiData.load`). The file is committed, so the `unicode-data` package is only needed to regenerate it. |
| E12 emoji search | Per keystroke over 1923 items: `includes` on a precomputed lowercase name, AND over the terms: **0.12 ms**. The shipped ranked search (`EmojiData.search`, measured in the same table) costs **0.13–0.19 ms**: whole-word matches first, so `cake` returns `birthday cake` before `pancakes`. Lowercasing every name on every keystroke: 0.9 ms. Substring over raw names is the same speed, but misses `pinata` for `piñata`. | **Cached folded name + AND terms + tiered ranking**, same shape as E6. |
| E13 emoji open (real shell) | First open pays for the 12×9 grid pool: **13.6 ms** sync, 14.6–16.4 ms to paint (one run, busy host; the one-time glyph rasterisation is warmed up first), once per session. The 55 KB data file is now read **after** the popup is visible (1.18 ms, E11), so it no longer delays the open and keys typed right after the shortcut land in the search entry. Afterwards **3.2–3.3 ms** sync, 6.1 ms to paint — the history popup is 1.8 / 3.4 ms for comparison. RSS ±0.2 MB, 0 actors left after `destroy()`. Density changes none of this beyond noise. | **Build the pool lazily on the first emoji open** (never at login), keep it for reuse, release it with the popup; open the popup, then load the data. |

## Lifecycle check

Disabling and re-enabling the extension 3 times in the dev shell: the number of
actors on the stage is unchanged (2227 → 2227 → 2227 → 2227), the number of
Clutter input devices is unchanged (1 → 1 → 1 → 1) and the log has no errors.
The device count guards `Paster`: the seat keeps every virtual device it creates
and Clutter has no `destroy()` for them, so one device is shared for the session
(creating one per `Paster` used to leak one device per cycle: 2 → 3 → 4 → 5).
This includes the emoji picker having been used: its kept grid pool adds
188 actors while the extension runs and they are released with the popup.
`gjs -m test/run.js`: 25/25.
