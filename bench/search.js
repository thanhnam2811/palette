// E6: filtering N entries by a query. Run: gjs -m bench/search.js
import {ms, table, f} from './lib.js';
import {filterEntries} from '../extension/lib/core/search.js';

function makeEntries(n) {
    const words = ['git', 'commit', 'select', 'from', 'users', 'https', 'github', 'clipboard', 'gnome', 'shell', 'error', 'config', 'server', 'localhost', 'password'];
    const out = [];
    for (let i = 0; i < n; i++) {
        let p = '';
        for (let j = 0; j < 12; j++) p += words[(i * 7 + j * 13) % words.length] + (j % 3 ? ' ' : '/') + (i % 17) + ' ';
        out.push({id: i, kind: 'text', pinned: i % 50 === 0, preview: p.slice(0, 200)});
    }
    return out;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const variants = {
    'cached lowercase + includes (current)': (es, q) => filterEntries(es, q),
    'lowercase every time + includes': (es, q) => {
        const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
        return es.filter(e => { const lc = e.preview.toLowerCase(); return terms.every(t => lc.includes(t)); });
    },
    'one regex per term, case-insensitive': (es, q) => {
        const res = q.split(/\s+/).filter(Boolean).map(t => new RegExp(escapeRe(t), 'i'));
        return es.filter(e => res.every(r => r.test(e.preview)));
    },
    'subsequence fuzzy (cached lowercase)': (es, q) => {
        const t = q.toLowerCase().replace(/\s+/g, '');
        return es.filter(e => {
            const lc = e.lc ??= e.preview.toLowerCase();
            let i = 0;
            for (let k = 0; k < lc.length && i < t.length; k++) if (lc[k] === t[i]) i++;
            return i === t.length;
        });
    },
};

const rows = [];
for (const n of [1000, 10000]) {
    const entries = makeEntries(n);
    for (const q of ['git', 'sel users']) {
        const row = [n, `"${q}"`];
        let hits = '';
        for (const fn of Object.values(variants)) {
            row.push(f(ms(() => fn(entries, q), 15)));
            hits += fn(entries, q).length + '/';
        }
        row.push(hits);
        rows.push(row);
    }
}
table('E6 search (ms, best of N)', ['entries', 'query', ...Object.keys(variants), 'hits per variant'], rows);
