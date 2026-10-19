import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {filterEntries} from '../core/search.js';
import {EmojiData} from '../core/emoji.js';
import {EmojiRow} from './emoji-row.js';
import {Row} from './row.js';

const POPUP_WIDTH = 380;
const MAX_LIST_HEIGHT = 340;
const POOL_SIZE = 20;          // rows alive at any time, however long the history is
const DEFAULT_ROW_HEIGHT = 30; // until the first row is measured
const PREVIEW_CHARS = 1500;
const FILTERS = [['all', 'All'], ['pinned', 'Pinned'], ['text', 'Text'], ['image', 'Images']];
const FOOTER_HINT = '↵ paste   Tab preview   Ctrl+P pin   Del remove';
const EMOJI_COLS = 9;            // cells per grid line
const EMOJI_POOL_SIZE = 12;      // grid lines alive at once (see MAX_LIST_HEIGHT / cell height)
const EMOJI_ROW_HEIGHT = 34;     // until the first grid line is measured
const EMOJI_FOOTER_HINT = '↵ insert   ←↑↓→ move   Tab group';
const DEC = new TextDecoder();
const DEBUG = GLib.getenv('PALETTE_DEBUG') === '1';

function timed(label, fn) {
    if (!DEBUG) return fn();
    const t = GLib.get_monotonic_time();
    const r = fn();
    if (r instanceof Promise) {
        return r.finally(() => {
            console.log(`palette: ${label} ${((GLib.get_monotonic_time() - t) / 1000).toFixed(2)}ms`);
        });
    }
    console.log(`palette: ${label} ${((GLib.get_monotonic_time() - t) / 1000).toFixed(2)}ms`);
    return r;
}

/**
 * Modal popup with two modes: clipboard history (search, filter chips,
 * virtualised list, optional preview) and an emoji picker (search, group chips,
 * virtualised grid). Both share the overlay, grab, placement and key handling.
 *
 * The list holds a small pool of reusable rows between a top and a bottom
 * spacer, so the scroll view sees the full height and keeps its native
 * scrollbar, while only a dozen rows ever exist. Scrolling re-binds the rows to
 * the items now in view.
 *
 * Keyboard focus stays in the search entry; the highlighted item is tracked
 * here (#selected, an index into #items), so no focus traversal is involved.
 */
export class Popup {
    #store;
    #prefs;
    #onActivate;
    #onEmoji;
    #emojiPath;
    #emojiData = null;
    #backdrop = null;
    #box;
    #entry;
    #chipBox;
    #list;
    #scroll;
    #vadj;
    #top;
    #bottom;
    #rows = [];
    #chips = [];
    #preview;
    #previewText;
    #previewImage;
    #stage;
    #stageText;
    #stageClear;
    #stageInsert;
    #footer;

    #grab = null;
    #isOpen = false;
    #mode = 'history';    // 'history' | 'emoji'
    #kind = 'all';        // history: filter chip
    #group = -1;          // emoji: group index, -1 for all
    #items = [];
    #staged = [];
    #lastAction = '';
    #first = 0;           // row index shown by the first pool row
    #selected = -1;       // item index
    #rowHeight = DEFAULT_ROW_HEIGHT;
    #previewToken = 0;
    #unsubscribe = null;

    /**
     * @param {Store} store
     * @param {Prefs} prefs
     * @param {object} opts
     * @param {(entry) => void} opts.onActivate  called after the history popup closed
     * @param {string} opts.emojiPath            path to data/emoji.json
     * @param {(glyph) => void} opts.onEmoji     called after the picker closed
     */
    constructor(store, prefs, {onActivate, emojiPath, onEmoji}) {
        this.#store = store;
        this.#prefs = prefs;
        this.#onActivate = onActivate;
        this.#emojiPath = emojiPath;
        this.#onEmoji = onEmoji;
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
        timed('open', () => this.#open('history'));
    }

    /**
     * Open the emoji picker, loading its data on first use (0.91 ms, then cached;
     * E11 in docs/BENCH.md). Pressing the shortcut again closes it.
     */
    async toggleEmoji() {
        if (this.#isOpen && this.#mode === 'emoji') {
            this.close();
            return;
        }
        try {
            this.#emojiData ??= await timed('emoji load', () => EmojiData.load(this.#emojiPath));
        } catch (err) {
            console.error(`palette: cannot read ${this.#emojiPath}: ${err.message}`);
            return;
        }
        if (this.#isOpen) this.close();
        try {
            timed('emoji open', () => this.#open('emoji'));
        } catch (err) {
            // A half-built popup would stay grabbed forever, so drop it loudly.
            console.error(`palette: cannot open the emoji picker: ${err.message}`);
            this.close();
        }
    }

    close() {
        if (!this.#isOpen) return;
        this.#isOpen = false;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#previewToken++;
        this.#staged = [];
        this.#lastAction = '';
        if (this.#stage) this.#stage.visible = false;

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
                !this.#box.contains(global.stage.get_event_actor(event))) {
                if (this.#mode === 'emoji' && this.#staged.length > 0)
                    this.#commitStaged();
                else
                    this.close();
            }
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
        this.#chipBox = chips;
        header.add_child(chips);
        this.#buildChips();
        this.#box.add_child(header);

        // list: [top spacer] [pool rows] [bottom spacer]
        this.#scroll = new St.ScrollView({
            style_class: 'palette-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this.#list = new St.BoxLayout({style_class: 'palette-list', vertical: true});
        this.#top = new St.Widget();
        this.#bottom = new St.Widget();
        this.#list.add_child(this.#top);
        this.#list.add_child(this.#bottom);
        this.#rebuildRows();
        this.#scroll.add_child(this.#list);
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

        this.#stage = new St.BoxLayout({style_class: 'palette-stage', vertical: false, visible: false, x_expand: true});
        this.#stageText = new St.Label({style_class: 'palette-stage-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.#stageText.clutter_text.set({ellipsize: Pango.EllipsizeMode.START, single_line_mode: true});
        this.#stageClear = new St.Button({style_class: 'palette-stage-clear', label: '✕', can_focus: false, y_align: Clutter.ActorAlign.CENTER});
        this.#stageClear.connect('clicked', () => this.#clearStaged());
        this.#stageInsert = new St.Button({style_class: 'palette-stage-btn', label: 'Paste', can_focus: false, y_align: Clutter.ActorAlign.CENTER});
        this.#stageInsert.connect('clicked', () => this.#commitStaged());
        this.#stage.add_child(this.#stageText);
        this.#stage.add_child(this.#stageClear);
        this.#stage.add_child(this.#stageInsert);
        this.#box.add_child(this.#stage);

        this.#footer = new St.Label({style_class: 'palette-footer', text: FOOTER_HINT, x_expand: true});
        this.#footer.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.#box.add_child(this.#footer);
    }

    /** (Re)create the row pool for the current mode: history lines or emoji grid lines. */
    #rebuildRows() {
        for (const row of this.#rows) row.destroy();
        this.#rows = [];
        const emoji = this.#mode === 'emoji';
        const count = emoji ? EMOJI_POOL_SIZE : POOL_SIZE;
        for (let i = 0; i < count; i++) {
            const row = emoji ? new EmojiRow(EMOJI_COLS, this.#emojiContext()) : new Row(this.#rowContext());
            row.actor.hide();
            this.#list.insert_child_below(row.actor, this.#bottom);
            this.#rows.push(row);
        }
        this.#rowHeight = emoji ? EMOJI_ROW_HEIGHT : DEFAULT_ROW_HEIGHT;
    }

    /** (Re)create the chips: history kinds or emoji groups (icon + tooltip). */
    #buildChips() {
        this.#chips = [];
        this.#chipBox.destroy_all_children();
        if (this.#mode === 'emoji') {
            const groups = this.#emojiData?.groups ?? [];
            const entries = [[-1, 'All', 'All groups']];
            groups.forEach((name, i) => entries.push([i, this.#emojiData.groupGlyphs[i], name]));
            for (const [group, label] of entries) {
                // Glyph-only chips: 10 groups do not fit as text in this width, and
                // St has no tooltips. The name is visible in the footer once the
                // group is selected, and after a click the grid shows its contents.
                const chip = new St.Button({style_class: 'palette-chip palette-chip-icon', can_focus: false, label});
                chip.connect('clicked', () => this.#setGroup(group));
                this.#chips.push({group, chip});
                this.#chipBox.add_child(chip);
            }
            return;
        }
        for (const [kind, label] of FILTERS) {
            const chip = new St.Button({style_class: 'palette-chip', label, can_focus: false});
            chip.connect('clicked', () => this.#setKind(kind));
            this.#chips.push({kind, chip});
            this.#chipBox.add_child(chip);
        }
    }

    /** Switch modes: rows, chips, placeholder and footer all follow. */
    #setMode(mode) {
        if (this.#mode === mode) return;
        this.#mode = mode;
        this.#clearStaged();
        this.#rebuildRows();
        this.#buildChips();
        this.#entry.hint_text = mode === 'emoji' ? 'Search emoji…' : 'Search clipboard…';
        this.#preview.visible = false;
        this.#previewToken++;
        this.#footer.text = mode === 'emoji' ? EMOJI_FOOTER_HINT : FOOTER_HINT;
    }

    #rowContext() {
        return {
            iconFile: e => this.#store.iconFile(e),
            onActivate: row => this.#activate(row.entry),
            onHover: row => this.#select(row.index, {scroll: false}),
            onTogglePin: row => this.#store.setPinned(row.entry.id, !row.entry.pinned),
            onDelete: row => this.#store.remove(row.entry.id),
        };
    }

    #emojiContext() {
        return {
            onActivate: index => this.#activateEmoji(index),
            onHover: index => this.#select(index, {scroll: false}),
        };
    }

    #open(mode) {
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

        this.#setMode(mode);
        this.#entry.set_text('');
        if (mode === 'emoji') this.#setGroup(-1, false);
        else this.#setKind('all', false);
        this.#refilter();
        this.#place(monitor);
        this.#entry.grab_key_focus();
        if (mode === 'history')
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

    #setGroup(group, refilter = true) {
        this.#group = group;
        for (const {group: g, chip} of this.#chips) {
            if (g === group) chip.add_style_pseudo_class('checked');
            else chip.remove_style_pseudo_class('checked');
        }
        if (refilter) this.#refilter();
    }

    /** Tab in the emoji picker: walk All → group 0 → … → last → All. */
    #nextGroup() {
        const n = this.#emojiData?.groups.length ?? 0;
        this.#setGroup(this.#group >= n - 1 ? -1 : this.#group + 1);
    }

    #refilter(opts) {
        timed('refilter', () => this.#doRefilter(opts));
    }

    #doRefilter({keepSelection = false} = {}) {
        const query = this.#entry.get_text();
        if (query) this.#lastAction = 'search';
        const emoji = this.#mode === 'emoji';
        const keepId = keepSelection ? this.#items[this.#selected]?.id : undefined;
        const prev = this.#selected;
        this.#items = emoji
            ? (this.#emojiData?.search(query, this.#group) ?? [])
            : filterEntries(this.#store.list(), query, this.#kind);

        let sel = -1;
        if (this.#items.length) {
            sel = keepId === undefined ? 0 : this.#items.findIndex(e => e.id === keepId);
            if (sel < 0) sel = Math.min(Math.max(prev, 0), this.#items.length - 1);
        }
        this.#selected = sel;

        const lines = emoji ? Math.ceil(this.#items.length / EMOJI_COLS) : this.#items.length;
        this.#measureRows();
        this.#scroll.set_height(Math.min(lines * this.#rowHeight, MAX_LIST_HEIGHT));
        this.#scroll.visible = this.#items.length > 0;
        this.#footer.text = this.#items.length
            ? (emoji ? this.#emojiFooter() : FOOTER_HINT)
            : (emoji ? 'No emoji match' : 'Nothing here yet');

        if (!keepSelection) this.#vadj.value = 0;
        this.#render(true);
        if (keepSelection && sel >= 0) this.#ensureVisible(sel);
        if (!emoji && this.#preview.visible) this.#updatePreview();
    }

    #emojiFooter() {
        if (this.#staged.length > 0) {
            const item = this.#items[this.#selected];
            const name = item ? `${item.name}   ` : '';
            return `${name}↵ / Esc paste   Del clear   ⌫ remove`;
        }
        const item = this.#items[this.#selected];
        return item ? `${item.name}   ${EMOJI_FOOTER_HINT}` : EMOJI_FOOTER_HINT;
    }

    /** Row height is fixed by the stylesheet; read it once from a real row (it follows text scaling). */
    #measureRows() {
        const h = Math.round(this.#rows[0].actor.get_preferred_height(-1)[1]);
        if (h > 0) this.#rowHeight = h;
    }

    /** Which pool row shows item `index` (emoji items sit EMOJI_COLS to a row). */
    #rowOf(index) {
        return this.#mode === 'emoji' ? Math.floor(index / EMOJI_COLS) : index;
    }

    /** Re-bind the pool to the rows around the scroll position. */
    #render(force = false) {
        const emoji = this.#mode === 'emoji';
        const n = this.#items.length;
        const lines = emoji ? Math.ceil(n / EMOJI_COLS) : n;
        const pool = this.#rows.length;
        const first = Math.max(0, Math.min(Math.floor(this.#vadj.value / this.#rowHeight) - 1, lines - pool));
        if (!force && first === this.#first) return;
        this.#first = first;

        const shown = Math.max(0, Math.min(pool, lines - first));
        for (let k = 0; k < pool; k++) {
            const row = this.#rows[k];
            if (k >= shown) {
                row.actor.hide();
                continue;
            }
            if (emoji) {
                row.bind(this.#items, (first + k) * EMOJI_COLS);
                row.setSelected(this.#selected);
            } else {
                row.bind(this.#items[first + k], first + k);
                row.setSelected(first + k === this.#selected);
            }
            row.actor.show();
        }
        this.#top.set_height(first * this.#rowHeight);
        this.#bottom.set_height((lines - first - shown) * this.#rowHeight);
    }

    #rowFor(index) {
        const k = this.#rowOf(index) - this.#first;
        return k >= 0 && k < this.#rows.length && index < this.#items.length ? this.#rows[k] : null;
    }

    #select(index, {scroll = true} = {}) {
        if (index === this.#selected || index < 0 || index >= this.#items.length) return;
        const prev = this.#selected;
        const emoji = this.#mode === 'emoji';
        this.#selected = index;
        if (emoji) {
            // the row that held `prev` must drop its highlight, the row of `index` gain it
            this.#rowFor(prev)?.setSelected(index);
            this.#rowFor(index)?.setSelected(index);
        } else {
            this.#rowFor(prev)?.setSelected(false);
            this.#rowFor(index)?.setSelected(true);
        }
        if (scroll) this.#ensureVisible(index);
        if (!emoji && this.#preview.visible) this.#updatePreview();
    }

    #ensureVisible(index) {
        const top = this.#rowOf(index) * this.#rowHeight;
        const page = this.#vadj.page_size || MAX_LIST_HEIGHT;
        if (top < this.#vadj.value) this.#vadj.value = top;
        else if (top + this.#rowHeight > this.#vadj.value + page) this.#vadj.value = top + this.#rowHeight - page;
    }

    // ---- emoji staging -------------------------------------------------

    #stageEmoji(glyph) {
        this.#staged.push(glyph);
        this.#lastAction = 'stage';
        this.#updateStage();
    }

    #clearStaged() {
        this.#staged = [];
        this.#lastAction = '';
        this.#updateStage();
    }

    #commitStaged() {
        const text = this.#staged.join('');
        this.#staged = [];
        this.#lastAction = '';
        this.close();
        if (text) this.#onEmoji(text);
    }

    #updateStage() {
        if (!this.#stage) return;
        const n = this.#staged.length;
        if (n === 0) {
            this.#stage.visible = false;
            if (this.#mode === 'emoji')
                this.#footer.text = this.#emojiFooter();
            return;
        }
        this.#stage.visible = true;
        this.#stageText.text = this.#staged.join(' ');
        this.#stageInsert.label = n > 1 ? `Paste (${n})` : 'Paste';
        if (this.#mode === 'emoji')
            this.#footer.text = this.#emojiFooter();
    }

    // ---- actions -------------------------------------------------------

    #activate(entry) {
        this.close();
        this.#onActivate(entry);
    }

    #activateEmoji(index) {
        const item = this.#items[index];
        if (!item) return;
        this.#stageEmoji(item.glyph);
        if (this.#entry.get_text())
            this.#entry.set_text('');
    }

    #onKey(event) {
        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const alt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const emoji = this.#mode === 'emoji';
        const col = emoji ? EMOJI_COLS : 1;
        const last = this.#items.length - 1;
        const page = Math.max(1, Math.floor((this.#vadj.page_size || MAX_LIST_HEIGHT) / this.#rowHeight) - 1);
        const selected = this.#items[this.#selected];

        if (!emoji && alt && sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9) {
            const entry = this.#items[sym - Clutter.KEY_1];
            if (entry) this.#activate(entry);
            return Clutter.EVENT_STOP;
        }
        if (!emoji && ctrl && sym >= Clutter.KEY_1 && sym <= Clutter.KEY_4) {
            this.#setKind(FILTERS[sym - Clutter.KEY_1][0]);
            return Clutter.EVENT_STOP;
        }
        if (emoji && ctrl && sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9) {
            this.#setGroup(sym - Clutter.KEY_1);
            return Clutter.EVENT_STOP;
        }

        switch (sym) {
        case Clutter.KEY_Escape:
            if (emoji && this.#staged.length > 0) {
                this.#commitStaged();
                return Clutter.EVENT_STOP;
            }
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_BackSpace:
            if (emoji && !this.#entry.get_text() && this.#staged.length > 0) {
                this.#staged.pop();
                this.#lastAction = this.#staged.length ? 'stage' : '';
                this.#updateStage();
                return Clutter.EVENT_STOP;
            }
            break;
        case Clutter.KEY_Down:
            if (emoji) this.#lastAction = 'nav';
            this.#select(Math.min(this.#selected + col, last));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            if (emoji) this.#lastAction = 'nav';
            this.#select(Math.max(this.#selected - col, 0));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
            if (!emoji) break;
            this.#lastAction = 'nav';
            this.#select(Math.min(this.#selected + 1, last));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Left:
            if (!emoji) break;
            this.#lastAction = 'nav';
            this.#select(Math.max(this.#selected - 1, 0));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            if (emoji) this.#lastAction = 'nav';
            this.#select(Math.min(this.#selected + page, last));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            if (emoji) this.#lastAction = 'nav';
            this.#select(Math.max(this.#selected - page, 0));
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            if (emoji) {
                if (ctrl) {
                    if (selected && this.#lastAction !== 'stage')
                        this.#staged.push(selected.glyph);
                    this.#commitStaged();
                    return Clutter.EVENT_STOP;
                }
                if (this.#staged.length > 0 && this.#lastAction === 'stage') {
                    this.#commitStaged();
                    return Clutter.EVENT_STOP;
                }
                if (!selected) {
                    if (this.#staged.length > 0) this.#commitStaged();
                    return Clutter.EVENT_STOP;
                }
                this.#activateEmoji(this.#selected);
                return Clutter.EVENT_STOP;
            }
            if (!selected) return Clutter.EVENT_STOP;
            this.#activate(selected);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Delete:
            if (emoji) {
                if (this.#staged.length > 0) {
                    this.#clearStaged();
                    return Clutter.EVENT_STOP;
                }
                break;
            }
            if (selected) this.#store.remove(selected.id); // store change → #refilter keeps the position
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            if (emoji) this.#nextGroup();
            else this.#togglePreview();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_p:
        case Clutter.KEY_P:
            if (emoji || !ctrl) return Clutter.EVENT_PROPAGATE;
            if (selected) this.#store.setPinned(selected.id, !selected.pinned);
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
