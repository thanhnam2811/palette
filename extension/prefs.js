import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PalettePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(560, 720);

        const page = new Adw.PreferencesPage({title: 'Palette', icon_name: 'edit-paste-symbolic'});
        window.add(page);

        const general = group(page, 'General');
        general.add(switchRow(s, 'show-indicator', 'Show panel icon'));
        general.add(switchRow(s, 'paste-on-select', 'Paste after choosing an entry',
            'Sends Ctrl+V (Ctrl+Shift+V in terminals) to the focused window'));
        general.add(comboRow(s, 'popup-position', 'Popup position', [['cursor', 'At the pointer'], ['center', 'Centred']]));
        general.add(listRow(s, 'toggle-shortcut', 'Shortcut', 'Accelerator, e.g. <Super><Shift>v', true));

        const history = group(page, 'History');
        history.add(spinRow(s, 'history-size', 'Entries to keep', 'Pinned entries are not counted'));
        history.add(spinRow(s, 'max-text-kb', 'Largest text (KB)'));
        history.add(spinRow(s, 'max-image-mb', 'Largest image (MB)', '0 stops recording images'));
        history.add(spinRow(s, 'max-total-mb', 'Total size of long texts and images (MB)'));

        const privacy = group(page, 'Privacy');
        privacy.add(switchRow(s, 'private-mode', 'Private mode', 'Stop recording the clipboard'));
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

/** String-list setting edited as comma-separated text. `accel` validates as an accelerator. */
function listRow(settings, key, title, subtitle, accel = false) {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    row.text = settings.get_strv(key).join(', ');
    row.tooltip_text = subtitle;
    row.connect('apply', () => {
        const items = row.text.split(',').map(t => t.trim()).filter(Boolean);
        if (accel && !(items.length === 1 && Gtk.accelerator_parse(items[0])[0])) {
            row.add_css_class('error');
            return;
        }
        row.remove_css_class('error');
        settings.set_strv(key, items);
    });
    return row;
}
