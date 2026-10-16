// E1: content hashing. Run: gjs -m bench/hash.js
import GLib from 'gi://GLib';
import {ms, table, f} from './lib.js';

const SIZES = [1024, 100 * 1024, 1024 * 1024, 5 * 1024 * 1024];
const T = GLib.ChecksumType;

function fnv1a(data) { // 32-bit FNV-1a in JS
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
        h ^= data[i];
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

const rows = [];
for (const size of SIZES) {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = (i * 31 + (i >> 8)) & 255;
    const bytes = new GLib.Bytes(data);
    const runs = size >= 1024 * 1024 ? 5 : 15;
    rows.push([
        `${size / 1024} KB`,
        f(ms(() => GLib.compute_checksum_for_data(T.SHA256, data), runs)),
        f(ms(() => GLib.compute_checksum_for_data(T.SHA1, data), runs)),
        f(ms(() => GLib.compute_checksum_for_data(T.MD5, data), runs)),
        f(ms(() => GLib.compute_checksum_for_bytes(T.SHA256, bytes), runs)),
        f(ms(() => bytes.hash(), runs)),
        f(ms(() => fnv1a(data), runs)),
    ]);
}
table('E1 hash time (ms, best of N)', ['size', 'SHA-256 (data)', 'SHA-1 (data)', 'MD5 (data)', 'SHA-256 (Bytes)', 'Bytes.hash 32-bit', 'FNV-1a JS 32-bit'], rows);

// E1b: hash big payloads in slices, yielding to the main loop between them,
// so no single block exceeds a frame (16 ms). Wall time is what we pay for that.
import {now} from './lib.js';

const idle = () => new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { r(); return GLib.SOURCE_REMOVE; }));

async function sliced(data, type, slice) {
    const c = new GLib.Checksum(type);
    let maxBlock = 0;
    for (let i = 0; i < data.length; i += slice) {
        const t = now();
        c.update(data.subarray(i, Math.min(data.length, i + slice)));
        maxBlock = Math.max(maxBlock, now() - t);
        await idle();
    }
    return {hash: c.get_string(), maxBlock};
}

const rows2 = [];
for (const size of [1024 * 1024, 5 * 1024 * 1024, 8 * 1024 * 1024]) {
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = (i * 31 + (i >> 8)) & 255;
    const ref = GLib.compute_checksum_for_data(T.SHA256, data);
    for (const [name, run] of [
        ['SHA-256 one shot', async () => { const t = now(); const h = GLib.compute_checksum_for_data(T.SHA256, data); return {hash: h, maxBlock: now() - t}; }],
        ['SHA-256 in 256 KB slices', () => sliced(data, T.SHA256, 256 * 1024)],
        ['SHA-256 in 64 KB slices', () => sliced(data, T.SHA256, 64 * 1024)],
        ['SHA-1 one shot', async () => { const t = now(); const h = GLib.compute_checksum_for_data(T.SHA1, data); return {hash: h, maxBlock: now() - t}; }],
    ]) {
        let best = {wall: Infinity, block: Infinity};
        for (let i = 0; i < 5; i++) {
            const t = now();
            const r = await run();
            if (name.startsWith('SHA-256') && r.hash !== ref) throw new Error(`${name}: wrong hash`);
            best = {wall: Math.min(best.wall, now() - t), block: Math.min(best.block, r.maxBlock)};
        }
        rows2.push([`${size / 1048576} MB`, name, f(best.block), f(best.wall)]);
    }
}
table('E1b big-payload hashing (best of 5)', ['size', 'strategy', 'longest main-loop block (ms)', 'wall (ms)'], rows2);
