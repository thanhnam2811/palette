// E5: building the one-line preview. Run: gjs -m bench/text.js
import {ms, table, f} from './lib.js';

const MAX = 200;

const variants = {
    'regex over whole text': s => s.replace(/\s+/g, ' ').trim().slice(0, MAX),
    'cut to 4*MAX, then regex (current)': s => {
        const head = s.length > MAX * 4 ? s.slice(0, MAX * 4) : s;
        const p = head.replace(/\s+/g, ' ').trim();
        return p.length > MAX ? p.slice(0, MAX) : p;
    },
    'manual char loop until MAX': s => {
        let out = '', prevSpace = true;
        for (let i = 0; i < s.length && out.length < MAX; i++) {
            const c = s.charCodeAt(i);
            const space = c === 32 || (c >= 9 && c <= 13) || c === 160;
            if (space) { if (!prevSpace) out += ' '; prevSpace = true; } else { out += s[i]; prevSpace = false; }
        }
        return out.trimEnd();
    },
    'cut to 2*MAX, then regex': s => {
        const head = s.length > MAX * 2 ? s.slice(0, MAX * 2) : s;
        const p = head.replace(/\s+/g, ' ').trim();
        return p.length > MAX ? p.slice(0, MAX) : p;
    },
};

const rows = [];
const make = (len, ws) => { let s = ''; while (s.length < len) s += 'word' + ' '.repeat(ws) + '\n'; return s.slice(0, len); };
for (const [label, text] of [['1 KB', make(1024, 1)], ['100 KB', make(100 * 1024, 1)], ['1 MB', make(1024 * 1024, 1)], ['1 MB, heavy whitespace (indented code)', make(1024 * 1024, 40)]]) {
    const row = [label];
    for (const fn of Object.values(variants)) row.push(f(ms(() => fn(text), 15) * 1000, 1));
    rows.push(row);
}
// sanity: variants agree on typical input
const probe = make(5000, 3);
const outs = Object.values(variants).map(fn => fn(probe));
if (new Set(outs).size !== 1) print(`WARNING: variants disagree\n${outs.join('\n')}`);
table('E5 preview (µs, best of N)', ['input', ...Object.keys(variants)], rows);
