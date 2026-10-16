// E10: what image rows cost in the popup.
//
//   E10a  row icon = the stored blob (what v1 shipped, and the fallback for
//         images that have no thumbnail yet)
//   E10b  row icon = the 128px thumbnail written by lib/thumbs.js at copy time
//
// Fixture: 20 large JPEGs (12MP), the shape a phone photo or a screenshot burst
// has. Generate them once:
//   for i in $(seq 1 20); do convert -size 4032x3024 gradient: -quality 88 /tmp/opencode/e10/big/photo$i.jpg; done
// Run inside the dev shell:  source scripts/dev.sh && dev_eval "$(cat bench/shell/e10.js)"
(async () => {
    const GLib = imports.gi.GLib;
    const Gio = imports.gi.Gio;
    const {Popup} = await import(`file://${palette.path}/lib/ui/popup.js`);
    const {writeThumbnail} = await import(`file://${palette.path}/lib/thumbs.js`);
    const store = palette.store;
    const dir = '/tmp/opencode/e10/big';
    const now = () => GLib.get_monotonic_time() / 1000;
    const rss = () => +/VmRSS:.+?([0-9]+) kB/.exec(imports.byteArray.toString(GLib.file_get_contents('/proc/self/status')[1]))[1] / 1024;
    const idle = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
    const paint = () => new Promise(r => { const id = global.stage.connect('after-paint', () => { global.stage.disconnect(id); r(); }); GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => { r(); return GLib.SOURCE_REMOVE; }); });
    const out = [];

    for (const thumbnails of [false, true]) {
        store.clear();
        const enumerator = Gio.File.new_for_path(dir).enumerate_children('standard::name', 0, null);
        let info, n = 0;
        const entries = [];
        while ((info = enumerator.next_file(null))) {
            const [, contents] = GLib.file_get_contents(`${dir}/${info.get_name()}`);
            entries.push(store.add({
                hash: GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, contents),
                kind: 'image', mime: 'image/jpeg', data: contents,
            }));
            n++;
        }
        enumerator.close(null);
        store.setLimits({maxEntries: 5000});

        let copy_path_ms = 0;
        if (thumbnails) {
            await store.flush(); // writeThumbnail reads the blob file
            const t0 = now();
            for (const e of entries) writeThumbnail(store.blobFile(e), store.thumbFile(e));
            copy_path_ms = now() - t0; // main-loop cost of queueing them all
            for (let i = 0; i < 100; i++) { // wait for the worker threads
                if (entries.every(e => GLib.file_test(store.thumbFile(e).get_path(), GLib.FileTest.EXISTS))) break;
                await idle(20);
            }
        }

        const p = new Popup(store, {popupAtCursor: false}, {onActivate: () => {}, emojiPath: `${palette.path}/data/emoji.json`, onEmoji: () => {}});
        await idle(200);
        const rss0 = rss();
        const t0 = now();
        const painted = paint();
        p.open();
        const open_ms = now() - t0;
        await painted;
        const paint_ms = now() - t0;

        // Wait until RSS stops moving: that is when the icon loads have landed.
        let last = rss(), stable = 0;
        const t = now();
        while (now() - t < 4000 && stable < 4) {
            await idle(50);
            const r = rss();
            stable = Math.abs(r - last) < 0.05 ? stable + 1 : 0;
            last = r;
        }
        out.push({
            variant: thumbnails ? 'thumbnail at copy time (128px)' : 'blob only (no thumbnail)',
            entries: n,
            queue_on_copy_ms: copy_path_ms.toFixed(2),
            open_ms: open_ms.toFixed(2),
            paint_ms: paint_ms.toFixed(2),
            settled_ms: (now() - t0).toFixed(0),
            rss_mb: (last - rss0).toFixed(2),
        });

        p.close();
        await idle(100);
        p.destroy();
        await idle(100);
    }
    return JSON.stringify(out, null, 1);
})()
