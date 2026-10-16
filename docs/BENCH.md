# Benchmarks & decisions

The machine was noisy (Blender rendering) so every number is the **minimum of N
runs**. Reproduce with `gjs -m bench/<x>.js`; E8/E13 need the dev shell
(`scripts/dev-restart.sh`, `bash bench/shell/e8.sh`, then eval the contents of
`bench/shell/e9.js` and `bench/shell/e13.js` in it).

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
| E9 popup open | Before (render all / pages of 30): 17ms at 30 rows, 317ms at 500 rows. **Virtualised pool of 20 rows: 1.8ms (sync) / 3.5ms (to paint) at both 50 and 500 entries, RSS +0.0–0.1MB.** | **Pool of 20 rows + 2 spacers** inside a ScrollView (keeps the native scrollbar). Cost does not depend on history length. |
| E10 thumbnails | **Not measured.** Currently `Gio.FileIcon` on the original image (images are ≤ `max-image-mb`). Pre-generated thumbnails are the next optimisation if image-row RAM or load latency becomes a problem. | — |
| E11 emoji data | `emoji-test.txt` (Unicode 15.1) → 1898 emoji, 9 groups, 48.3 KiB after generation. Lazy sync read + parse + materialise on the first open: **0.58 ms** plain `gjs`, 0.93 ms inside the shell (warm). The same data as an ES module costs **+1.7 ms on every login** (54.5 KiB parsed at import) and cannot be lazy. | **Generated `data/emoji.json`, read on demand** (`core/emoji.js`, `EmojiData.load`). The file is committed, so the `unicode-data` package is only needed to regenerate it. |
| E12 emoji search | Per keystroke over 1898 items: `includes` on a precomputed lowercase name, AND over the terms: **0.12 ms**. Lowercasing every name on every keystroke: 0.9 ms. Substring over raw names is the same speed, but misses `pinata` for `piñata`. | **Cached folded name + AND terms**, same shape as E6. |
| E13 emoji open (real shell) | First open pays for the 12×9 grid pool: **22.7 ms** sync, 40.0 ms to paint, once per session. Afterwards **4.4 ms** sync, 7.2 ms to paint — the history popup is 2.4 / 4.8 ms for comparison. RSS +0.14 MB, 0 actors left after `destroy()`. | **Build the pool lazily on the first emoji open** (never at login), keep it for reuse, release it with the popup. |

## Lifecycle check

Disabling and re-enabling the extension 3 times in the dev shell: the number of
actors on the stage is unchanged (2227 → 2227 → 2227 → 2227) and the log has no
errors. This includes the emoji picker having been used: its kept grid pool adds
188 actors while the extension runs and they are released with the popup.
`gjs -m test/run.js`: 22/22.
