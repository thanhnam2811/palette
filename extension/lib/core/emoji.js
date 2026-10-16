import GLib from 'gi://GLib';

const DEC = new TextDecoder();

/**
 * The emoji picker's data, built by scripts/gen-emoji.js into data/emoji.json
 * (`{version, source, groups: [name], emoji: [[glyph, name, group], ...]}`).
 *
 * Loaded lazily, on the first open of the picker, and read synchronously: the
 * E11 benchmark (docs/BENCH.md) measured the whole read+parse+materialise at
 * ~0.6ms, which is cheaper than importing a JavaScript module at login (+1.7ms
 * on every session) and keeps startup free for people who never open it.
 *
 * Items carry the lowercased name because searching is the hot path (E12).
 * Shell-free, so tests and benchmarks run it under plain `gjs`.
 */
export class EmojiData {
    /** Read `path` and build the searchable items. Throws if the file is missing or malformed. */
    static load(path) {
        const [, bytes] = GLib.file_get_contents(path);
        const raw = JSON.parse(DEC.decode(bytes));
        if (!Array.isArray(raw.groups) || !Array.isArray(raw.emoji))
            throw new Error('emoji data has no groups/emoji arrays');

        const items = raw.emoji.map(([glyph, name, group]) => ({glyph, name, lc: name.toLowerCase(), group}));
        const groupGlyphs = raw.groups.map((_g, i) => items.find(e => e.group === i)?.glyph ?? '');
        return new EmojiData(raw.version, raw.groups, groupGlyphs, items);
    }

    constructor(version, groups, groupGlyphs, items) {
        this.version = version;
        this.groups = groups;
        /** First emoji of each group: the group chips use it as their icon. */
        this.groupGlyphs = groupGlyphs;
        this.items = items;
    }

    get length() {
        return this.items.length;
    }

    /**
     * Items whose name contains every term of `query`, in CLDR order.
     * @param {string} query
     * @param {number} group  group index, or -1 for all groups
     */
    search(query, group = -1) {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const out = [];
        for (const item of this.items) {
            if (group >= 0 && item.group !== group) continue;
            if (terms.length && !terms.every(t => item.lc.includes(t))) continue;
            out.push(item);
        }
        return out;
    }
}
