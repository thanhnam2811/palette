#!/usr/bin/env bash
# Run palette in an isolated, headless GNOME Shell (own D-Bus session, config, data dir)
# so the real desktop and its clipboard history are never touched.
#
#   scripts/dev-shell.sh [extra gnome-shell args]
#
# Env: PALETTE_DEV_DIR (default /tmp/palette-dev), PALETTE_DEBUG=1 for timing logs,
#      PALETTE_VMON (virtual monitor, default 1280x800).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
dev=${PALETTE_DEV_DIR:-/tmp/palette-dev}

# gschemas.compiled is a build artifact (gitignored): refresh it so edits to the
# schema in the working tree take effect without a manual glib-compile-schemas.
glib-compile-schemas "$root/extension/schemas"

fusermount -u "$dev/runtime/gvfs" 2>/dev/null || true
fusermount -u "$dev/runtime/doc" 2>/dev/null || true
rm -rf "$dev"
mkdir -p "$dev"/{config,data/gnome-shell/extensions,cache,runtime}
chmod 700 "$dev/runtime"
ln -s "$root/extension" "$dev/data/gnome-shell/extensions/palette@namtt"
ln -s "$root/dev/devtools@namtt" "$dev/data/gnome-shell/extensions/devtools@namtt"

export XDG_CONFIG_HOME=$dev/config XDG_DATA_HOME=$dev/data XDG_CACHE_HOME=$dev/cache
export XDG_RUNTIME_DIR=$dev/runtime GSETTINGS_BACKEND=keyfile
export PALETTE_DEBUG=${PALETTE_DEBUG:-1}
unset WAYLAND_DISPLAY DISPLAY
export GNOME_SHELL_SESSION_MODE=user  # no Ubuntu dock/DING/appindicators in the dev shell

exec dbus-run-session -- bash -c '
  # no gnome-session here: give D-Bus-activated apps (prefs window, ...) the display and our isolated dirs
  dbus-update-activation-environment WAYLAND_DISPLAY=palette-dev XDG_RUNTIME_DIR XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME GSETTINGS_BACKEND
  gsettings set org.gnome.shell enabled-extensions "[\"palette@namtt\", \"devtools@namtt\"]"
  gsettings set org.gnome.shell disable-user-extensions false
  exec gnome-shell --headless --wayland --no-x11 --wayland-display=palette-dev \
       --virtual-monitor "${PALETTE_VMON:-1280x800}" "$@"
' _ "$@"
