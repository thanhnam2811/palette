#!/usr/bin/env bash
# A fresh compositor and private bus. Never connects to the host Shell bus/display.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
if [[ ${1:-} != --inside ]]; then
    "$root/scripts/pack.sh"
    run=$(mktemp -d /tmp/palette-session.XXXXXX)
    chmod 700 "$run"
    mkdir -p "$run"/{home,config,data,cache,state,runtime,artifacts}
    chmod 700 "$run/runtime"
    echo "Isolated session: $run"
    exec env -u DISPLAY -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS -u SESSION_MANAGER \
        HOME="$run/home" XDG_CONFIG_HOME="$run/config" XDG_DATA_HOME="$run/data" \
        XDG_CACHE_HOME="$run/cache" XDG_STATE_HOME="$run/state" XDG_RUNTIME_DIR="$run/runtime" \
        GSETTINGS_BACKEND=keyfile GNOME_SHELL_SESSION_MODE=user PALETTE_TEST_SESSION="$run" \
        dbus-run-session -- "$0" --inside
fi
run=$PALETTE_TEST_SESSION
[[ $HOME == "$run/home" && $XDG_RUNTIME_DIR == "$run/runtime" && -z ${DISPLAY:-} && -z ${WAYLAND_DISPLAY:-} ]]
[[ $DBUS_SESSION_BUS_ADDRESS == unix:* ]]
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" > "$run/bus"
printf '%s\n' "HOME=$HOME" "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR" "BUS=$DBUS_SESSION_BUS_ADDRESS" > "$run/artifacts/isolation.txt"
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions/palette@namtt"
unzip -q "$root/palette@namtt.shell-extension.zip" -d "$XDG_DATA_HOME/gnome-shell/extensions/palette@namtt"
glib-compile-schemas --strict "$XDG_DATA_HOME/gnome-shell/extensions/palette@namtt/schemas"
cp -r "$root/dev/devtools@namtt" "$XDG_DATA_HOME/gnome-shell/extensions/"
gsettings set org.gnome.shell enabled-extensions '["devtools@namtt"]'
gsettings set org.gnome.shell disable-user-extensions false
export LIBGL_ALWAYS_SOFTWARE=1 WAYLAND_DISPLAY=palette-test
# Only update this freshly created private bus, never the host activation bus.
dbus-update-activation-environment HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR WAYLAND_DISPLAY GSETTINGS_BACKEND
# Palette is deliberately not enabled until the driver verifies the compositor.
gnome-shell --headless --wayland --no-x11 --wayland-display=palette-test --virtual-monitor=1280x800 > "$run/artifacts/shell.log" 2>&1 &
shell_pid=$!
echo "$shell_pid" > "$run/shell.pid"
trap 'kill "$shell_pid" 2>/dev/null || true' EXIT INT TERM
wait "$shell_pid"
