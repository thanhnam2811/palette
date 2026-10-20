import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * One grid line of the emoji picker: `cols` cells bound to `cols` consecutive
 * items. Like Row, instances live in a small pool and are re-bound while
 * scrolling, so binding only touches properties — never creates widgets.
 */
export class EmojiRow {
    /**
     * @param {number} cols
     * @param {object} ctx  {onActivate(itemIndex, shiftHeld), onHover(itemIndex)}
     */
    constructor(cols, ctx) {
        this.#ctx = ctx;
        this.#cells = [];
        this.actor = new St.BoxLayout({style_class: 'palette-emoji-row', x_expand: true});

        for (let i = 0; i < cols; i++) {
            const label = new St.Label({style_class: 'palette-emoji', y_align: Clutter.ActorAlign.CENTER});
            const cell = new St.Button({style_class: 'palette-emoji-cell', can_focus: false, x_expand: true, child: label});
            // Shift+click stages, plain click pastes: remember the modifier from the
            // press because St.Button emits 'clicked' on release, when the event state
            // is no longer available.
            let shift = false;
            cell.connect('button-press-event', (_a, event) => {
                shift = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
                return Clutter.EVENT_PROPAGATE;
            });
            cell.connect('clicked', () => {
                const index = this.#first + i;
                if (index < this.#count) this.#ctx.onActivate(index, shift);
            });
            cell.connect('enter-event', () => {
                const index = this.#first + i;
                if (index < this.#count) this.#ctx.onHover(index);
                return Clutter.EVENT_PROPAGATE;
            });
            this.actor.add_child(cell);
            this.#cells.push({cell, label});
        }
    }

    #ctx;
    #cells;
    #first = 0;
    #count = 0;
    #selected = -1;

    /** Show `items[first … first+cols-1]`. */
    bind(items, first) {
        this.#first = first;
        this.#count = items.length;
        for (let i = 0; i < this.#cells.length; i++) {
            const {cell, label} = this.#cells[i];
            const item = items[first + i];
            if (!item) {
                cell.hide();
                continue;
            }
            // St has no tooltip support: the name of the hovered cell is shown in
            // the picker's footer instead (see Popup#emojiFooter).
            label.text = item.glyph;
            cell.show();
        }
        this.setSelected(this.#selected);
    }

    /** Highlight the cell holding item index `selected`, if it is in this row. */
    setSelected(selected) {
        this.#selected = selected;
        for (let i = 0; i < this.#cells.length; i++) {
            const {cell} = this.#cells[i];
            if (this.#first + i === selected) cell.add_style_pseudo_class('selected');
            else cell.remove_style_pseudo_class('selected');
        }
    }

    destroy() {
        this.actor.destroy();
    }
}
