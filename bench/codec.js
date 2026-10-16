// E2: log line format. JSONL vs tab-separated vs binary. Run: gjs -m bench/codec.js
import GLib from 'gi://GLib';
import {ms, table, f} from './lib.js';

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const HASH = 'a'.repeat(40);

function makeOps(n) {
    const ops = [];
    for (let i = 0; i < n; i++) {
        const text = `entry ${i} ` + 'lorem ipsum dolor sit amet '.repeat(1 + (i % 4));
        ops.push({o: 'a', id: i, h: HASH, k: 'text', m: 'text/plain;charset=utf-8', n: text.length, t: 1.79e12 + i, p: text, x: text});
        if (i % 3 === 0) ops.push({o: 'u', id: i, t: 1.79e12 + i + 1});
    }
    return ops;
}

// --- JSONL
const json = {
    encode: ops => ops.map(o => JSON.stringify(o) + '\n').join(''),
    decode: text => text.split('\n').filter(Boolean).map(l => JSON.parse(l)),
    toBytes: s => ENC.encode(s),
    fromBytes: b => DEC.decode(b),
};

// --- TSV: o \t id \t t \t h \t k \t m \t n \t flags \t p \t x   (strings escaped for \t \n \\)
const esc = s => s.replace(/[\\\t\n]/g, c => (c === '\\' ? '\\\\' : c === '\t' ? '\\t' : '\\n'));
const unesc = s => s.replace(/\\(.)/g, (_m, c) => (c === 't' ? '\t' : c === 'n' ? '\n' : c));
const tsv = {
    encode: ops => ops.map(o => [o.o, o.id, o.t ?? '', o.h ?? '', o.k ?? '', o.m ?? '', o.n ?? '', o.f ?? '', esc(o.p ?? ''), esc(o.x ?? '')].join('\t') + '\n').join(''),
    decode: text => text.split('\n').filter(Boolean).map(l => {
        const c = l.split('\t');
        return {o: c[0], id: +c[1], t: c[2] === '' ? undefined : +c[2], h: c[3], k: c[4], m: c[5], n: +c[6], p: unesc(c[8]), x: c[9] === '' ? undefined : unesc(c[9])};
    }),
    toBytes: s => ENC.encode(s),
    fromBytes: b => DEC.decode(b),
};

// --- binary: [u8 op][u32 id][f64 t] + for 'a': [u8 kind][u16 mimeLen mime][u32 n][hash 20 raw? kept as 40-byte ascii][u16 pLen p][u32 xLen x]
const bin = {
    encode: ops => {
        const parts = [];
        let total = 0;
        for (const o of ops) {
            const p = ENC.encode(o.p ?? ''), x = ENC.encode(o.x ?? ''), m = ENC.encode(o.m ?? '');
            const size = 1 + 4 + 8 + (o.o === 'a' ? 1 + 2 + m.length + 4 + 40 + 2 + p.length + 4 + x.length : 0);
            const buf = new Uint8Array(size), dv = new DataView(buf.buffer);
            let i = 0;
            buf[i++] = o.o.charCodeAt(0);
            dv.setUint32(i, o.id); i += 4;
            dv.setFloat64(i, o.t ?? 0); i += 8;
            if (o.o === 'a') {
                buf[i++] = o.k === 'text' ? 1 : 2;
                dv.setUint16(i, m.length); i += 2; buf.set(m, i); i += m.length;
                dv.setUint32(i, o.n); i += 4;
                buf.set(ENC.encode(o.h), i); i += 40;
                dv.setUint16(i, p.length); i += 2; buf.set(p, i); i += p.length;
                dv.setUint32(i, x.length); i += 4; buf.set(x, i);
            }
            parts.push(buf);
            total += size;
        }
        const out = new Uint8Array(total);
        let off = 0;
        for (const b of parts) { out.set(b, off); off += b.length; }
        return out;
    },
    decode: buf => {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const ops = [];
        let i = 0;
        while (i < buf.length) {
            const o = {o: String.fromCharCode(buf[i++])};
            o.id = dv.getUint32(i); i += 4;
            o.t = dv.getFloat64(i); i += 8;
            if (o.o === 'a') {
                o.k = buf[i++] === 1 ? 'text' : 'image';
                const ml = dv.getUint16(i); i += 2; o.m = DEC.decode(buf.subarray(i, i + ml)); i += ml;
                o.n = dv.getUint32(i); i += 4;
                o.h = DEC.decode(buf.subarray(i, i + 40)); i += 40;
                const pl = dv.getUint16(i); i += 2; o.p = DEC.decode(buf.subarray(i, i + pl)); i += pl;
                const xl = dv.getUint32(i); i += 4; o.x = xl ? DEC.decode(buf.subarray(i, i + xl)) : undefined; i += xl;
            }
            ops.push(o);
        }
        return ops;
    },
    toBytes: b => b,
    fromBytes: b => b,
};

const rows = [];
for (const n of [300, 3000]) {
    const ops = makeOps(n);
    for (const [name, c] of [['JSONL', json], ['TSV', tsv], ['binary', bin]]) {
        const blob = c.toBytes(c.encode(ops));
        const enc = ms(() => c.encode(ops), 7);
        const dec = ms(() => c.decode(c.fromBytes(blob)), 7);
        const one = ms(() => { for (let i = 0; i < 1000; i++) c.encode([ops[i % ops.length]]); }, 7) / 1000 * 1000; // µs/op
        rows.push([ops.length, name, blob.length, f(enc), f(dec), f(one, 2)]);
    }
}
table('E2 codec', ['ops', 'format', 'bytes', 'encode all (ms)', 'decode all (ms)', 'encode 1 op (µs)'], rows);
GLib;
