import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Store} from './lib/core/store.js';
import {Prefs} from './lib/settings.js';
import {Watcher} from './lib/watcher.js';
import {Paster} from './lib/paste.js';
import {Popup} from './lib/ui/popup.js';
import {Indicator} from './lib/ui/indicator.js';

const SHORTCUT_KEY = 'toggle-shortcut';
const EMOJI_SHORTCUT_KEY = 'emoji-shortcut';

export default class PaletteExtension extends Extension {
    #generation = 0; // bumped by enable/disable so a slow #start() can tell it was superseded
    #enabled = false;
    #prefs = null;
    #store = null;
    #watcher = null;
    #paster = null;
    #popup = null;
    #indicator = null;
    #unwatchPrefs = null;
    #sweepId = 0;

    // Read-only handles for dev tooling (dev/devtools@namtt) and tests.
    get store() { return this.#store; }
    get popup() { return this.#popup; }

    enable() {
        this.#enabled = true;
        this.#start(++this.#generation).catch(err => console.error(`palette: failed to start: ${err.stack ?? err.message}`));
    }

    disable() {
        this.#enabled = false;
        this.#generation++;
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        Main.wm.removeKeybinding(EMOJI_SHORTCUT_KEY);
        if (this.#sweepId) GLib.source_remove(this.#sweepId);
        this.#sweepId = 0;
        this.#unwatchPrefs?.();
        this.#watcher?.stop();
        this.#popup?.destroy();
        this.#indicator?.destroy();
        this.#paster?.destroy();
        this.#store?.destroy();
        this.#unwatchPrefs = this.#watcher = this.#popup = this.#indicator = this.#paster = this.#store = this.#prefs = null;
    }

    async #start(generation) {
        const prefs = new Prefs(this.getSettings());
        const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'palette']);
        const store = await Store.open(dir, prefs.limits);
        if (generation !== this.#generation) { // disabled (or re-enabled) while the log was loading
            store.destroy();
            return;
        }

        this.#prefs = prefs;
        this.#store = store;
        this.#paster = new Paster();
        this.#popup = new Popup(store, prefs, {
            onActivate: entry => this.#paste(entry),
            emojiPath: `${this.path}/data/emoji.json`,
            onEmoji: glyph => this.#insertEmoji(glyph),
        });
        this.#indicator = new Indicator(this.uuid, prefs, {
            open: () => this.#popup.open(),
            clear: () => store.clear({keepPinned: true}),
            openPrefs: () => this.openPreferences(),
        });
        this.#watcher = new Watcher(store, prefs);
        this.#watcher.start();

        const flags = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        Main.wm.addKeybinding(SHORTCUT_KEY, prefs.raw, flags, modes, () => this.#popup.toggle());
        Main.wm.addKeybinding(EMOJI_SHORTCUT_KEY, prefs.raw, flags, modes, () => this.#popup.toggleEmoji());

        // Orphan blobs (crash between blob write and log append) are collected once, off the startup path.
        this.#sweepId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE, 10, () => {
            this.#sweepId = 0;
            store.sweepOrphans().catch(err => console.error(`palette: sweep failed: ${err.message}`));
            return GLib.SOURCE_REMOVE;
        });

        this.#unwatchPrefs = prefs.connect(() => {
            store.setLimits(prefs.limits);
            this.#indicator.sync();
        });
    }

    /** Put `entry` on the clipboard and, if enabled, paste it into the focused window. */
    async #paste(entry) {
        const content = await this.#store?.readContent(entry.id);
        if (!content) {
            this.#store?.remove(entry.id); // blob vanished: drop the dead entry
            return;
        }
        if (!this.#enabled) return;

        St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, content.mime, new GLib.Bytes(content.bytes));
        this.#pasteIntoFocused();
    }

    /** Put `glyph` on the clipboard and paste it; the watcher records it in the history. */
    #insertEmoji(glyph) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, glyph);
        this.#pasteIntoFocused();
    }

    #pasteIntoFocused() {
        if (!this.#prefs.pasteOnSelect) return;
        const cls = global.display.focus_window?.get_wm_class()?.toLowerCase();
        this.#paster.pasteSoon({shift: !!cls && this.#prefs.terminalApps.includes(cls)});
    }
}
