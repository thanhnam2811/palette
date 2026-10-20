// Real Wayland clipboard owner and paste target, used only by smoke.py.
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
const [kind, payload, output] = ARGV;
const app = new Gtk.Application({application_id: 'org.palette.SmokeClient'});
app.connect('activate', () => {
    const view = new Gtk.TextView();
    const win = new Gtk.ApplicationWindow({application: app, title: 'Palette test client',
        default_width: 420, default_height: 180, child: view});
    view.buffer.connect('changed', () => {
        GLib.file_set_contents(output, view.buffer.text);
    });
    win.present();
    view.grab_focus();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        if (!win.is_active) return GLib.SOURCE_CONTINUE;
        const providers = [];
        if (kind === 'image') {
            const [, bytes] = GLib.file_get_contents(payload);
            providers.push(Gdk.ContentProvider.new_for_bytes('image/png', new GLib.Bytes(bytes)));
        } else {
            providers.push(Gdk.ContentProvider.new_for_bytes('text/plain;charset=utf-8',
                new GLib.Bytes(new TextEncoder().encode(payload))));
            if (kind === 'secret') providers.push(Gdk.ContentProvider.new_for_bytes(
                'x-kde-passwordManagerHint', new GLib.Bytes(new TextEncoder().encode('secret'))));
        }
        win.get_clipboard().set_content(Gdk.ContentProvider.new_union(providers));
        print(`offered ${kind}`);
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
