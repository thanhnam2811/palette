# Contributing

Thanks for looking at Palette. It is a small project: bug reports and focused
patches are welcome.

## Reporting bugs

Please include your GNOME Shell version (`gnome-shell --version`), the session
type (Wayland/X11), the extension version (`gnome-extensions info
palette@namtt`), and anything relevant from the journal:

```sh
journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i palette
```

## Development setup

No build step: the extension is plain GJS, and the shell loads the sources
directly.

```sh
gjs -m test/run.js        # unit tests (store, codec, search, text, emoji) — fast, no shell
scripts/dev-shell.sh      # isolated headless GNOME Shell with this extension loaded
scripts/dev-restart.sh    # same, in the background; waits until it answers on D-Bus
scripts/pack.sh           # build palette@namtt.shell-extension.zip
```

`scripts/dev-shell.sh` uses its own D-Bus session, `XDG_*` directories and
`GSETTINGS_BACKEND=keyfile`, so your real desktop, clipboard history and settings
are untouched. `scripts/dev.sh` (source it) drives that shell:

```sh
source scripts/dev.sh
dev_eval 'palette.stateObj.store.length'   # evaluate JS inside the shell
dev_keys Down Return                       # virtual keyboard
dev_shot /tmp/popup.png                    # screenshot
dev_copy 'some text'                       # put text on the dev clipboard
```

Inside the shell, `palette` is the running extension object, and the `devtools`
extension exposes `org.palette.Dev` on the session bus.

Because GNOME Shell on Wayland cannot reload an already-loaded extension, always
iterate in the dev shell — installing an update into your real session needs a
log out/in.

## Benchmarks

Performance claims come from numbers, not intuition. `bench/` holds the
alternatives that were compared; `docs/BENCH.md` records the results and the
decision taken. If you change something on a hot path (hash, log format, replay,
preview, search, list construction, clipboard capture), add an alternative to the
matching benchmark, measure both, and update the table.

## Code layout

`extension/lib/core/**` must stay shell-free: it runs under plain `gjs`, and both
the tests and the benchmarks depend on that. Shell-specific code (`watcher.js`,
`paste.js`, `settings.js`, `ui/**`) stays in the layer it belongs to; `extension.js`
is only lifecycle and wiring, and `disable()` has to leave nothing behind (no
signal, timeout, actor or open stream).

Style: 4 spaces, single quotes, semicolons, `#private` fields, ES modules — see
`.editorconfig`. Keep the diff focused; unrelated reformatting makes review
harder.

## Tests

Add or extend a test in `test/run.js` when you change `core/` behaviour, and keep
the suite green (`gjs -m test/run.js`). Tests must run in a temporary directory
and never touch `~/.local/share/palette`.
