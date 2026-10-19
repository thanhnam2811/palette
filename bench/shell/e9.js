// E9: what opening the history popup costs, in the real shell, per density.
// Run inside the dev shell:  source scripts/dev.sh && dev_eval "$(cat bench/shell/e9.js)"
// Both densities are measured back to back on the same history, best of seven.
(async () => {
    const GLib = imports.gi.GLib;
    const now = () => GLib.get_monotonic_time() / 1000;
    const {Popup} = await import(`file://${palette.path}/lib/ui/popup.js`);
    const store = palette.store;
    const rss = () => +/VmRSS:.+?([0-9]+) kB/.exec(imports.byteArray.toString(GLib.file_get_contents('/proc/self/status')[1]))[1] / 1024;
    const idle = () => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => { r(); return GLib.SOURCE_REMOVE; }));
    const paint = () => new Promise(r => { const id = global.stage.connect('after-paint', () => { global.stage.disconnect(id); r(); }); GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => { r(); return GLib.SOURCE_REMOVE; }); });
    const ENC = new TextEncoder();
    const prefs = compact => ({popupPosition: 'center', compact});
    const callbacks = {onActivate: () => {}, emojiPath: `${palette.path}/data/emoji.json`, onEmoji: () => {}};
    const out = [];
    for (const N of [50, 500]) {
        store.clear();
        for (let i = 0; i < N; i++) {
            const text = `entry ${i} ` + 'lorem ipsum dolor sit amet '.repeat(1 + (i * 7) % 5);
            const data = ENC.encode(text);
            store.add({hash: GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, data), kind: 'text', mime: 'text/plain', data, text});
        }
        store.setLimits({maxEntries: 5000});
        for (const compact of [false, true]) {
            const p = new Popup(store, prefs(compact), callbacks);
            const sync = [], toPaint = [];
            for (let i = 0; i < 7; i++) {
                const t0 = now();
                p.open();
                sync.push(now() - t0);
                await paint();
                toPaint.push(now() - t0);
                p.close();
                await idle();
            }
            const r0 = rss();
            p.open(); await idle(); const rOpen = rss(); p.close(); await idle();
            p.destroy();
            out.push({
                N,
                density: compact ? 'compact' : 'comfortable',
                open_sync_ms: Math.min(...sync).toFixed(2),
                open_to_paint_ms: Math.min(...toPaint).toFixed(2),
                rss_open_delta_mb: (rOpen - r0).toFixed(2),
            });
        }
    }
    return JSON.stringify(out);
})()
