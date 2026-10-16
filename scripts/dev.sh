#!/usr/bin/env bash
# Helpers for talking to the dev shell started by dev-shell.sh. Source this file.
#   dev_eval 'Main.layoutManager.monitors.length'
#   dev_shot /tmp/x.png
#   dev_copy "text"          (wl-copy into the dev shell's clipboard)
#   dev_log                  (shell journal of the dev session is dev-shell's stdout)
export PALETTE_DEV_DIR=${PALETTE_DEV_DIR:-/tmp/palette-dev}

_dbus_addr() {
    # dbus-run-session exports its address only to children; read it from the shell process env
    local pid; pid=$(pgrep -f "^gnome-shell --headless" | head -1)
    tr '\0' '\n' < /proc/$pid/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'
}

dev_eval() {
    DBUS_SESSION_BUS_ADDRESS=$(_dbus_addr) gdbus call --session --dest org.palette.Dev --object-path /org/palette/Dev \
        --method org.palette.Dev.Eval "$1"
}
dev_result() {
    DBUS_SESSION_BUS_ADDRESS=$(_dbus_addr) gdbus call --session --dest org.palette.Dev --object-path /org/palette/Dev \
        --method org.palette.Dev.Result
}
dev_shot() {
    DBUS_SESSION_BUS_ADDRESS=$(_dbus_addr) gdbus call --session --dest org.palette.Dev --object-path /org/palette/Dev \
        --method org.palette.Dev.Screenshot "$1"
}
dev_copy() {
    # wl-copy stays alive to serve the selection; detach it so callers don't wait on its stdout.
    XDG_RUNTIME_DIR=$PALETTE_DEV_DIR/runtime WAYLAND_DISPLAY=palette-dev setsid wl-copy "$@" >/dev/null 2>&1 </dev/stdin
}

# Put text on the dev shell's clipboard from inside the shell (headless mutter has no focus, so wl-copy can't).
dev_set_text() {
    dev_eval "imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD, $(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'))"
}

# Type keys into the dev shell through a virtual keyboard: dev_keys g i t Down Control_L+p Return
# (tokens are Clutter.KEY_* names; "A+B" presses A then B, releases in reverse)
dev_keys() {
    local toks; toks=$(printf '"%s",' "$@")
    dev_eval "(()=>{const C=imports.gi.Clutter,G=imports.gi.GLib;
      globalThis.__vk ??= C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE);
      let t=G.get_monotonic_time();
      for (const tok of [${toks%,}]) { const ks=tok.split('+').map(n=>C['KEY_'+n]);
        for (const k of ks) globalThis.__vk.notify_keyval(t+=1000,k,C.KeyState.PRESSED);
        for (const k of ks.reverse()) globalThis.__vk.notify_keyval(t+=1000,k,C.KeyState.RELEASED); }
      return 'sent'})()"
}

# Run a GTK client inside the dev session (e.g. bench/shell/clip-client.js).
dev_client() {
    DBUS_SESSION_BUS_ADDRESS=$(_dbus_addr) XDG_RUNTIME_DIR=$PALETTE_DEV_DIR/runtime WAYLAND_DISPLAY=palette-dev \
        GDK_BACKEND=wayland setsid gjs -m "$@" >/tmp/palette-client.log 2>&1 </dev/null &
}
