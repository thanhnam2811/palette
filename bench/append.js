// E3: how to append log lines. Run: gjs -m bench/append.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {now, table, f} from './lib.js';

Gio._promisify(Gio.File.prototype, 'append_to_async', 'append_to_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');

const ENC = new TextEncoder();
const PRIVATE = Gio.FileCreateFlags.PRIVATE;
const line = ENC.encode(JSON.stringify({o: 'u', id: 1, t: 1792125867598, pad: 'x'.repeat(120)}) + '\n');
const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'palette-bench']);
GLib.mkdir_with_parents(dir, 0o700);
const path = GLib.build_filenamev([dir, 'append.log']);
const file = () => Gio.File.new_for_path(path);
const reset = () => { try { file().delete(null); } catch (_e) { /* absent */ } };

// each strategy: issue(n) starts n ops without awaiting (this is the main-thread-blocking part); returns a promise that settles when all are on disk.
const strategies = {
    'kept stream, async write per op (current)': () => {
        let stream = null, tail = Promise.resolve();
        return {
            issue() {
                tail = tail.then(async () => {
                    stream ??= await file().append_to_async(PRIVATE, GLib.PRIORITY_DEFAULT, null);
                    await stream.write_bytes_async(new GLib.Bytes(line), GLib.PRIORITY_DEFAULT, null);
                });
            },
            done: async () => { await tail; await stream?.close_async(GLib.PRIORITY_DEFAULT, null); },
        };
    },
    'open/append/close per op': () => {
        let tail = Promise.resolve();
        return {
            issue() {
                tail = tail.then(async () => {
                    const s = await file().append_to_async(PRIVATE, GLib.PRIORITY_DEFAULT, null);
                    await s.write_bytes_async(new GLib.Bytes(line), GLib.PRIORITY_DEFAULT, null);
                    await s.close_async(GLib.PRIORITY_DEFAULT, null);
                });
            },
            done: () => tail,
        };
    },
    'kept stream, SYNC write_all (blocks main loop)': () => {
        const s = file().append_to(PRIVATE, null);
        return {
            issue() { s.write_all(line, null); },
            done: async () => s.close(null),
        };
    },
    'coalesced: one async write per main-loop tick': () => {
        let stream = null, buf = [], scheduled = false, tail = Promise.resolve();
        const flush = () => {
            scheduled = false;
            const data = new GLib.Bytes(ENC.encode(buf.join('')));
            buf = [];
            tail = tail.then(async () => {
                stream ??= await file().append_to_async(PRIVATE, GLib.PRIORITY_DEFAULT, null);
                await stream.write_bytes_async(data, GLib.PRIORITY_DEFAULT, null);
            });
        };
        return {
            issue() {
                buf.push(new TextDecoder().decode(line));
                if (!scheduled) { scheduled = true; GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { flush(); return GLib.SOURCE_REMOVE; }); }
            },
            done: async () => { await new Promise(r => GLib.idle_add(GLib.PRIORITY_LOW, () => { r(); return GLib.SOURCE_REMOVE; })); await tail; await stream?.close_async(GLib.PRIORITY_DEFAULT, null); },
        };
    },
};

const rows = [];
for (const N of [1, 50, 500]) {
    for (const [name, make] of Object.entries(strategies)) {
        const blocked = [], wall = [];
        for (let run = 0; run < 5; run++) {
            reset();
            const s = make();
            const t0 = now();
            for (let i = 0; i < N; i++) s.issue();
            const t1 = now();
            await s.done();
            blocked.push(t1 - t0);
            wall.push(now() - t0);
        }
        blocked.sort((a, b) => a - b); wall.sort((a, b) => a - b);
        rows.push([N, name, f(blocked[0] / N * 1000, 1), f(wall[0])]);
    }
}
reset();
table('E3 append (min of 5; blocked = time the main thread spends issuing the ops)', ['ops in burst', 'strategy', 'main-thread µs/op', 'total ms until on disk'], rows);
