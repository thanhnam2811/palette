// E13: what the emoji picker costs when it is opened, in the real shell.
// Run inside the dev shell:  source scripts/dev.sh && dev_eval "$(cat bench/shell/e13.js)"
// First-open (pool creation) is measured once; steady state is the minimum of
// seven open/close cycles, like E9.
(async () => {
    const GLib = imports.gi.GLib;
    const now = () => GLib.get_monotonic_time() / 1000;
    const {Popup} = await import(`file://${palette.path}/lib/ui/popup.js`);
    const {EmojiData} = await import(`file://${palette.path}/lib/core/emoji.js`);
    const store = palette.store;
    const emojiPath = `${palette.path}/data/emoji.json`;
    const rss = () => +/VmRSS:.+?([0-9]+) kB/.exec(imports.byteArray.toString(GLib.file_get_contents('/proc/self/status')[1]))[1] / 1024;
    const idle = () => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => { r(); return GLib.SOURCE_REMOVE; }));
    const paint = () => new Promise(r => { const id = global.stage.connect('after-paint', () => { global.stage.disconnect(id); r(); }); GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => { r(); return GLib.SOURCE_REMOVE; }); });
    const actors = () => global.stage.get_n_children();
    const min = xs => Math.min(...xs);
    const out = {};

    // Loading the data file: warm page cache, best of seven.
    const loads = [];
    for (let i = 0; i < 7; i++) {
        const t0 = now();
        EmojiData.load(emojiPath);
        loads.push(now() - t0);
    }
    out.emoji_load_ms = min(loads).toFixed(2);

    const ENC = new TextEncoder();
    store.clear();
    for (let i = 0; i < 500; i++) {
        const text = `entry ${i} ` + 'lorem ipsum dolor sit amet '.repeat(1 + (i * 7) % 5);
        const data = ENC.encode(text);
        store.add({hash: GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, data), kind: 'text', mime: 'text/plain', data, text});
    }
    store.setLimits({maxEntries: 5000});

    const base = actors();
    const p = new Popup(store, {popupAtCursor: false}, {onActivate: () => {}, emojiPath, onEmoji: () => {}});

    const openOnce = async (fn) => { const t0 = now(); const painted = paint(); fn(); const sync = now() - t0; await painted; return [sync, now() - t0]; };
    const cycle = async (fn) => { p.close(); await idle(); return openOnce(fn); };

    const history = [];
    for (let i = 0; i < 7; i++) history.push(await cycle(() => p.open()));
    out.history_open_sync_ms = min(history.map(t => t[0])).toFixed(2);
    out.history_open_paint_ms = min(history.map(t => t[1])).toFixed(2);

    const rssBefore = rss();
    p.close(); await idle();
    const first = await openOnce(() => { p.toggleEmoji().catch(e => logError(e)); });
    out.emoji_first_open_sync_ms = first[0].toFixed(2);
    out.emoji_first_open_paint_ms = first[1].toFixed(2);
    const rssAfter = rss();
    out.emoji_first_open_rss_mb = (rssAfter - rssBefore).toFixed(2);

    const emoji = [];
    for (let i = 0; i < 7; i++) emoji.push(await cycle(() => { p.toggleEmoji().catch(e => logError(e)); }));
    out.emoji_open_sync_ms = min(emoji.map(t => t[0])).toFixed(2);
    out.emoji_open_paint_ms = min(emoji.map(t => t[1])).toFixed(2);

    p.close(); await idle();
    p.destroy();
    await idle();
    out.actors_left = actors() - base;
    return JSON.stringify(out);
})()
