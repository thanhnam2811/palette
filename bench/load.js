// E4: reading the log at startup. Run: gjs -m bench/load.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {now, table, f} from './lib.js';
import {decodeOp} from '../extension/lib/core/codec.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
const DEC = new TextDecoder();
const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'palette-bench']);
GLib.mkdir_with_parents(dir, 0o700);
const path = GLib.build_filenamev([dir, 'load.log']);
const file = Gio.File.new_for_path(path);

function write(n) {
    const lines = [];
    for (let i = 0; i < n; i++) {
        const text = `entry ${i} ` + 'lorem ipsum dolor sit amet '.repeat(1 + (i % 4));
        lines.push(JSON.stringify({o: 'a', id: i + 1, h: 'a'.repeat(64), k: 'text', m: 'text/plain;charset=utf-8', n: text.length, t: 1.79e12 + i, p: text, x: text}));
    }
    GLib.file_set_contents(path, lines.join('\n') + '\n');
}

const idle = () => new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { r(); return GLib.SOURCE_REMOVE; }));

const strategies = {
    'load_contents_async + split + parse (current)': async () => {
        let maxBlock = 0, t = now();
        const [c] = await file.load_contents_async(null);
        t = now();
        const ops = DEC.decode(c).split('\n').filter(Boolean).map(decodeOp);
        maxBlock = now() - t;
        return {n: ops.length, maxBlock};
    },
    'sync DataInputStream.read_line (blocks on I/O too)': async () => {
        const t = now();
        const s = new Gio.DataInputStream({base_stream: file.read(null)});
        let n = 0, line;
        while ((line = s.read_line_utf8(null)[0]) !== null) { decodeOp(line); n++; }
        s.close(null);
        return {n, maxBlock: now() - t};
    },
    'load_contents_async + parse in 500-line slices (yield between)': async () => {
        const [c] = await file.load_contents_async(null);
        const lines = DEC.decode(c).split('\n').filter(Boolean);
        let maxBlock = 0, n = 0;
        for (let i = 0; i < lines.length; i += 500) {
            const t = now();
            for (const l of lines.slice(i, i + 500)) { decodeOp(l); n++; }
            maxBlock = Math.max(maxBlock, now() - t);
            await idle();
        }
        return {n, maxBlock};
    },
};

const rows = [];
for (const N of [300, 3000, 30000]) {
    write(N);
    for (const [name, run] of Object.entries(strategies)) {
        const blocks = [], walls = [];
        for (let i = 0; i < 5; i++) {
            const t = now();
            const {maxBlock} = await run();
            walls.push(now() - t); blocks.push(maxBlock);
        }
        blocks.sort((a, b) => a - b); walls.sort((a, b) => a - b);
        rows.push([N, name, f(blocks[0]), f(walls[0])]);
    }
}
file.delete(null);
table('E4 load (min of 5)', ['log lines', 'strategy', 'longest main-loop block (ms)', 'wall (ms)'], rows);
