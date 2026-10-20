#!/usr/bin/env bash
# Source, then explicitly set PALETTE_DEV_DIR to the session path printed at startup.
_dev_control() {
    : "${PALETTE_DEV_DIR:?Set PALETTE_DEV_DIR to /tmp/palette-session.XXXXXX}"
    "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev/control.py" "$PALETTE_DEV_DIR" "$@"
}
dev_eval() { _dev_control eval "$1"; }
dev_shot() {
    _dev_control shot "$(basename "$1")" || return
    local source="$PALETTE_DEV_DIR/artifacts/$(basename "$1")"
    if [[ $1 != "$source" ]]; then
        for _ in {1..50}; do [[ -s $source ]] && break; sleep 0.1; done
        cp -- "$source" "$1"
    fi
}
dev_result() { _dev_control gdbus call --session --dest org.palette.Dev --object-path /org/palette/Dev --method org.palette.Dev.Result; }
dev_set_text() {
    local encoded
    encoded=$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
    dev_eval "(imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD,$encoded),true)"
}
dev_copy() { _dev_control wl-copy "$@"; }
dev_client() {
    : "${PALETTE_DEV_DIR:?Set the explicit isolated session path}"
    _dev_control gjs -m "$@" >"$PALETTE_DEV_DIR/artifacts/client.log" 2>&1 &
    DEV_CLIENT_PID=$!
}
dev_keys() {
    local tokens
    tokens=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@")
    dev_eval "(()=>{const C=imports.gi.Clutter,G=imports.gi.GLib;
        globalThis.__vk??=C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE);
        let t=G.get_monotonic_time();for(const tok of $tokens){const ks=tok.split('+').map(n=>C['KEY_'+n]);
        for(const k of ks)__vk.notify_keyval(t+=1000,k,C.KeyState.PRESSED);
        for(const k of ks.reverse())__vk.notify_keyval(t+=1000,k,C.KeyState.RELEASED);}return 'sent'})()"
}
