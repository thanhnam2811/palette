import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
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
        this._dialog = null;

        this._icon = new St.Icon({icon_name: 'edit-paste-symbolic', style_class: 'system-status-icon'});
        this.add_child(this._icon);

        this.menu.addAction('Open history', actions.open);

        this._private = new PopupMenu.PopupSwitchMenuItem('Private mode', prefs.privateMode);
        this._private.connect('toggled', (_item, state) => {
            prefs.privateMode = state;
        });
        this.menu.addMenuItem(this._private);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Clear history', () => this._confirmClear(actions.clear));
        this.menu.addAction('Settings', actions.openPrefs);

        this.sync();
        Main.panel.addToStatusArea(uuid, this);
    }

    _confirmClear(onConfirmed) {
        if (this._dialog) {
            this._dialog.open();
            return;
        }

        const dialog = new ModalDialog.ModalDialog();
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: 'Clear Clipboard History?',
            description: 'Are you sure you want to clear your clipboard history? Pinned items will be kept.',
        }));

        dialog.addButton({
            label: 'Cancel',
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
        });

        const clearBtn = dialog.addButton({
            label: 'Clear History',
            action: () => {
                dialog.close();
                onConfirmed();
            },
            default: true,
        });
        clearBtn.add_style_class_name('destructive-action');

        dialog.connect('closed', () => {
            if (this._dialog === dialog) this._dialog = null;
        });

        this._dialog = dialog;
        dialog.open();
    }

    /** Reflect settings (private mode, visibility). */
    sync() {
        this._private.setToggleState(this._prefs.privateMode);
        this._icon.opacity = this._prefs.privateMode ? 110 : 255;
        this.visible = this._prefs.showIndicator;
    }

    destroy() {
        if (this._dialog) {
            this._dialog.close();
            this._dialog = null;
        }
        super.destroy();
    }
});
