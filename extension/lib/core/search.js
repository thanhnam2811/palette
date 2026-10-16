/**
 * Filter + order entries for display: pinned first, then most recent first.
 * `kind`: 'all' | 'pinned' | 'text' | 'image'. `query`: whitespace-separated
 * terms, all must occur in the preview (case-insensitive).
 * `entries` must already be sorted by ts desc (Store.list()).
 */
export function filterEntries(entries, query = '', kind = 'all') {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const pinned = [];
    const rest = [];

    for (const e of entries) {
        if (kind === 'pinned' && !e.pinned) continue;
        if ((kind === 'text' || kind === 'image') && e.kind !== kind) continue;

        if (terms.length) {
            const lc = e.lc ??= e.preview.toLowerCase();
            if (!terms.every(t => lc.includes(t))) continue;
        }
        (e.pinned ? pinned : rest).push(e);
    }
    return pinned.concat(rest);
}
