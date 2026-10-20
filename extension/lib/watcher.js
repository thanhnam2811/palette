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
    #ignoreMemoryOwner = false;

    constructor(store, prefs) {
        this.#store = store;
        this.#prefs = prefs;
    }

    start() {
        this.#handlerId = this.#selection.connect('owner-changed', (_sel, type, owner) => {
            if (type !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
            // GNOME preserves an exiting Wayland owner's text in a memory
            // source, dropping its password-manager hint. Keep the original
            // privacy decision across null → memory ownership transitions.
            if (!owner) return;
            if (owner instanceof Meta.SelectionSourceMemory && this.#ignoreMemoryOwner) return;
            this.#ignoreMemoryOwner = this.#prefs.privateMode || this.#isExcludedAppFocused() ||
                this.#clipboard.get_mimetypes(CLIPBOARD).includes(SECRET_HINT);
            if (!this.#ignoreMemoryOwner) this.#schedule();
        });
        // The clipboard may hold a password copied before the extension was
        // enabled; only record it when the user opted in (capture-on-start).
        if (this.#prefs.captureOnStart) this.#schedule();
    }

    /** An explicit history/emoji choice replaces any ignored persisted selection. */
    prepareUserSelection() {
        this.#ignoreMemoryOwner = false;
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
        if (mimes.includes(SECRET_HINT)) {
            this.#ignoreMemoryOwner = true;
            return;
        }

        const textMime = TEXT_MIMES.find(m => mimes.includes(m));
        const imageMime = textMime || this.#prefs.maxImageBytes === 0 ? null : IMAGE_MIMES.find(m => mimes.includes(m));
        const mime = textMime ?? imageMime;
        if (!mime) return;
        const isText = mime === textMime;
        const maxBytes = isText ? this.#prefs.maxTextBytes : this.#prefs.maxImageBytes;

        const data = await this.#getContent(mime, maxBytes);
        if (this.#stopped || !data || this.#prefs.privateMode) return;
        const size = data.length;
        if (size === 0 || size > maxBytes) return;

        const hash = await hashData(data);
        // Private mode can be switched on while the read/hash is in flight; do
        // not persist content the user asked us to stop recording.
        if (this.#stopped || this.#prefs.privateMode) return;
        if (this.#store.touchByHash(hash)) return this.#debug(t0, 'touch', size);

        if (isText) {
            const text = DEC.decode(data);
            if (text.trim() === '') return;
            this.#store.add({hash, kind: 'text', mime: STORED_TEXT_MIME, data, text});
        } else {
            const entry = this.#store.add({hash, kind: 'image', mime, data});
            // After the blob write: the thumbnail is read from that file. Skip it
            // when the entry was dropped (failed write) or deleted meanwhile.
            this.#store.flush()
                .then(() => this.#store.get(entry.id) ? writeThumbnail(this.#store.blobFile(entry), this.#store.thumbFile(entry)) : undefined)
                .catch(err => console.error(`palette: thumbnail failed: ${err.message}`));
        }
        this.#debug(t0, isText ? 'text' : 'image', size);
    }

    #getContent(mime, maxBytes) {
        return new Promise(resolve => this.#clipboard.get_content(CLIPBOARD, mime, (_c, bytes) => {
            // `bytes` is only valid inside this callback (using it later segfaults the shell): copy it out.
            // Oversized content is rejected before toArray(), so a huge image is
            // not copied a second time on the shell's main loop.
            if (!bytes || bytes.get_size() > maxBytes) {
                resolve(null);
                return;
            }
            resolve(bytes.toArray());
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
