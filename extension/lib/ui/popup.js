import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {filterEntries} from '../core/search.js';
import {Row} from './row.js';

const POPUP_WIDTH = 380;
const MAX_LIST_HEIGHT = 340;
const POOL_SIZE = 20;          // rows alive at any time, however long the history is
const DEFAULT_ROW_HEIGHT = 30; // until the first row is measured
const PREVIEW_CHARS = 1500;
const FILTERS = [['all', 'All'], ['pinned', 'Pinned'], ['text', 'Text'], ['image', 'Images']];
const FOOTER_HINT = '↵ paste   Tab preview   Ctrl+P pin   Del remove';
const DEC = new TextDecoder();
const DEBUG = GLib.getenv('PALETTE_DEBUG') === '1';

function timed(label, fn) {
    if (!DEBUG) return fn();
    const t = GLib.get_monotonic_time();
    const r = fn();
    console.log(`palette: ${label} ${((GLib.get_monotonic_time() - t) / 1000).toFixed(2)}ms`);
    return r;
}

/**
 * Modal history popup: search box, filter chips, virtualised list, optional preview.
 *
 * The list holds POOL_SIZE reusable rows between a top and a bottom spacer, so
 * the scroll view sees the full height (n * rowHeight) and keeps its native
 * scrollbar, while only ~20 rows ever exist. Scrolling re-binds the rows to
 * the items now in view.
 *
 * Keyboard focus stays in the search entry; the highlighted item is tracked
 * here (#selected, an index into #items), so no focus traversal is involved.
 */
export class Popup {
    #store;
    #prefs;
    #onActivate;
    #backdrop = null;
    #box;
    #entry;
    #scroll;
    #vadj;
    #top;
    #bottom;
    #rows = [];
    #chips = [];
    #preview;
    #previewText;
    #previewImage;
    #footer;

    #grab = null;
    #isOpen = false;
    #kind = 'all';
    #items = [];
    #first = 0;           // item index shown by the first pool row
    #selected = -1;       // item index
    #rowHeight = DEFAULT_ROW_HEIGHT;
    #previewToken = 0;
    #unsubscribe = null;

    /**
     * @param {Store} store
     * @param {Prefs} prefs
     * @param {(entry) => void} onActivate  called after the popup closed
     */
    constructor(store, prefs, onActivate) {
        this.#store = store;
        this.#prefs = prefs;
        this.#onActivate = onActivate;
        this.#build();
    }

    get isOpen() {
        return this.#isOpen;
    }

    toggle() {
        if (this.#isOpen) this.close();
        else this.open();
    }

    open() {
        timed('open', () => this.#open());
    }

    close() {
        if (!this.#isOpen) return;
        this.#isOpen = false;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#previewToken++;

        Main.popModal(this.#grab);
        this.#grab = null;
        this.#backdrop.hide();
        this.#items = [];
    }

    destroy() {
        this.close();
        this.#backdrop?.destroy();
        this.#backdrop = null;
    }

    // ---- construction --------------------------------------------------

    #build() {
        this.#backdrop = new St.Widget({style_class: 'palette-backdrop', reactive: true, visible: false});
        // Clicking outside the popup closes it. Only the backdrop (the modal grab actor) sees
        // those clicks, and 'captured-event' is what the shell's own menus use to catch them;
        // event.get_source() only carries enter/leave, so ask the stage for the actor the pointer
        // is over instead. Never EVENT_STOP here, or the popup's own children stop working.
        this.#backdrop.connect('captured-event', (_a, event) => {
            const type = event.type();
            if ((type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) &&
                !this.#box.contains(global.stage.get_event_actor(event)))
                this.close();
            return Clutter.EVENT_PROPAGATE;
        });
        this.#backdrop.connect('key-press-event', (_a, event) => this.#onKey(event));
        Main.layoutManager.uiGroup.add_child(this.#backdrop);

        // reactive: clicks on the popup's own padding count as inside, so they don't close it.
        this.#box = new St.BoxLayout({style_class: 'palette-popup', vertical: true, width: POPUP_WIDTH, reactive: true});
        this.#backdrop.add_child(this.#box);

        const header = new St.BoxLayout({style_class: 'palette-header', vertical: true});
        this.#entry = new St.Entry({style_class: 'palette-search', hint_text: 'Search clipboard…', can_focus: true, x_expand: true});
        this.#entry.clutter_text.connect('text-changed', () => this.#refilter());
        // Handle keys before the text widget consumes them (Up/Down/Tab/Enter).
        this.#entry.clutter_text.connect('key-press-event', (_t, event) => this.#onKey(event));
        header.add_child(this.#entry);

        const chips = new St.BoxLayout({style_class: 'palette-chips'});
        for (const [kind, label] of FILTERS) {
            const chip = new St.Button({style_class: 'palette-chip', label, can_focus: false});
            chip.connect('clicked', () => this.#setKind(kind));
            this.#chips.push({kind, chip});
            chips.add_child(chip);
        }
        header.add_child(chips);
        this.#box.add_child(header);

        // list: [top spacer] [pool rows] [bottom spacer]
        this.#scroll = new St.ScrollView({
            style_class: 'palette-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        const list = new St.BoxLayout({style_class: 'palette-list', vertical: true});
        this.#top = new St.Widget();
        this.#bottom = new St.Widget();
        list.add_child(this.#top);
        const ctx = this.#rowContext();
        for (let i = 0; i < POOL_SIZE; i++) {
            const row = new Row(ctx);
            row.actor.hide();
            this.#rows.push(row);
            list.add_child(row.actor);
        }
        list.add_child(this.#bottom);
        this.#scroll.add_child(list);
        this.#vadj = this.#scroll.vadjustment;
        this.#vadj.connect('notify::value', () => this.#render());
        this.#box.add_child(this.#scroll);

        this.#preview = new St.BoxLayout({style_class: 'palette-preview', vertical: true, visible: false});
        this.#previewText = new St.Label({style_class: 'palette-preview-text'});
        this.#previewText.clutter_text.set({line_wrap: true, ellipsize: Pango.EllipsizeMode.END});
        this.#previewImage = new St.Icon({style_class: 'palette-preview-image', icon_size: 160, visible: false});
        this.#preview.add_child(this.#previewText);
        this.#preview.add_child(this.#previewImage);
        this.#box.add_child(this.#preview);

        this.#footer = new St.Label({style_class: 'palette-footer', text: FOOTER_HINT});
        this.#box.add_child(this.#footer);
    }

    #rowContext() {
        return {
            blobFile: e => this.#store.blobFile(e),
            onActivate: row => this.#activate(row.entry),
            onHover: row => this.#select(row.index, {scroll: false}),
            onTogglePin: row => this.#store.setPinned(row.entry.id, !row.entry.pinned),
            onDelete: row => this.#store.remove(row.entry.id),
        };
    }

    #open() {
        if (this.#isOpen) return;

        const monitor = Main.layoutManager.currentMonitor;
        this.#backdrop.set_position(monitor.x, monitor.y);
        this.#backdrop.set_size(monitor.width, monitor.height);
        Main.layoutManager.uiGroup.set_child_above_sibling(this.#backdrop, null);
        this.#backdrop.show();

        this.#grab = Main.pushModal(this.#backdrop, {actionMode: Shell.ActionMode.POPUP});
        if (!this.#grab) {
            this.#backdrop.hide();
            return;
        }
        this.#isOpen = true;

        this.#entry.set_text('');
        this.#setKind('all', false);
        this.#refilter();
        this.#place(monitor);
        this.#entry.grab_key_focus();
        this.#unsubscribe = this.#store.connect(() => this.#refilter({keepSelection: true}));
    }

    /** Position the popup near the pointer (or centred), kept inside the work area. */
    #place(monitor) {
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.findIndexForActor(this.#backdrop));
        const [, , natW, natH] = this.#box.get_preferred_size();
        const w = Math.min(natW, area.width), h = Math.min(natH, area.height);

        let x, y;
        if (this.#prefs.popupAtCursor) {
            const [px, py] = global.get_pointer();
            x = px - w / 2;
            y = py + 8;
        } else {
            x = area.x + (area.width - w) / 2;
            y = area.y + (area.height - h) / 3;
        }
        x = Math.round(Math.max(area.x, Math.min(x, area.x + area.width - w))) - monitor.x;
        y = Math.round(Math.max(area.y, Math.min(y, area.y + area.height - h))) - monitor.y;
        this.#box.set_position(x, y);
    }

    // ---- list ----------------------------------------------------------

    #setKind(kind, refilter = true) {
        this.#kind = kind;
        for (const {kind: k, chip} of this.#chips) {
            if (k === kind) chip.add_style_pseudo_class('checked');
            else chip.remove_style_pseudo_class('checked');
        }
        if (refilter) this.#refilter();
    }

    #refilter(opts) {
        timed('refilter', () => this.#doRefilter(opts));
    }

    #doRefilter({keepSelection = false} = {}) {
        const keepId = keepSelection ? this.#items[this.#selected]?.id : undefined;
        const prev = this.#selected;
        this.#items = filterEntries(this.#store.list(), this.#entry.get_text(), this.#kind);

        let sel = -1;
        if (this.#items.length) {
            sel = keepId === undefined ? 0 : this.#items.findIndex(e => e.id === keepId);
            if (sel < 0) sel = Math.min(Math.max(prev, 0), this.#items.length - 1);
        }
        this.#selected = sel;

        this.#measureRows();
        this.#scroll.set_height(Math.min(this.#items.length * this.#rowHeight, MAX_LIST_HEIGHT));
        this.#scroll.visible = this.#items.length > 0;
        this.#footer.text = this.#items.length ? FOOTER_HINT : 'Nothing here yet';

        if (!keepSelection) this.#vadj.value = 0;
        this.#render(true);
        if (keepSelection && sel >= 0) this.#ensureVisible(sel);
        if (this.#preview.visible) this.#updatePreview();
    }

    /** Row height is fixed by the stylesheet; read it once from a real row (it follows text scaling). */
    #measureRows() {
        const h = Math.round(this.#rows[0].actor.get_preferred_height(-1)[1]);
        if (h > 0) this.#rowHeight = h;
    }

    /** Re-bind the pool to the items around the scroll position. */
    #render(force = false) {
        const n = this.#items.length;
        const first = Math.max(0, Math.min(Math.floor(this.#vadj.value / this.#rowHeight) - 1, n - POOL_SIZE));
        if (!force && first === this.#first) return;
        this.#first = first;

        const shown = Math.max(0, Math.min(POOL_SIZE, n - first));
        for (let k = 0; k < POOL_SIZE; k++) {
            const row = this.#rows[k];
            if (k < shown) {
                row.bind(this.#items[first + k], first + k);
                row.setSelected(first + k === this.#selected);
                row.actor.show();
            } else {
                row.actor.hide();
            }
        }
        this.#top.set_height(first * this.#rowHeight);
        this.#bottom.set_height((n - first - shown) * this.#rowHeight);
    }

    #rowFor(index) {
        const k = index - this.#first;
        return k >= 0 && k < POOL_SIZE && index < this.#items.length ? this.#rows[k] : null;
    }

    #select(index, {scroll = true} = {}) {
        if (index === this.#selected || index < 0 || index >= this.#items.length) return;
        this.#rowFor(this.#selected)?.setSelected(false);
        this.#selected = index;
        this.#rowFor(index)?.setSelected(true);
        if (scroll) this.#ensureVisible(index);
        if (this.#preview.visible) this.#updatePreview();
    }

    #ensureVisible(index) {
        const top = index * this.#rowHeight;
        const page = this.#vadj.page_size || MAX_LIST_HEIGHT;
        if (top < this.#vadj.value) this.#vadj.value = top;
        else if (top + this.#rowHeight > this.#vadj.value + page) this.#vadj.value = top + this.#rowHeight - page;
    }

    // ---- actions -------------------------------------------------------

    #activate(entry) {
        this.close();
        this.#onActivate(entry);
    }

    #onKey(event) {
        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const alt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const last = this.#items.length - 1;
        const page = Math.max(1, Math.floor((this.#vadj.page_size || MAX_LIST_HEIGHT) / this.#rowHeight) - 1);
        const selectedEntry = this.#items[this.#selected];

        if (alt && sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9) {
            const entry = this.#items[sym - Clutter.KEY_1];
            if (entry) this.#activate(entry);
            return Clutter.EVENT_STOP;
        }
        if (ctrl && sym >= Clutter.KEY_1 && sym <= Clutter.KEY_4) {
            this.#setKind(FILTERS[sym - Clutter.KEY_1][0]);
            return Clutter.EVENT_STOP;
        }

        switch (sym) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this.#select(Math.min(this.#selected + 1, last));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this.#select(Math.max(this.#selected - 1, 0));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this.#select(Math.min(this.#selected + page, last));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this.#select(Math.max(this.#selected - page, 0));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            if (selectedEntry) this.#activate(selectedEntry);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Delete:
            if (selectedEntry) this.#store.remove(selectedEntry.id); // store change → #refilter keeps the position
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            this.#togglePreview();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_p:
        case Clutter.KEY_P:
            if (!ctrl) return Clutter.EVENT_PROPAGATE;
            if (selectedEntry) this.#store.setPinned(selectedEntry.id, !selectedEntry.pinned);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // ---- preview -------------------------------------------------------

    #togglePreview() {
        this.#preview.visible = !this.#preview.visible;
        if (this.#preview.visible) this.#updatePreview();
        else this.#previewToken++;
    }

    async #updatePreview() {
        const token = ++this.#previewToken;
        const entry = this.#items[this.#selected];
        if (!entry) {
            this.#previewText.text = '';
            this.#previewImage.visible = false;
            return;
        }

        if (entry.kind === 'image') {
            this.#previewText.visible = false;
            this.#previewImage.gicon = new Gio.FileIcon({file: this.#store.blobFile(entry)});
            this.#previewImage.visible = true;
            return;
        }

        this.#previewImage.visible = false;
        this.#previewText.visible = true;
        if (entry.inline !== null) {
            this.#previewText.text = entry.inline;
            return;
        }
        this.#previewText.text = entry.preview;
        const content = await this.#store.readContent(entry.id);
        if (token !== this.#previewToken || !content) return;
        const text = DEC.decode(content.bytes.subarray(0, PREVIEW_CHARS * 4));
        this.#previewText.text = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
    }
}
