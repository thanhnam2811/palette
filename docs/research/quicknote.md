# Research: quick notes

Status: **research only, nothing implemented.** Measurements were taken in the dev
shell (GNOME Shell 46, Wayland, 1280x800, scale 1) while the host was busy; treat
them as best-of-run figures and re-measure before optimising.

Baseline for comparison: popup open is 1.9-2.0 ms (E9), extension JS is 2187 lines.

## Verdict

| Piece | Feasible | Effort | Risk | Recommendation |
|---|---|---|---|---|
| Notes list + compose/edit (single line) | yes | S (~300 lines) | low | do first |
| Multi-line editor in the popup | yes, with custom code | M-L | medium | prototype first |
| Multi-line editor as a GTK4 window | yes | M | low | fallback |
| Draft autosave / restore | yes | S | none | bundle with notes |
| Search, pin, delete, paste | yes | S | none | reuse existing rows |

## Measured evidence

| Operation | Result |
|---|---|
| `St.Entry` internal `Clutter.Text` with `single_line_mode=false` + `line_wrap` | renders 3 lines, height grows 36 -> 72 px |
| Enter in `St.Entry` | consumed by StEntry (`activate`); inserting a newline needs a stage `captured-event` intercept (works in principle, not verified end to end) |
| Undo in `Clutter.Text` | none, would have to be built |
| `gjs` + GTK4 process (editor-window option) | 0.17 s start, 46 MB RSS |
| Emoji data load for scale comparison | 55 KB JSON, 0.9 ms async |

## 1. Model and storage

- One file, `~/.local/share/palette/notes.json`, mode 0600, next to the history.
- Entry: `{id, text, created, updated, pinned, draft}`.
- Rewrite atomically with `replace_contents_bytes_async` (same idiom as the
  store's compaction); no append log, no compaction, no watcher.
- Limits: 50 notes, 2 KB each (single line) or 8 KB (multi-line). ~10-100 KB
  total, load cost well under 1 ms, smaller than the 55 KB emoji data.
- Notes are deliberately **not** part of clipboard history search; they are a
  separate list. Pasting a note still enters the history through the watcher,
  like emoji do today.

## 2. Editor options

**A. Single-line `St.Entry` in the popup (recommended v1).**
Reuses the search entry, the row pool, the paste path, the pin/delete actions and
the compact CSS. Editing is a normal entry: caret, selection, clipboard and IME
all come from St. Cost about one day. Limitation: one line per note.

**B. Multi-line inside the popup.**
`St.Entry`'s internal `Clutter.Text` can be switched to `single_line_mode=false` +
`line_wrap=true`; rendering definitely works (measured). The missing pieces are
all custom: intercept Enter at the stage capture phase to insert a newline, scroll
the caret into view on cursor movement, and build undo from scratch (Clutter.Text
has none). IME behaviour in multi-line mode is untested. Cost 2-4 days, medium
risk, needs a prototype on the real session before committing.

**C. GTK4 editor window in a separate process.**
`Gtk.TextView` gives undo, IME, wrapping, scrolling and selection for free, in
Adwaita (system-consistent), at 0.17 s / 46 MB in its own process - the shell pays
nothing. But it is a window, not a compact popup, and it adds a second UI surface.
Cost about two days.

Recommendation: **A now**, then B behind the same model and UI if multi-line turns
out to be needed. B and C only replace the editor widget; list, storage, drafts
and shortcut stay the same.

## 3. UX

- `Super+Shift+V` (configurable, clearable) and one indicator-menu item
  "Quick notes". `Super+N` is already taken by `focus-active-notification`.
- List: `Enter` pastes (and closes), `Ctrl+N` new, `Ctrl+E` edit selected,
  `Ctrl+P` pin, `Del` delete, typing filters.
- Editor: `Enter` saves (single line), `Esc` saves the draft and closes; a dirty
  marker shows unsaved text.
- Drafts: debounce writes 500 ms while typing, flush on close, and on reopen
  restore text, caret and scroll. A draft is stored on the note itself, or as
  `draft` for a note that was never saved; no separate file.

## 4. Performance

- Open cost equals history: same 20-row pool, same search path (~2 ms).
- Notes JSON loads lazily on first open, async like the emoji data.
- Draft saves are one atomic rewrite per idle burst, not per keystroke.
- Nothing runs at login, no timers, no polling.
- Planned benches: E14 notes open (expect ~E9), E15 draft write, E18 shell RSS
  delta while the notes mode is open.

## 5. Risks

- **No undo** in St widgets; option B would need a custom undo stack.
- **Enter interception** in option B interacts with StEntry's `activate` and with
  IME; must be proven on a real session with IBus.
- **Scope**: a third mode is a review question on extensions.gnome.org; the
  extension already covers clipboard and emoji.
- **Storage**: notes and clipboard history are separate concepts; duplication when
  a note is pasted is expected and harmless.
