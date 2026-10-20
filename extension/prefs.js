import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PalettePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(560, 720);

        const page = new Adw.PreferencesPage({title: 'Palette', icon_name: 'edit-paste-symbolic'});
        window.add(page);

        const shortcuts = group(page, 'Shortcuts');
        shortcuts.add(accelRow(window, s, 'toggle-shortcut', 'Clipboard history'));
        shortcuts.add(accelRow(window, s, 'emoji-shortcut', 'Emoji picker'));

        const general = group(page, 'General');
        general.add(switchRow(s, 'show-indicator', 'Show panel icon'));
        general.add(switchRow(s, 'paste-on-select', 'Paste after choosing an entry',
            'Sends Ctrl+V (Ctrl+Shift+V in terminals) to the focused window'));
        general.add(comboRow(s, 'popup-position', 'Popup position',
            [['caret', 'At the text cursor'], ['cursor', 'At the pointer'], ['center', 'Centred']]));
        general.add(comboRow(s, 'density', 'Density',
            [['compact', 'Compact'], ['comfortable', 'Comfortable']]));

        const history = group(page, 'History');
        history.add(spinRow(s, 'history-size', 'Entries to keep', 'Pinned entries are not counted'));
        history.add(spinRow(s, 'max-text-kb', 'Largest text (KB)'));
        history.add(spinRow(s, 'max-image-mb', 'Largest image (MB)', '0 stops recording images'));
        history.add(spinRow(s, 'max-total-mb', 'Total size of long texts and images (MB)'));

        const privacy = group(page, 'Privacy');
        privacy.add(switchRow(s, 'private-mode', 'Private mode', 'Stop recording the clipboard'));
        privacy.add(switchRow(s, 'capture-on-start', 'Record clipboard on startup',
            'Off: only content copied after the extension starts is recorded'));
        privacy.add(listRow(s, 'excluded-apps', 'Ignored apps', 'Window classes, comma separated'));
        privacy.add(listRow(s, 'terminal-apps', 'Terminal apps', 'Window classes that paste with Ctrl+Shift+V'));
    }
}

function group(page, title) {
    const g = new Adw.PreferencesGroup({title});
    page.add(g);
    return g;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle = '') {
    const range = settings.settings_schema.get_key(key).get_range().recursiveUnpack()[1];
    const row = new Adw.SpinRow({
        title, subtitle,
        adjustment: new Gtk.Adjustment({lower: range[0], upper: range[1], step_increment: 1, page_increment: 10}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function comboRow(settings, key, title, choices) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices.map(c => c[1]))});
    row.selected = Math.max(0, choices.findIndex(c => c[0] === settings.get_string(key)));
    row.connect('notify::selected', () => settings.set_string(key, choices[row.selected][0]));
    return row;
}

/** String-list setting edited as comma-separated text. */
function listRow(settings, key, title, subtitle) {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    row.text = settings.get_strv(key).join(', ');
    row.tooltip_text = subtitle;
    row.connect('apply', () => settings.set_strv(key, row.text.split(',').map(t => t.trim()).filter(Boolean)));
    return row;
}

const MODIFIER_KEYS = new Set([
    Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_Caps_Lock, Gdk.KEY_Num_Lock, Gdk.KEY_Shift_Lock,
    Gdk.KEY_ISO_Level3_Shift, Gdk.KEY_ISO_Level5_Shift, Gdk.KEY_Mode_switch,
]);
const REQUIRED = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK;

/**
 * Shortcut row: click it, press the combination you want, done. The keys are
 * captured with a key controller, so nothing is typed in accelerator syntax.
 * Backspace clears the shortcut (the binding is then inactive), Escape cancels.
 */
function accelRow(window, settings, key, title) {
    const row = new Adw.ActionRow({title, subtitle: 'Click, then press the keys'});
    const button = new Gtk.Button({valign: Gtk.Align.CENTER});
    row.add_suffix(button);
    row.activatable_widget = button;

    let capturing = false;
    const show = () => {
        button.remove_css_class('error');
        if (capturing) {
            button.set_label('Press the keys…');
            return;
        }
        const [ok, keyval, mask] = Gtk.accelerator_parse(settings.get_strv(key)[0] ?? '');
        button.set_label(ok ? Gtk.accelerator_get_label(keyval, mask) : 'Disabled');
    };
    show();

    button.connect('clicked', () => {
        capturing = !capturing;
        show();
        if (capturing) button.grab_focus();
    });
    settings.connect('changed', (_s, k) => {
        if (k === key && !capturing) show();
    });

    const controller = new Gtk.EventControllerKey();
    // Capture phase: the shortcut must be taken before the window reacts to it
    // (Escape closes the dialog, space toggles the focused row, and so on).
    controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    controller.connect('key-pressed', (_c, keyval, _code, state) => {
        if (!capturing) return Gdk.EVENT_PROPAGATE;
        if (MODIFIER_KEYS.has(keyval)) return Gdk.EVENT_STOP; // a modifier alone is not a shortcut
        if (keyval === Gdk.KEY_Escape) {
            capturing = false;
            show();
            return Gdk.EVENT_STOP;
        }
        if (keyval === Gdk.KEY_BackSpace) {
            settings.set_strv(key, []);
            capturing = false;
            show();
            return Gdk.EVENT_STOP;
        }

        const mask = state & Gtk.accelerator_get_default_mod_mask();
        const isFunction = keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F35;
        if ((mask & REQUIRED) === 0 && !isFunction) {
            // a bare key would be grabbed globally and break normal typing
            button.add_css_class('error');
            button.set_label('Use Ctrl, Alt or Super');
            return Gdk.EVENT_STOP;
        }
        settings.set_strv(key, [Gtk.accelerator_name(keyval, mask)]);
        capturing = false;
        show();
        return Gdk.EVENT_STOP;
    });
    window.add_controller(controller);
    return row;
}
