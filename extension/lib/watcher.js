import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {hashData} from './core/hash.js';
import {writeThumbnail} from './thumbs.js';

const CLIPBOARD = St.ClipboardType.CLIPBOARD;
const TEXT_MIMES = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING'];
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const STORED_TEXT_MIME = 'text/plain;charset=utf-8';
// Password managers set this hint on secrets they put on the clipboard.
const SECRET_HINT = 'x-kde-passwordManagerHint';
const DEBUG = GLib.getenv('PALETTE_DEBUG') === '1';
const DEC = new TextDecoder();

/** Records clipboard changes into the Store. */
export class Watcher {
    #store;
    #prefs;
    #clipboard = St.Clipboard.get_default();
    #selection = global.display.get_selection();
    #handlerId = 0;
    #busy = false;
    #again = false;
    #stopped = false;

    constructor(store, prefs) {
        this.#store = store;
        this.#prefs = prefs;
    }

    start() {
        this.#handlerId = this.#selection.connect('owner-changed', (_sel, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD) this.#schedule();
        });
        this.#schedule(); // capture whatever is on the clipboard right now
    }

    stop() {
        this.#stopped = true;
        if (this.#handlerId) this.#selection.disconnect(this.#handlerId);
        this.#handlerId = 0;
    }

    /** Coalesce events that arrive while a read is in flight into one re-read. */
    #schedule() {
        if (this.#busy) {
            this.#again = true;
            return;
        }
        this.#busy = true;
        this.#capture()
            .catch(err => console.error(`palette: capture failed: ${err.message}`))
            .finally(() => {
                this.#busy = false;
                if (this.#again && !this.#stopped) {
                    this.#again = false;
                    this.#schedule();
                }
            });
    }

    async #capture() {
        if (this.#prefs.privateMode || this.#isExcludedAppFocused()) return;

        const t0 = GLib.get_monotonic_time();
        const mimes = this.#clipboard.get_mimetypes(CLIPBOARD);
        if (mimes.includes(SECRET_HINT)) return;

        const textMime = TEXT_MIMES.find(m => mimes.includes(m));
        const imageMime = textMime || this.#prefs.maxImageBytes === 0 ? null : IMAGE_MIMES.find(m => mimes.includes(m));
        const mime = textMime ?? imageMime;
        if (!mime) return;
        const isText = mime === textMime;

        const data = await this.#getContent(mime);
        if (this.#stopped || !data) return;
        const size = data.length;
        if (size === 0 || size > (isText ? this.#prefs.maxTextBytes : this.#prefs.maxImageBytes)) return;

        const hash = await hashData(data);
        if (this.#stopped) return;
        if (this.#store.touchByHash(hash)) return this.#debug(t0, 'touch', size);

        if (isText) {
            const text = DEC.decode(data);
            if (text.trim() === '') return;
            this.#store.add({hash, kind: 'text', mime: STORED_TEXT_MIME, data, text});
        } else {
            const entry = this.#store.add({hash, kind: 'image', mime, data});
            // After the blob write: the thumbnail is read from that file.
            this.#store.flush()
                .then(() => writeThumbnail(this.#store.blobFile(entry), this.#store.thumbFile(entry)))
                .catch(err => console.error(`palette: thumbnail failed: ${err.message}`));
        }
        this.#debug(t0, isText ? 'text' : 'image', size);
    }

    #getContent(mime) {
        return new Promise(resolve => this.#clipboard.get_content(CLIPBOARD, mime, (_c, bytes) => {
            // `bytes` is only valid inside this callback (using it later segfaults the shell): copy it out.
            resolve(bytes ? bytes.toArray() : null);
        }));
    }

    #isExcludedAppFocused() {
        const excluded = this.#prefs.excludedApps;
        if (excluded.length === 0) return false;
        const cls = global.display.focus_window?.get_wm_class()?.toLowerCase();
        return !!cls && excluded.includes(cls);
    }

    #debug(t0, what, size) {
        if (DEBUG) console.log(`palette: captured ${what} ${size}B in ${((GLib.get_monotonic_time() - t0) / 1000).toFixed(2)}ms`);
    }
}
