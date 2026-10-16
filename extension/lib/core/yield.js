import GLib from 'gi://GLib';

/** Resolve on a later main-loop turn, after pending drawing/input work (idle priority). */
export function yieldToMainLoop() {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}
