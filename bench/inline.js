// E7: how long may a text be and still live inside the log (vs. a blob file)? Run: gjs -m bench/inline.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Store} from '../extension/lib/core/store.js';
import {hashBytes} from '../extension/lib/core/hash.js';
import {now, table, f} from './lib.js';

const ENC = new TextEncoder();
let seed = 12345;
const rnd = () => { // mulberry32
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function sample() {
    const r = rnd();
    const len = r < 0.60 ? 10 + rnd() * 90 : r < 0.85 ? 100 + rnd() * 300 : r < 0.95 ? 400 + rnd() * 3600 : 4000 + rnd() * 46000;
    let s = '';
    while (s.length < len) s += Math.floor(rnd() * 1e9).toString(36) + ' ';
    return s.slice(0, Math.floor(len));
}

const texts = Array.from({length: 1000}, sample);
if (new Set(texts).size !== texts.length) throw new Error('dataset has duplicates');
const rows = [];

for (const inlineMax of [0, 256, 1024, 4096]) {
    const dir = GLib.dir_make_tmp('palette-bench-XXXXXX');
    let s = await Store.open(dir, {maxEntries: 5000, inlineMax});
    for (const t of texts) { const data = ENC.encode(t); s.add({hash: hashBytes(data), kind: 'text', mime: 'text/plain', data, text: t}); }
    await s.destroy();

    const logBytes = Gio.File.new_for_path(`${dir}/history.log`).query_info('standard::size', 0, null).get_size();
    let files = 0;
    const en = Gio.File.new_for_path(`${dir}/blobs`).enumerate_children('standard::name', 0, null);
    while (en.next_file(null)) files++;

    const opens = [];
    let inlineChars = 0, store;
    for (let i = 0; i < 7; i++) {
        const t = now();
        store = await Store.open(dir, {maxEntries: 5000, inlineMax});
        opens.push(now() - t);
        if (i < 6) await store.destroy();
    }
    opens.sort((a, b) => a - b);
    for (const e of store.list()) inlineChars += e.inline?.length ?? 0;

    const ids = store.list().map(e => e.id);
    let readAvg = Infinity;
    for (let pass = 0; pass < 5; pass++) {
        const t = now();
        for (let i = 0; i < 200; i++) await store.readContent(ids[(i * 37) % ids.length]);
        readAvg = Math.min(readAvg, (now() - t) / 200);
    }
    await store.destroy();
    rows.push([inlineMax, files, (logBytes / 1024).toFixed(0), (inlineChars / 1024).toFixed(0), f(opens[0]), f(readAvg)]);
    // cleanup
    const en2 = Gio.File.new_for_path(`${dir}/blobs`).enumerate_children('standard::name', 0, null);
    let i2; while ((i2 = en2.next_file(null))) GLib.unlink(`${dir}/blobs/${i2.get_name()}`);
    GLib.unlink(`${dir}/history.log`); GLib.rmdir(`${dir}/blobs`); GLib.rmdir(dir);
}
table('E7 inline threshold (1000 entries, realistic length mix)', ['inline ≤ chars', 'blob files', 'log KB', 'inline text KB held in RAM', 'open() ms', 'readContent avg ms'], rows);
