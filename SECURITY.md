# Security and clipboard privacy

Palette processes sensitive clipboard content locally. Private mode stops new
recording; it does not erase existing history or clear the system clipboard.
App exclusions depend on the focused window class. Password-manager protection
depends on the owner offering `x-kde-passwordManagerHint`; plain text secrets
without that hint can still be recorded. History is not encrypted at rest.

Report a vulnerability privately to the repository maintainer using GitHub's
private vulnerability reporting when available. Avoid putting real clipboard
contents, history files or unredacted screenshots in public issues. Include the
GNOME version, reproduction steps with synthetic content, and relevant errors.

The test-only devtools extension permits arbitrary evaluation on its private
session bus. Never install it in a normal desktop session. It is not included
in the release ZIP.
