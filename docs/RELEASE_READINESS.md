# Palette release candidate — 2026-10-20

Status: reviewable EGO candidate for GNOME Shell 46 / Wayland. Repository
publication to `main` and host installation were authorized by the maintainer.
EGO submission/publication has not been requested; approval remains the
reviewers' decision. The temporary polish branch is removed after main is pushed.

## Baseline and scope

Repository remote: `https://github.com/thanhnam2811/palette.git`; local working
copy directory is named `clipx`. Initial branch was `main`, tracking origin/main.
Five pre-existing dirty files were present: AUDIT.md, CHANGELOG.md,
lib/core/store.js, lib/ui/popup.js and test/run.js (the last three under extension/
where applicable). Their changes were preserved; concurrent commits visible
during work were not reset or rewritten.

Installed environment: GNOME Shell 46.0, Mutter 46.2 (startup log), GJS 1.80.2,
GLib tools 2.80.0, Python 3.12.3, Node 24.22.0. Host session is Wayland.
The extension declares only Shell 46; no untested version was added. There is
no npm runtime dependency or project package manager install step.
Baseline: 34/34 GJS tests and release packaging passed before changes.

## Delivered changes

- `assets/branding/`: three logo directions, selected layered-card identity,
  colour logo, GitHub banner and 16/24/32/48 px light/dark icon QA sheet, each
  as SVG and PNG. `docs/BRANDING.md` records selection criteria and palette.
- `extension/icons/palette-symbolic.svg`, indicator and extension entry point:
  themed FileIcon and direct emoji menu action. Existing storage and popup UI
  are preserved.
- `extension/lib/watcher.js`: retain the privacy decision when GNOME replaces
  an exiting clipboard owner with a memory source that drops its secret hint.
  Explicit history/emoji selections reset that suppression; private mode still
  applies. A regression test checks both owner lifetime and owner exit.
- Schema: new-install clipboard shortcuts are empty, as required by current
  EGO rules. Explicitly saved bindings persist. Users relying on former defaults
  must choose them in Preferences; the panel exposes both modes without keys.
- `scripts/dev/`: fresh private session launcher, explicit session controller,
  real GTK clipboard/paste target, integration driver, validators and SVG exports.
  Legacy launcher/helper entry points now require or create an explicit private
  session and do not discover or terminate arbitrary compositors.
- Packaging includes the symbolic icon, MIT copyright/license and Unicode data
  license. Devtools, tests, benchmarks and branding source boards stay outside
  the release ZIP. README, CHANGELOG and SECURITY.md document the result.
- `docs/`: technical documentation, testing, branding, release notes, historical
  audit and exploratory research, with a navigation index. Standard GitHub
  community files stay at the root.
- `docs/media/`: nine fresh feature images, ten original full-screen captures,
  a 24.48-second walkthrough GIF (about 675 KiB), and an MP4. Gallery
  images add captions and crop the actual Shell screenshot; raw captures remain
  unmodified. The old demo assets have been replaced. The capture script also
  asserts pinning, the exact emoji run, private-mode exclusion and real GTK paste.

## Actual validation

| Check | Result |
| --- | --- |
| GJS unit suite: storage, limits, replay, search, codec, text, emoji | 34/34 passed |
| Real isolated GNOME/GTK integration checks | 19/19 passed |
| Strict GSettings schema dry-run | Passed |
| Bash syntax, Python AST, JavaScript syntax via Node | Passed |
| SVG XML, viewBox and absence of embedded images/scripts | Passed |
| ZIP CRC, required assets/licenses, development-file exclusion | Passed |
| Final runtime ZIP payload vs installed test payload | Byte-for-byte match |
| Visual review | Panel, dark/light desktop popup, light preferences, banner, symbolic sizes reviewed |
| Git whitespace check | Passed |

Integration covered isolated extension path; panel presence/menu; empty shortcut
defaults and configured shortcuts; text/PNG from a focused real GTK Wayland
client; history selection pasting into its real text view; password-manager hint
and exclusion after owner exit; private mode; history modal and Escape; emoji
search, keyboard staging/commit and clipboard capture; three disable/enable
cycles; stable virtual device count; preferences opening.

Evidence is in [docs/validation/2026-10-20](validation/2026-10-20): unit/static
output, integration results, isolation paths, raw Shell log and ZIP SHA-256.
Every file in the final ZIP matches the isolated installation used by the
follow-up tests and feature capture, and the reinstalled host extension.

Reproduce with:

```sh
scripts/dev/validate.sh
scripts/dev/session.sh
# In another terminal, use the freshly printed session path:
scripts/dev/smoke.py /tmp/palette-session.XXXXXX
```

See [session documentation](TESTING.md). Each run uses its own HOME,
XDG paths, settings backend, bus, extension installation and Wayland clipboard.
The controller verifies child process environment before every call, and the
smoke driver verifies the extension's installation path before enabling it.
Only the private bus activation environment is updated. No host Shell restart,
replacement, reload, extension enable or clipboard operation was performed.

## EGO and remaining limits

Reviewed [EGO guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html),
[GNOME app icons](https://developer.gnome.org/hig/guidelines/app-icons.html) and
[symbolic icons](https://developer.gnome.org/hig/guidelines/ui-icons.html) on
2026-10-20. Clipboard access is declared in metadata; there are no network calls
or telemetry, and only normal user session mode is used. No dev Eval interface
is shipped. Schema identifiers and paths use the prescribed namespace.

The following are limits rather than successful test claims:

- X11, other Shell versions, mixed DPI, screen readers, terminal paste variants,
  and a full interactive VM desktop were not tested. Headless GNOME 46 supported
  real UI, clipboard, input and screenshot testing, so a VM was not required.
- Preferences opening/rendering was verified; every individual preference control
  and shortcut capture interaction was not automated. Clear-history confirmation,
  all pin/delete combinations and long-duration stress remain manual QA items.
- Dark/light desktop colour schemes were exercised; the popup intentionally
  remains dark in both. Alternate Shell themes were not tested. Footer text is
  small/low contrast in compact density; comfortable density remains available.
- Existing Paster shares one virtual keyboard per Shell process because the
  Mutter seat retains created devices; tests confirm no device growth over
  three cycles. This intentional retained reference merits reviewer attention
  against the guideline to release all extension-owned objects on disable.
- Headless startup logs contain absent login/session, camera, screencast and
  permission-service warnings, plus Clutter input-focus assertions around
  synthetic input and shortcut overwrite warnings. No `palette:` error occurred
  in the final run. Host inotify resources were exhausted intermittently; the
  final integration run succeeded despite file-monitor warnings.
- History is local but unencrypted. Password hints depend on the clipboard owner;
  plain text secrets without hints can be recorded. Private mode does not erase
  old history. The persistence regression fix cannot recover hints already lost
  before Palette starts; capture-on-start remains disabled by default.
- Historical performance benchmarks were not rerun. The old demo generator was
  replaced and the new generator ran successfully. Legacy helpers require
  `PALETTE_DEV_DIR`; client logs are inside the session artifacts directory.

Release artifact: `palette@namtt.shell-extension.zip` in the repository root
(intentionally gitignored). Its checksum is recorded with the validation logs.
No EGO approval or broader platform compatibility is claimed.


## Host installation

The release ZIP was reinstalled on the current host using `gnome-extensions
install --force`; installed files were verified byte-for-byte and schemas were
compiled strictly. Effective `Super+V` and `Super+.` bindings were preserved as
explicit user settings. Existing clipboard history was not read, cleared or
modified by the installer. The prior extension and settings have a private local
backup under `~/.local/state/palette/install-backups/`.

The active host extension remains enabled. The Shell process was not restarted,
replaced or reloaded; GNOME Wayland loads the updated JavaScript on the next
normal logout/login. Host runtime execution of the new code is therefore not
claimed; runtime verification was performed in the isolated Shell.
