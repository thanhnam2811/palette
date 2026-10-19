import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

/**
 * The seat keeps every virtual device it creates, and Clutter has no destroy()
 * for them: creating one per Paster leaks one input device per enable/disable
 * cycle (measured: 2 → 3 → 4 → 5 over three cycles). run_dispose() would free
 * it but shexli/EGO flags it (EGO-X-003), so share a single device for the
 * session instead — it only ever emits keys when a paste is in flight.
 */
let device = null;

function keyDevice() {
    device ??= Clutter.get_default_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    return device;
}

/** Types Ctrl+V (Ctrl+Shift+V for terminals) through a virtual keyboard. */
export class Paster {
    #device = keyDevice();
    #timeoutId = 0;

    /** Paste after `delayMs`, giving the previously focused window time to regain focus. */
    pasteSoon({shift = false, delayMs = 60} = {}) {
        this.#cancel();
        this.#timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this.#timeoutId = 0;
            this.#paste(shift);
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this.#cancel();
        this.#device = null;
    }

    #cancel() {
        if (!this.#timeoutId) return;
        GLib.source_remove(this.#timeoutId);
        this.#timeoutId = 0;
    }

    #paste(shift) {
        const keys = shift
            ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
            : [Clutter.KEY_Control_L, Clutter.KEY_v];
        for (const k of keys) this.#key(k, Clutter.KeyState.PRESSED);
        for (const k of keys.reverse()) this.#key(k, Clutter.KeyState.RELEASED);
    }

    #key(keyval, state) {
        this.#device.notify_keyval(GLib.get_monotonic_time(), keyval, state);
    }
}
