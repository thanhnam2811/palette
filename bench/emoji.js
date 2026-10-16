// E11: how to get the emoji data into memory. E12: how to search it.
// Run: gjs -m bench/emoji.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ms, msAsync, table, f} from './lib.js';

const DEC = new TextDecoder();
const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const FILE = `${root}/extension/data/emoji.json`;
const text = DEC.decode(GLib.file_get_contents(FILE)[1]);
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

/** The item shape the UI binds: glyph plus the lowercased name it searches. */
function materialise(json) {
    const d = JSON.parse(json);
    return {groups: d.groups, items: d.emoji.map(([glyph, name, group]) => ({glyph, name, lc: name.toLowerCase(), group}))};
}

// A module is imported once per process, so time a subprocess that imports the
// data as a module against an empty one: the difference is the import cost that
// would be paid on every login if extension.js imported it at startup.
const dir = GLib.dir_make_tmp('palette-emoji-XXXXXX');
GLib.file_set_contents(`${dir}/empty.js`, 'print(1);\n');
GLib.file_set_contents(`${dir}/data.js`, `export default ${text};\n`);
GLib.file_set_contents(`${dir}/module.js`, `import d from './data.js';\nprint(d.emoji.length);\n`);
const subprocess = path => {
    const t = GLib.get_monotonic_time();
    const [ok, , err, status] = GLib.spawn_sync(null, ['gjs', '-m', path], null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (!ok || status !== 0) throw new Error(`probe ${path}: ${DEC.decode(err ?? new Uint8Array())}`);
    return (GLib.get_monotonic_time() - t) / 1000;
};
const baseMs = ms(() => subprocess(`${dir}/empty.js`), 7);
const moduleMs = ms(() => subprocess(`${dir}/module.js`), 7);
const moduleKib = GLib.file_get_contents(`${dir}/data.js`)[1].length / 1024;

table(`E11 emoji data load (ms, best of N) — ${(text.length / 1024).toFixed(1)} KiB JSON, 1898 emoji`,
    ['variant', 'ms', 'note'], [
        ['JSON.parse only', f(ms(() => JSON.parse(text), 15)), 'raw tuples, no UI objects'],
        ['sync read + parse + UI objects', f(ms(() => materialise(DEC.decode(GLib.file_get_contents(FILE)[1])), 15)), 'measured on the main loop'],
        ['async read + parse + UI objects', f(await msAsync(async () => materialise(DEC.decode((await Gio.File.new_for_path(FILE).load_contents_async(null))[0])), 9)), 'still parses on the main loop'],
        ['ES module import at login', f(baseMs) + ' → ' + f(moduleMs) + ` (+${f(moduleMs - baseMs)})`, `subprocess baseline ${f(baseMs)}; ${moduleKib.toFixed(1)} KiB module, paid on every login`],
    ]);

const {items} = materialise(text);
const rows = JSON.parse(text).emoji;
const terms = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const variants = {
    'tuples, lowercase per search': (list, q) => {
        const ts = terms(q);
        return list.filter(r => { const lc = r[1].toLowerCase(); return ts.every(t => lc.includes(t)); });
    },
    'tuples, cached lowercase': (list, q) => {
        const ts = terms(q);
        return list.filter(r => ts.every(t => (r[3] ??= r[1].toLowerCase()).includes(t)));
    },
    'objects with lowercase, one includes': (list, q) => {
        const lc = q.toLowerCase().trim();
        return lc ? list.filter(e => e.lc.includes(lc)) : list.slice();
    },
    'objects with lowercase, AND terms': (list, q) => {
        const ts = terms(q);
        return list.filter(e => ts.every(t => e.lc.includes(t)));
    },
};

const searchRows = [];
for (const q of ['', 'face', 'grinning face', 'flag: japan']) {
    const row = [`"${q}"`];
    let hits = '';
    for (const [name, fn] of Object.entries(variants)) {
        const list = name.startsWith('objects') ? items : rows;
        row.push(f(ms(() => fn(list, q), 15)));
        hits += fn(list, q).length + '/';
    }
    row.push(hits);
    searchRows.push(row);
}
table('E12 emoji search (ms, best of N)', ['query', ...Object.keys(variants), 'hits per variant'], searchRows);
