import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const XML = `
<node>
  <interface name="org.palette.Dev">
    <method name="Eval"><arg type="s" direction="in" name="code"/><arg type="s" direction="out" name="result"/></method>
    <method name="Result"><arg type="s" direction="out" name="result"/></method>
    <method name="Screenshot"><arg type="s" direction="in" name="path"/><arg type="b" direction="out" name="ok"/></method>
  </interface>
</node>`;

export default class DevTools extends Extension {
    #exported = null;
    #ownerId = 0;
    #last = 'none';

    enable() {
        const palette = () => Main.extensionManager.lookup('palette@namtt')?.stateObj;
        const impl = {
            Eval: code => {
                try {
                    const fn = new Function('Main', 'palette', 'imports', `return (${code});`);
                    const r = fn(Main, palette(), imports);
                    if (r instanceof Promise) {
                        this.#last = 'pending';
                        r.then(v => (this.#last = fmt(v)), e => (this.#last = `ERR ${e.message ?? e}\n${e.stack ?? ''}`));
                        return 'pending';
                    }
                    return (this.#last = fmt(r));
                } catch (e) {
                    return (this.#last = `ERR ${e.message ?? e}\n${e.stack ?? ''}`);
                }
            },
            Result: () => this.#last,
            Screenshot: path => {
                const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
                new Shell.Screenshot().screenshot(false, stream, (obj, res) => {
                    try { obj.screenshot_finish(res); } finally { stream.close(null); }
                });
                return true;
            },
        };
        this.#exported = Gio.DBusExportedObject.wrapJSObject(XML, impl);
        this.#ownerId = Gio.bus_own_name(Gio.BusType.SESSION, 'org.palette.Dev', Gio.BusNameOwnerFlags.NONE,
            conn => this.#exported.export(conn, '/org/palette/Dev'), null, null);
    }

    disable() {
        this.#exported?.unexport();
        if (this.#ownerId) Gio.bus_unown_name(this.#ownerId);
        this.#exported = null;
        this.#ownerId = 0;
    }
}

function fmt(v) {
    if (v === undefined) return 'undefined';
    return typeof v === 'string' ? v : JSON.stringify(v);
}
