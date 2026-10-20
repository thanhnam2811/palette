import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const XML = `
<node>
  <interface name="org.palette.Dev">
    <method name="Eval"><arg type="s" direction="in" name="code"/><arg type="s" direction="out" name="result"/></method>
    <method name="Result"><arg type="s" direction="out" name="result"/></method>
    <method name="RecordStart"><arg type="s" direction="in" name="directory"/><arg type="u" direction="in" name="fps"/><arg type="b" direction="out" name="ok"/></method>
    <method name="RecordStop"><arg type="b" direction="out" name="ok"/></method>
    <method name="Screenshot"><arg type="s" direction="in" name="path"/><arg type="b" direction="out" name="ok"/></method>
  </interface>
</node>`;

export default class DevTools extends Extension {
    #exported = null;
    #ownerId = 0;
    #last = 'none';
    #recording = null;
    #recordSource = 0;

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
            RecordStart: (directory, fps) => this.#startRecording(directory, fps),
            RecordStop: () => this.#stopRecording(),
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

    #captureFocus() {
        if (Main.extensionManager.lookup('palette@namtt')?.stateObj?.popup?.isOpen) {
            const find = actor => {
                if ((actor.get_style_class_name?.() ?? '').split(' ').includes('palette-popup')) return actor;
                for (const child of actor.get_children?.() ?? []) {
                    const found = find(child);
                    if (found) return found;
                }
                return null;
            };
            const actor = find(Main.layoutManager.uiGroup);
            if (actor) return {kind: 'palette', box: [...actor.get_transformed_position(), ...actor.get_transformed_size()]};
        }
        const window = global.get_window_actors().find(actor => actor.meta_window.get_title() === 'Launch notes')?.meta_window;
        if (window) {
            const rect = window.get_frame_rect();
            return {kind: 'editor', box: [rect.x, rect.y, rect.width, rect.height]};
        }
        return null;
    }

    #startRecording(directory, fps) {
        const session = GLib.getenv('PALETTE_TEST_SESSION');
        if (!session || !directory.startsWith(`${session}/artifacts/`) || directory.includes('/../'))
            throw new Error('Recording requires an explicit isolated session artifact directory');
        if (this.#recording || fps < 1 || fps > 30) return false;
        GLib.mkdir_with_parents(directory, 0o700);
        const recording = {directory, startUs: GLib.get_monotonic_time(), frames: [], busy: false, stopped: false};
        this.#recording = recording;
        const save = () => {
            GLib.file_set_contents(`${directory}/recording.json`, JSON.stringify({
                startUs: recording.startUs, frames: recording.frames, error: recording.error ?? null,
            }));
            this.#recording = null;
        };
        this.#recordSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / fps), () => {
            if (recording.busy) return GLib.SOURCE_CONTINUE;
            recording.busy = true;
            const frame = {focus: this.#captureFocus(), file: `${String(recording.frames.length).padStart(6, '0')}.png`,
                time: (GLib.get_monotonic_time() - recording.startUs) / 1e6};
            const stream = Gio.File.new_for_path(`${directory}/${frame.file}`)
                .replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
            new Shell.Screenshot().screenshot(false, stream, (obj, result) => {
                try {
                    obj.screenshot_finish(result);
                    recording.frames.push(frame);
                } catch (error) {
                    recording.error = error.message;
                } finally {
                    stream.close(null);
                    recording.busy = false;
                    if (recording.stopped) save();
                }
            });
            return GLib.SOURCE_CONTINUE;
        });
        recording.save = save;
        return true;
    }

    #stopRecording() {
        if (this.#recordSource) GLib.source_remove(this.#recordSource);
        this.#recordSource = 0;
        if (!this.#recording) return false;
        this.#recording.stopped = true;
        if (!this.#recording.busy) this.#recording.save();
        return true;
    }

    disable() {
        this.#stopRecording();
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
