import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** Panel icon with a small menu: open, private mode, clear, settings. */
export const Indicator = GObject.registerClass(
class PaletteIndicator extends PanelMenu.Button {
    /**
     * @param {string} uuid
     * @param {Prefs} prefs
     * @param {{open, clear, openPrefs}} actions
     */
    _init(uuid, prefs, actions) {
        super._init(0.5, 'Palette');
        this._uuid = uuid;
        this._prefs = prefs;

        this._icon = new St.Icon({icon_name: 'edit-paste-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);

        this.menu.addAction('Open history', actions.open);

        this._private = new PopupMenu.PopupSwitchMenuItem('Private mode', prefs.privateMode);
        this._private.connect('toggled', (_item, state) => {
            prefs.privateMode = state;
        });
        this.menu.addMenuItem(this._private);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Clear history', actions.clear);
        this.menu.addAction('Settings', actions.openPrefs);

        this.sync();
        Main.panel.addToStatusArea(uuid, this);
    }

    /** Reflect settings (private mode, visibility). */
    sync() {
        this._private.setToggleState(this._prefs.privateMode);
        this._icon.opacity = this._prefs.privateMode ? 110 : 255;
        this.visible = this._prefs.showIndicator;
    }
});
