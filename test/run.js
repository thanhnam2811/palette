import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Store} from '../extension/lib/core/store.js';
import {makePreview, PREVIEW_MAX, INLINE_MAX} from '../extension/lib/core/text.js';
import {encodeOp, decodeOp} from '../extension/lib/core/codec.js';
import {filterEntries} from '../extension/lib/core/search.js';
import {hashBytes, hashData} from '../extension/lib/core/hash.js';
import {EmojiData} from '../extension/lib/core/emoji.js';
import {test, assert, eq, tmpDir, rmrf, addText, addImage, withStore, runAll} from './harness.js';

const DEC = new TextDecoder();
const LONG = 'x'.repeat(INLINE_MAX + 50);

function readLog(dir) {
    const [, c] = GLib.file_get_contents(`${dir}/history.log`);
    return DEC.decode(c);
}

function blobCount(dir) {
    const en = Gio.File.new_for_path(`${dir}/blobs`).enumerate_children('standard::name', 0, null);
    let n = 0;
    while (en.next_file(null)) n++;
    return n;
}

// ---- text / codec / search ---------------------------------------------

test('makePreview collapses whitespace and truncates', () => {
    eq(makePreview('  a \n\n b\t c  '), 'a b c');
    eq(makePreview('y'.repeat(10 * PREVIEW_MAX)).length, PREVIEW_MAX);
    eq(makePreview('   '), '');
    eq(makePreview('\u00a0\u2003x\u3000\u3000y'), 'x y');
    // a surrogate pair straddling the limit is dropped whole
    const edge = 'a'.repeat(PREVIEW_MAX - 1) + '😀';
    eq(makePreview(edge), 'a'.repeat(PREVIEW_MAX - 1));
});

test('makePreview matches the regex reference on mixed input', () => {
    const ref = s => s.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX).trimEnd();
    for (const s of ['x', ' \n x \t\ty ', 'lorem ipsum\n'.repeat(100), '\n\n\n  indented\n      code {\n  }\n'.repeat(30)])
        eq(makePreview(s), ref(s), JSON.stringify(s.slice(0, 20)));
});

test('hashData (sliced) equals hashBytes for small, boundary and large inputs', async () => {
    for (const n of [0, 1, 512 * 1024, 512 * 1024 + 1, 3 * 1024 * 1024 + 17]) {
        const d = new Uint8Array(n).map((_, i) => (i * 131 + (i >> 9)) & 255);
        eq(await hashData(d), hashBytes(d), `size ${n}`);
    }
});

test('codec round-trips and rejects torn lines', () => {
    const op = {o: 'a', id: 3, h: 'abc', k: 'text', m: 'text/plain', n: 5, t: 9, p: 'hé "q"\n', x: 'hé "q"\n'};
    eq(decodeOp(encodeOp(op).trimEnd()), op);
    eq(decodeOp('{"o":"a","id":'), null);
    eq(decodeOp('{"id":1}'), null);
    eq(decodeOp('null'), null);
});

test('filterEntries: pinned first, kind, multi-term AND, case-insensitive', async () => {
    await withStore({}, async store => {
        const a = addText(store, 'Hello World');
        const b = addText(store, 'hello there');
        addImage(store, 100, 1);
        store.setPinned(a.id, true);
        eq(filterEntries(store.list()).map(e => e.id), [a.id, 3, b.id]);
        eq(filterEntries(store.list(), 'HELLO').map(e => e.id), [a.id, b.id]);
        eq(filterEntries(store.list(), 'hello wor').map(e => e.id), [a.id]);
        eq(filterEntries(store.list(), '', 'image').length, 1);
        eq(filterEntries(store.list(), '', 'pinned').map(e => e.id), [a.id]);
        eq(filterEntries(store.list(), 'zzz'), []);
    });
});

// ---- store --------------------------------------------------------------

test('add inline text persists across reopen', async () => {
    const dir = tmpDir();
    let s = await Store.open(dir);
    addText(s, 'one');
    addText(s, 'two');
    await s.destroy();
    s = await Store.open(dir);
    eq(s.list().map(e => e.preview), ['two', 'one']);
    eq(blobCount(dir), 0);
    await s.destroy();
    rmrf(dir);
});

test('long text and image use blobs; readContent returns exact bytes', async () => {
    await withStore({}, async (store, dir) => {
        const t = addText(store, LONG);
        const i = addImage(store, 5000, 7);
        await store.flush();
        eq(blobCount(dir), 2);
        eq(DEC.decode((await store.readContent(t.id)).bytes), LONG);
        const img = await store.readContent(i.id);
        eq(img.bytes.length, 5000);
        eq(img.mime, 'image/png');
        eq(t.preview.length <= PREVIEW_MAX, true);
    });
});

test('duplicate content only touches (moves to top, no new entry/blob)', async () => {
    await withStore({}, async (store, dir) => {
        const a = addText(store, LONG);
        addText(store, 'other');
        const again = addText(store, LONG);
        await store.flush();
        assert(again === a, 'same entry returned');
        eq(store.size, 2);
        eq(store.list()[0].id, a.id);
        eq(blobCount(dir), 1);
        assert(store.touchByHash(a.hash) && !store.touchByHash('nope'));
    });
});

test('pin and remove survive reopen; blob deleted on remove', async () => {
    const dir = tmpDir();
    let s = await Store.open(dir);
    const a = addText(s, 'a'), b = addText(s, LONG), c = addText(s, 'c');
    s.setPinned(a.id, true);
    s.remove(b.id);
    await s.destroy();
    eq(blobCount(dir), 0);
    s = await Store.open(dir);
    eq(s.list().map(e => [e.preview, e.pinned]), [['c', false], ['a', true]]);
    assert(c.id !== undefined);
    await s.destroy();
    rmrf(dir);
});

test('eviction drops oldest unpinned, keeps pinned, deletes their blobs', async () => {
    await withStore({maxEntries: 3}, async (store, dir) => {
        const first = addText(store, 'p0' + LONG);
        store.setPinned(first.id, true);
        for (let i = 1; i <= 5; i++) addText(store, `t${i}` + LONG);
        await store.flush();
        const live = store.list();
        eq(live.length, 4); // 3 unpinned + 1 pinned
        eq(live.filter(e => e.pinned).length, 1);
        eq(live.filter(e => !e.pinned).map(e => e.preview.slice(0, 2)), ['t5', 't4', 't3']);
        eq(blobCount(dir), 4);
    });
});

test('total blob size limit evicts oldest', async () => {
    await withStore({maxTotalBytes: 2500}, async store => {
        for (let i = 0; i < 5; i++) addImage(store, 1000, i);
        eq(store.size, 2);
    });
});

test('clear keepPinned', async () => {
    await withStore({}, async (store, dir) => {
        const a = addText(store, LONG);
        addText(store, 'b');
        store.setPinned(a.id, true);
        store.clear({keepPinned: true});
        eq(store.list().map(e => e.id), [a.id]);
        store.clear();
        await store.flush();
        eq(store.size, 0);
        eq(blobCount(dir), 0);
    });
});

test('log compaction keeps state and shrinks the log', async () => {
    const dir = tmpDir();
    let s = await Store.open(dir);
    const e = addText(s, 'keep');
    addText(s, 'other');
    for (let i = 0; i < 500; i++) s.touchByHash(e.hash);
    await s.flush();
    const lines = readLog(dir).split('\n').filter(Boolean).length;
    assert(lines < 400, `log should have been compacted, has ${lines} lines`);
    await s.destroy();
    s = await Store.open(dir);
    eq(s.list().map(x => x.preview), ['keep', 'other']);
    await s.destroy();
    rmrf(dir);
});

test('torn last line is repaired and later appends stay valid', async () => {
    const dir = tmpDir();
    let s = await Store.open(dir);
    addText(s, 'good');
    await s.destroy();
    const f = Gio.File.new_for_path(`${dir}/history.log`);
    const out = f.append_to(Gio.FileCreateFlags.NONE, null);
    out.write_all(new TextEncoder().encode('{"o":"a","id":99,"h":"zz'), null);
    out.close(null);

    s = await Store.open(dir);
    eq(s.list().map(e => e.preview), ['good']);
    addText(s, 'after');
    await s.destroy();
    for (const line of readLog(dir).split('\n').filter(Boolean))
        assert(decodeOp(line) !== null, `invalid line left in log: ${line}`);
    s = await Store.open(dir);
    eq(s.list().map(e => e.preview), ['after', 'good']);
    await s.destroy();
    rmrf(dir);
});

test('orphan blobs are swept at startup', async () => {
    const dir = tmpDir();
    let s = await Store.open(dir);
    await s.destroy();
    GLib.file_set_contents(`${dir}/blobs/deadbeef`, 'junk');
    s = await Store.open(dir);
    await s.sweepOrphans();
    await s.flush();
    eq(blobCount(dir), 0);
    await s.destroy();
    rmrf(dir);
});

test('image rows use the thumbnail when there is one', async () => {
    await withStore({}, async store => {
        const e = addImage(store, 100, 3);
        await store.flush();
        eq(store.thumbFile(e).get_basename(), `${e.hash}.thumb`);
        eq(store.iconFile(e).get_path(), store.blobFile(e).get_path()); // no thumbnail yet
        GLib.file_set_contents(store.thumbFile(e).get_path(), 'small');
        eq(store.iconFile(e).get_path(), store.thumbFile(e).get_path());
    });
});

test('deleting an image removes its thumbnail too', async () => {
    await withStore({}, async (store, dir) => {
        const e = addImage(store, 400, 5);
        await store.flush();
        GLib.file_set_contents(store.thumbFile(e).get_path(), 'small');
        eq(blobCount(dir), 2);
        store.remove(e.id);
        await store.flush();
        eq(blobCount(dir), 0);
    });
});

test('sweeping orphans keeps thumbnails of live blobs', async () => {
    const dir = tmpDir();
    const s = await Store.open(dir);
    const img = addImage(s, 500, 4);
    await s.flush();
    GLib.file_set_contents(s.thumbFile(img).get_path(), 'thumb of a live blob');
    GLib.file_set_contents(`${dir}/blobs/cafe.thumb`, 'thumb of nothing');
    GLib.file_set_contents(`${dir}/blobs/cafe`, 'nothing');
    await s.sweepOrphans();
    await s.flush();
    eq(blobCount(dir), 2); // the blob and its thumbnail survive
    assert(GLib.file_test(s.thumbFile(img).get_path(), GLib.FileTest.EXISTS), 'live thumbnail was swept');
    await s.destroy();
    rmrf(dir);
});

test('data is private: dir 0700, files 0600', async () => {
    await withStore({}, async (store, dir) => {
        const e = addText(store, LONG);
        await store.flush();
        const mode = p => Gio.File.new_for_path(p)
            .query_info('unix::mode', 0, null).get_attribute_uint32('unix::mode') & 0o777;
        eq(mode(dir), 0o700);
        eq(mode(`${dir}/blobs`), 0o700);
        eq(mode(`${dir}/history.log`), 0o600);
        eq(mode(`${dir}/blobs/${e.hash}`), 0o600);
    });
});

test('missing blob → readContent null, no throw', async () => {
    await withStore({}, async (store, dir) => {
        const e = addText(store, LONG);
        await store.flush();
        GLib.unlink(`${dir}/blobs/${e.hash}`);
        eq(await store.readContent(e.id), null);
    });
});

test('change listeners fire and can unsubscribe', async () => {
    await withStore({}, async store => {
        let n = 0;
        const off = store.connect(() => n++);
        addText(store, 'a');
        off();
        addText(store, 'b');
        eq(n, 1);
    });
});

test('replay across several main-loop slices restores everything in order', async () => {
    const dir = tmpDir();
    let s = await Store.open(dir, {maxEntries: 5000});
    for (let i = 0; i < 1300; i++) addText(s, `entry ${i}`);
    await s.destroy();
    s = await Store.open(dir, {maxEntries: 5000});
    eq(s.size, 1300);
    eq([s.list()[0].preview, s.list()[1299].preview], ['entry 1299', 'entry 0']);
    await s.destroy();
    rmrf(dir);
});

// ---- emoji ---------------------------------------------------------------

const EMOJI_JSON = `${GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]))}/extension/data/emoji.json`;
const emoji = await EmojiData.load(EMOJI_JSON);

test('emoji data generated by scripts/gen-emoji.js is complete', () => {
    eq(emoji.version, '18.0');
    eq(emoji.length, 1923);
    assert(emoji.groups.length >= 8, `only ${emoji.groups.length} groups`);
    eq(emoji.groupGlyphs.length, emoji.groups.length);
    assert(emoji.groupGlyphs.every(g => g), 'a group chip has no glyph');
    for (const item of emoji.items) {
        assert(item.glyph && item.name && item.lc === item.name.toLowerCase(), `bad item ${JSON.stringify(item)}`);
        assert(item.group >= 0 && item.group < emoji.groups.length, `bad group on ${item.name}`);
        assert(!/[\u0000-\u001f]/.test(item.name), `control character in ${item.name}`);
    }
});

test('emoji data holds base emoji only (no skin-tone variants)', () => {
    const toned = emoji.items.filter(e => [...e.glyph].some(c => {
        const cp = c.codePointAt(0);
        return cp >= 0x1f3fb && cp <= 0x1f3ff;
    }));
    eq(toned.length, 0);
});

test('emoji search matches names, folds accents and filters by group', () => {
    eq(emoji.search('grinning face')[0].glyph, '😀');
    eq(emoji.search('').length, emoji.length);
    assert(emoji.search('face').length > 100, 'expected plenty of faces');
    eq(emoji.search('face nonesuch').length, 0);
    eq(emoji.search('flag: japan')[0].glyph, '🇯🇵');
    eq(emoji.search('pinata')[0].glyph, '🪅'); // the name is folded to ASCII when generated
    eq(emoji.search('face with bags under eyes')[0].glyph, '🫩'); // Unicode 16.0+ addition
    eq(emoji.search('fingerprint')[0].glyph, '🫆');
    const first = emoji.search('', 0);
    assert(first.length > 100 && first.every(e => e.group === 0), 'group filter leaked');
    eq(emoji.search('heart', 0).every(e => e.group === 0), true);
});

await runAll();
