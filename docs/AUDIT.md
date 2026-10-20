# Palette — Repository Audit

**Audited revision:** `bbe139a` (`feat(emoji): collect picks in an editable run bar`), working tree with the fixes listed below uncommitted
**Target:** GNOME Shell 46, GJS/ESM extension `palette@namtt`
**Date:** 2026-10-20
**Mode:** read-only investigation, then minimal fixes for confirmed P0/P1 defects

---

## 1. Executive summary

No **P0** defect was found: the extension does not lose the whole store on a
normal run, does not execute shell code from clipboard data, and makes no
network requests.

Four **P1** defects were confirmed and fixed, each with a regression test:

1. A store still closing after `disable()` could overwrite the log of the next
   enabled session, losing entries copied after re-enable.
2. Replay accepted syntactically valid but schema-invalid ops. A non-numeric
   size turned the blob-byte total into `NaN`, which made eviction discard every
   unpinned entry; a hash was used directly as a path, allowing reads/writes
   outside `blobs/`.
3. A failed blob write left an entry that survived in the log with no content,
   and a failed log append could leave a partial line and a wedged stream.
4. Compacting an empty history passed an empty `GBytes` to
   `replace_contents_bytes_async`, which asserts and never resolves; the whole
   write queue then hung.

Two **P2 privacy** behaviours were also fixed: clipboard content present before
the extension started is no longer captured by default (new opt-in
`capture-on-start`), and private mode is re-checked after every `await` so a
copy in flight cannot slip into the store. The remaining P2/P3 items are
documented, not silently changed.

**Verdict:** the P1 fixes are verified by unit tests and an isolated headless
shell smoke test. One P2 data-loss UI bug (Delete in the search box) should be
fixed before a wide release; the P3 items are acceptable for a 1.0 with the
stated caveats.

---

## 2. Scope and method

Inspected:

- extension lifecycle: `extension/extension.js`
- capture path: `extension/lib/watcher.js`
- persistence: `extension/lib/core/store.js`, `codec.js`
- thumbnails: `extension/lib/thumbs.js`
- UI/keyboard/modal grab: `extension/lib/ui/popup.js`
- settings/schema/preferences: `extension/lib/settings.js`, `extension/prefs.js`,
  `extension/schemas/org.gnome.shell.extensions.palette.gschema.xml`
- tests, packaging, bench and docs: `test/run.js`, `scripts/pack.sh`,
  `bench/load.js`, `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`

Method: read the full data path before changing it, reproduce each suspected
defect in an isolated temporary store or an isolated headless shell, fix the
root cause at the shared layer, add a regression test, then re-run the suite,
schema compilation, packaging and a shell smoke test.

The seven hypotheses in the brief were all investigated; the results are
mapped to the findings below.

---

## 3. Findings

### P0 — none

No defect met the P0 bar (data destruction for all users, code execution,
credential exfiltration, or extension breaking the shell on startup).

### P1-1 — A closing store can overwrite the next session's history log

**Evidence / reproduction**

`disable()` called `store.destroy()` without awaiting it. Compaction is queued
on the store's write chain, so this sequence lost new data:

```text
open store A → queue compaction of A → disable (destroy A, not awaited)
→ enable → open store B → copy "new" → flush B → reopen
→ history contains only A's old entries
```

Observed before the fix: after re-enable and one new copy, a reopen returned
`["old"]`, not `["old", "new"]`. The old store's queued
`replace_contents_bytes_async` renamed its snapshot over the log after B had
appended.

**Root cause**

Per-directory lifetime was not serialised. `destroy()` waited for its own
queue, but a new `Store.open()` did not wait for that close, so two instances
owned the same `history.log`. A review follow-up found the same gap at the
start of the lifetime: an open that is still replaying its log is invisible to
the map, so a fast disable → enable during startup could start a second open.
If the late first store then compacted before its generation check destroyed
it, it could rewrite the new store's log.

**Fix**

- `extension/lib/core/store.js:21` — module-level `closing` map keyed by
  directory.
- `store.js:63-91` — `Store.open()` registers a lifetime promise *before*
  `#load()` runs and waits for any previous lifetime on the same directory;
  waiters re-check in a loop, so a queued opener cannot race a just-released
  one.
- `store.js:256` — `destroy()` is idempotent, releases the lifetime only after
  the queue and stream are closed, and clears the map entry only if it still
  owns it.
- `store.js:151` — `alive` getter for background passes.
- `extension/extension.js:56,65` — close rejections are logged instead of
  becoming unhandled.

**Regression tests:** `test/run.js:329` — *a new store waits for the previous
one to finish closing*; `test/run.js:349` — *a second open waits for an
in-flight open and its close*.

### P1-2 — Incomplete log-schema validation: NaN accounting, mass eviction, path traversal

**Evidence / reproduction**

`decodeOp()` only required `o` to be a string and `id` an integer. A log line
such as:

```json
{"o":"a","id":2,"h":"cccc…","k":"image","m":"image/png","n":"oops","t":2,"p":""}
```

was replayed with `size: "oops"`. `#blobBytes` became `NaN`, so the eviction
condition `this.#blobBytes <= maxTotalBytes` was always false and the store
removed **every unpinned entry** at startup. Before the fix the reproduction
ended with `entries=0`.

A hash such as `"../../../.ssh/id_rsa"` was also accepted. `blobFile()` and
`thumbFile()` join the hash onto `blobs/` without validation, so a tampered log
could make the extension read a file outside its data directory (and the
thumbnail pass write `<hash>.thumb` outside it).

`kind`, `mime`, `preview`, `inline` and `pin` values were likewise unchecked,
so a malformed op could produce entries the rest of the code did not expect.

**Root cause**

Validation stopped at the envelope. Replay trusted the rest of the op, and
replay is the trust boundary for on-disk state.

**Fix**

- `extension/lib/core/codec.js:14,29` — full per-op validation:
  - positive integer `id`, positive integer timestamps;
  - 64 lowercase hex characters for `h`;
  - `k` restricted to `text`/`image`;
  - non-empty string `mime`;
  - non-negative integer size;
  - optional string `preview`;
  - optional inline text only for `kind: "text"`;
  - `pin` only `0`/`1`; touch requires a valid timestamp.
- Invalid lines are treated as torn lines: skipped during replay and repaired
  by the existing compaction path.
- `bench/load.js:18` now uses positive ids so the benchmark data passes the
  same schema.

**Regression tests:** `test/run.js:62` — *codec rejects schema-invalid
operations*; `test/run.js:233` — *replay skips schema-invalid ops and keeps
valid history* (asserts valid entries survive, no invalid line remains, and
accounting does not evict the history).

### P1-3 — Write failures left RAM and disk inconsistent

**Evidence / reproduction**

Two distinct failures:

1. **Blob write failure.** `add()` registered the entry and queued its `a` op
   immediately. If the blob write failed (full disk, permission), the entry
   stayed in RAM and the add op was still written. Reopening produced an entry
   whose `readContent()` returned `null`.
2. **Log append failure.** The append task threw, but the stream was kept and
   the queue continued. A partial line could remain, and every later append on
   the broken stream failed too; the console showed `palette: store I/O failed`
   while the entries existed only in RAM.

Observed before the fix: failed blob write showed the entry in RAM but
`readContent: null` after reopen.

**Root cause**

The write queue errors were logged but not reconciled with the in-memory
state. Blob and log writes were treated as independent even though the log op
is only meaningful if the blob exists.

**Fix**

- `store.js:199-212` — on blob failure, unregister the entry, notify listeners
  and rethrow. The queued `a` op checks `this.#entries.has(op.id)` before
  writing (`store.js:340`) and is skipped.
- `store.js:333-365` — on append failure: drop the entry if it was the add,
  close and reset the stream, rewrite the log from RAM (`#compact()`), then
  report the error. If `destroy()` has already started, the entry is removed
  without queuing a blob delete and the repair compaction is skipped, so no
  task can outlive the close; the next open repairs the torn tail.
- `store.js:374-392` — compaction filters out entries that disappeared before
  execution, so a snapshot cannot resurrect a failed entry.
- `store.js:516-521` — `writeAll()` rejects a zero/negative write instead of
  looping forever.

**Regression tests:** `test/run.js:284` — *failed blob write drops the entry and
commits no add op*; `test/run.js:308` — *failed log append drops the entry and
the write queue recovers*; `test/run.js:371` — *compaction does not resurrect an
entry whose blob write failed* (fails if the identity filter is removed).

### P1-4 — Compacting an empty history hangs the write queue

**Evidence / reproduction**

`#compact()` always called `replace_contents_bytes_async` with the serialised
snapshot. For an empty history that is a zero-length `GBytes`. Gio asserts:

```text
g_output_stream_write_async: assertion 'buffer != NULL' failed
```

and the returned promise never resolves. Every later write (new copies,
deletes, next compaction) stays queued behind it, so recording stops until the
extension is restarted. Reproduced by clearing the history and waiting on
`flush()`.

**Root cause**

An empty snapshot has no valid byte buffer, and the code assumed Gio accepts
an empty replace. There is also no reason to keep an empty log file.

**Fix**

- `store.js:361-372` — when the filtered snapshot is empty, close the stream
  and delete `history.log` (ignoring `NOT_FOUND`). The next append recreates
  it.

**Regression test:** `test/run.js:262` — *compacting an empty history does not
hang the write queue*.

### P2-1 — Implicit capture of pre-existing clipboard content

**Evidence / reproduction**

`Watcher.start()` unconditionally called `#schedule()`, which read whatever was
on the clipboard at enable time. A password copied before enabling the
extension was persisted without any user action. This is a privacy defect even
though it is local-only.

**Fix**

- `extension/lib/watcher.js:39` — startup capture only when the new
  `capture-on-start` GSetting is true.
- Schema key at `extension/schemas/org.gnome.shell.extensions.palette.gschema.xml:60`,
  default `false`.
- Preferences row at `extension/prefs.js:37`; getter at
  `extension/lib/settings.js:24`; docs updated in `README.md` and
  `docs/ARCHITECTURE.md`.

This is an intentional behaviour change: users who want the old behaviour can
enable the setting.

### P2-2 — Private mode could be bypassed by a copy already in flight

**Evidence / reproduction**

Private mode was checked once at the start of `#capture()`. The clipboard read
(`get_content`) and content hash are asynchronous. Toggling private mode while
either was pending still stored the content afterwards.

**Fix**

- `watcher.js:80-92` — re-check `privateMode` after the clipboard read and
  again after `hashData()`, before `store.add()` / `touchByHash()`.

**Verification:** covered by code inspection and the headless-shell smoke, not
by a deterministic unit test (the race depends on main-loop timing). Marked
partially verified.

### P2-3 — Pinned entries can exceed `max-total-mb`

**Evidence / reproduction**

`#evict()` only considers unpinned entries. Lowering `max-total-mb` to 1.5 KB
with a 9 KB pinned entry left the full 9 KB in the store. This is consistent
with “pinned entries are never evicted”, but the setting description did not
say so.

**Decision:** intentional design, not a bug. Pinned data is never deleted
automatically. The schema description, `README.md` and
`docs/ARCHITECTURE.md` now state the exception; the regression test
`test/run.js:349` documents it. A future UI could show a warning when pinned
data alone exceeds the limit.

### P2-4 — Delete in the search box removes the selected entry

**Evidence**

The search entry forwards key presses directly to `#onKey`
(`extension/lib/ui/popup.js:220`). The handler for `Clutter.KEY_Delete`
removed the selected history entry whenever one was selected, without checking
whether the search field had text. Pressing Delete to erase a character
therefore deleted clipboard data, with no undo.

**Fix**

- `popup.js:706-711` — Delete only removes an entry when the search text is
  empty; otherwise the event propagates to the entry and edits the query.
  Removing with a non-empty query is still possible by clearing the search
  first (or by using the context/row action).

**Verification:** code inspection; the repository has no Shell UI test
harness, so this follows the same manual-smoke status as the other popup
changes. The condition is one line and does not affect the store.

### P2-5 — Modal grab could leak if opening the popup throws

**Evidence**

`Popup.open()` pushed a modal grab inside `#open()`. An exception after the
push left the grab in place, blocking the shell until the extension was
disabled.

**Fix**

- `popup.js:125-134` — catch the exception, hide the backdrop directly (it may
  already be shown while `#isOpen` is still false, in which case `close()` is a
  no-op), and call `close()` to release the grab and actors.

### P3-1 — Thumbnail/deletion race still has a small window

`watcher.js:100` checks that the entry still exists before queuing
`writeThumbnail()`, and `thumbs.js:69` checks liveness before each startup
pass. A deletion between that check and the actual write can still leave an
orphan `.thumb` or log a write error. Startup orphan sweeping removes it on the
next start; no data is lost. Fully closing the window would require
cancellation or a tombstone check inside `writeThumbnail`, which is not worth
the complexity for a cosmetic cache.

### P3-2 — Large clipboard content is still copied by the shell

`watcher.js:106-117` rejects content larger than the configured limit before
`toArray()`, avoiding a second copy. The compositor still materialises the
clipboard buffer, and `readContent()` loads a full blob into memory when
pasting. Bounded by `max-image-mb` (8 MB) and `max-total-mb` (256 MB), so
acceptable for 1.0.

### P3-3 — No timeout on the clipboard read callback

`get_content()` has no timeout. If the selection owner never answers, the
promise never settles, `#busy` stays true, and later copies are coalesced into
`#again` without a retry until the extension is restarted. Reproducing this
requires a hung selection owner; a 1–2 s timeout that resolves `null` would
contain it.

### P3-4 — Reliance on private GNOME APIs

The extension uses `Meta.Selection` / `owner-changed`, the shell clipboard
wrapper, `global.display.get_focus_window()` and shell UI actors. These are
private APIs and can change between Shell versions. `metadata.json` correctly
limits the extension to Shell 46; each new Shell version needs a compatibility
pass. No action for this release.

### P3-5 — Existing files are not re-chmodded

The store creates the directory `0700` and new files `0600` (verified by
`test/run.js:418`). It does not repair permissions of a pre-existing `0700`
directory containing `0644` files. That requires an attacker who could already
write inside the user's data directory, so it is low risk; a startup
`chmod` pass over `history.log` and `blobs/*` would close it cheaply if
desired.

---

## 4. Changes applied

| File | Change |
|------|--------|
| `extension/lib/core/codec.js` | Strict per-op schema validation; rejects non-hex hashes, bad sizes/timestamps/kinds/mime/preview/inline/pin. |
| `extension/lib/core/store.js` | Per-directory open+close lifetime serialisation, idempotent `destroy()`, `alive`, write-failure reconciliation, skip add op for gone entries, no repair compaction after destroy starts, stream reset/repair, empty compaction deletes the log, zero-write guard, live-set filtering in compaction, stop orphan sweep when dead. |
| `extension/lib/watcher.js` | Startup capture opt-in; private-mode re-checks; size limit before `toArray()`; thumbnail liveness check. |
| `extension/lib/thumbs.js` | Stop the missing-thumbnail pass when the store is dead or the entry is gone. |
| `extension/extension.js` | Handle `destroy()` rejection at both call sites. |
| `extension/lib/ui/popup.js` | Release the modal grab and hide the backdrop if opening the popup throws; Delete edits a non-empty search query instead of removing the highlighted entry. |
| `extension/lib/settings.js` | `captureOnStart` getter. |
| `extension/prefs.js` | Startup-capture switch in Privacy. |
| `extension/schemas/…gschema.xml` | New `capture-on-start` key (default `false`); pinned-limit note. |
| `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md` | Document the setting, privacy behaviour, pinned limit, write-failure semantics and corrected arrow-key help. |
| `bench/load.js` | Positive ids so benchmark logs satisfy the schema. |
| `test/run.js` | Nine regression tests for the confirmed defects (25 → 34 tests). |

No dependency was added, no new abstraction was introduced, and no clipboard
content was read or written during testing outside isolated temporary stores.

---

## 5. Verification

All commands were run from the repository root on the working tree containing
the fixes.

| Check | Result |
|-------|--------|
| `gjs -m test/run.js` | **34/34 passed**, exit 0 (baseline before fixes: 25/25) |
| `glib-compile-schemas --strict --dry-run extension/schemas` | pass (`SCHEMA_OK`) |
| `git diff --check` | clean (`DIFF_CHECK_OK`) |
| `./scripts/pack.sh` | produced `palette@namtt.shell-extension.zip` |
| Isolated headless Shell smoke (`scripts/dev-restart.sh`, `scripts/dev.sh`) | two copies captured; Delete with a non-empty query did not remove the selected entry; popup opened/closed; disable → enable preserved history; no Palette JS errors |
| `capture-on-start` default | verified `false` in the compiled schema |

**Status by area**

- P1-1 store open/close lifetime: **VERIFIED** by regression tests for both an
  in-flight open and a pending close.
- P1-2 schema replay: **VERIFIED** by codec/replay tests.
- P1-3 write failures: **VERIFIED** by blob, append and compaction-filter tests.
- P1-4 empty compaction: **VERIFIED** by the no-hang test.
- P2-1 startup capture: **VERIFIED** in the headless shell (opt-in path).
- P2-2 private-mode race: **PARTIALLY VERIFIED** — code inspection plus normal
  private-mode smoke; no deterministic timing test.
- P2-4 Delete key: **PARTIALLY VERIFIED** — code inspection; no Shell UI test
  harness in the repository.
- P2-5 modal grab: **VERIFIED** by inspection; the exception path is not
  simulated in a test.
- Thumbnail/UI interactions: **PARTIALLY VERIFIED** — startup/smoke only.

The journal also contains a `Gio.UnixInputStream` warning from
`loginManager.js`; it is not emitted by Palette.

---

## 6. Remaining risks and release readiness

**Blocking before a wide release**

- None after the follow-up fixes. The Delete-key guard was added and covered by
  inspection; the full unit suite and packaging were re-run.

**Accepted for 1.0 with documentation**

- Pinned entries can exceed `max-total-mb` by design.
- Startup clipboard capture is now opt-in; this is a deliberate privacy change
  and belongs in the release notes.
- Thumbnail cleanup may leave a cosmetic orphan until the next start.
- Clipboard reads have no timeout; a hung selection owner can pause recording
  until restart.
- Existing file permissions are not repaired.
- Shell-private APIs remain a per-version compatibility risk; Shell 46 is the
  only declared target.

**Release recommendation:** ship the P1 fixes, the privacy change and the
follow-up guards. The unit suite (34/34), schema compilation and packaging all
pass. The remaining caveats are the documented P2/P3 items, chiefly the lack of
a deterministic Shell UI test for the popup key changes.
No rollback or migration is required: existing logs remain valid, invalid lines
are skipped and repaired on the next compaction, and an empty log is simply
absent until the next copy.
