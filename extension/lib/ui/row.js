import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

const THUMB_SIZE = 18;

/**
 * One history line. Rows live in a small pool and are re-bound to different
 * entries while scrolling (see Popup), so everything here must be cheap to
 * rebind: only property changes, no widget creation. The pin/delete buttons are
 * created the first time the row is selected.
 */
export class Row {
    /**
     * @param {object} ctx  {iconFile(entry), onActivate(row), onTogglePin(row), onDelete(row), onHover(row)}
     */
    constructor(ctx) {
        this.entry = null;
        this.index = -1;
        this.#ctx = ctx;

        this.actor = new St.Button({style_class: 'palette-row', x_expand: true, can_focus: false});
        this.#box = new St.BoxLayout({style_class: 'palette-row-box', x_expand: true});
        this.actor.set_child(this.#box);

        this.#indexLabel = new St.Label({style_class: 'palette-row-index', y_align: Clutter.ActorAlign.CENTER});
        this.#thumb = new St.Icon({icon_size: THUMB_SIZE, style_class: 'palette-thumb', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this.#label = new St.Label({style_class: 'palette-row-label', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.#label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.#pinMark = new St.Icon({icon_name: 'view-pin-symbolic', style_class: 'palette-pin-mark', y_align: Clutter.ActorAlign.CENTER, visible: false});
        for (const a of [this.#indexLabel, this.#thumb, this.#label, this.#pinMark]) this.#box.add_child(a);

        this.actor.connect('clicked', () => ctx.onActivate(this));
        this.actor.connect('enter-event', () => {
            if (this.entry) ctx.onHover(this);
            return Clutter.EVENT_PROPAGATE;
        });
    }

    #ctx;
    #box;
    #indexLabel;
    #thumb;
    #label;
    #pinMark;
    #actions = null;
    #pinButton = null;
    #imageEntry = null; // entry whose thumbnail is currently set

    /** Show `entry` as item number `index`. */
    bind(entry, index) {
        this.entry = entry;
        this.index = index;
        this.#indexLabel.text = index < 9 ? String(index + 1) : '';

        const isImage = entry.kind === 'image';
        this.#label.text = isImage ? `Image · ${GLib.format_size(entry.size)}` : entry.preview;
        this.#thumb.visible = isImage;
        if (isImage && this.#imageEntry !== entry) {
            this.#thumb.gicon = new Gio.FileIcon({file: this.#ctx.iconFile(entry)});
            this.#imageEntry = entry;
        }
        this.#pinMark.visible = entry.pinned;
        this.#pinButton?.set_style_class_name(this.#pinClass());
    }

    setSelected(selected) {
        if (selected) this.actor.add_style_pseudo_class('selected');
        else this.actor.remove_style_pseudo_class('selected');

        if (selected && !this.#actions) this.#buildActions();
        if (this.#actions) this.#actions.visible = selected;
        this.#pinMark.visible = !!this.entry?.pinned && !selected;
    }

    destroy() {
        this.actor.destroy();
    }

    #pinClass() {
        return this.entry?.pinned ? 'palette-action palette-action-active' : 'palette-action';
    }

    #buildActions() {
        this.#actions = new St.BoxLayout({style_class: 'palette-actions', y_align: Clutter.ActorAlign.CENTER});
        this.#pinButton = this.#actionButton('view-pin-symbolic', this.#pinClass(), () => this.#ctx.onTogglePin(this));
        this.#actions.add_child(this.#pinButton);
        this.#actions.add_child(this.#actionButton('edit-delete-symbolic', 'palette-action', () => this.#ctx.onDelete(this)));
        this.#box.add_child(this.#actions);
    }

    #actionButton(iconName, styleClass, onClick) {
        const b = new St.Button({style_class: styleClass, can_focus: false, child: new St.Icon({icon_name: iconName})});
        b.connect('clicked', () => {
            onClick();
            return Clutter.EVENT_STOP;
        });
        return b;
    }
}
