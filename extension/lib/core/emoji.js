import Gio from 'gi://Gio';

const DEC = new TextDecoder();

/**
 * The emoji picker's data, built by scripts/gen-emoji.js into data/emoji.json
 * (`{version, source, groups: [name], emoji: [[glyph, name, group], ...]}`).
 *
 * Loaded lazily, on the first open of the picker, asynchronously: cheaper
 * than importing a JavaScript module at login and keeps startup free for
 * people who never open it.
 *
 * Items carry the lowercased name because searching is the hot path (E12).
 * Shell-free, so tests and benchmarks run it under plain `gjs`.
 */
export class EmojiData {
    /** Read `path` asynchronously and build the searchable items. Throws if the file is missing or malformed. */
    static async load(path) {
        Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
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
     * Items whose name contains every term of `query`, best match first and CLDR
     * order inside a tier: exact name > whole word > prefix > a word starting with
     * the term > anywhere in the name. `cake` therefore finds "birthday cake"
     * before "pancakes".
     * @param {string} query
     * @param {number} group  group index, or -1 for all groups
     */
    search(query, group = -1) {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0)
            return group < 0 ? this.items.slice() : this.items.filter(item => item.group === group);

        const matches = [];
        for (const item of this.items) {
            if (group >= 0 && item.group !== group) continue;
            let score = 0;
            for (const term of terms) {
                const at = item.lc.indexOf(term);
                if (at < 0) {
                    score = -1;
                    break;
                }
                const end = at + term.length;
                const word = at === 0 || item.lc[at - 1] === ' ';
                const whole = word && (end === item.lc.length || item.lc[end] === ' ');
                if (item.lc === term) score += 5;
                else if (whole) score += 4;
                else if (at === 0) score += 3;
                else if (word) score += 2;
                else score += 1;
            }
            if (score >= 0) matches.push([score, item]);
        }
        matches.sort((a, b) => b[0] - a[0]);
        return matches.map(m => m[1]);
    }
}
