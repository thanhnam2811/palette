(async () => {
    const St = imports.gi.St, GLib = imports.gi.GLib;
    const cb = St.Clipboard.get_default(), T = St.ClipboardType.CLIPBOARD;
    const now = () => GLib.get_monotonic_time() / 1000;
    const get = m => new Promise(r => cb.get_content(T, m, (_c, b) => r(b ? b.toArray() : null)));
    const min = a => Math.min(...a);
    const PROBE = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING', 'image/gif', 'image/png', 'image/jpg', 'image/jpeg', 'image/webp', 'image/svg+xml', 'text/html'];
    const A = {list: [], get: [], copy: [], hash: [], all: []};
    const B = [];
    const H = [];
    let payload = 0;
    for (let i = 0; i < 7; i++) {
        // A: get_mimetypes + a single get_content (what Watcher does)
        let t0 = now();
        const mimes = cb.get_mimetypes(T);
        let t1 = now();
        const m = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING'].find(x => mimes.includes(x)) ?? ['image/png', 'image/jpeg'].find(x => mimes.includes(x));
        const data = await get(m);   // toArray() already inside `get`
        payload = data.length;
        let t2 = now();
        const hh = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA1, data);
        let t3 = now();
        A.list.push(t1 - t0); A.get.push(t2 - t1); A.hash.push(t3 - t2); A.all.push(t3 - t0);
        // B: probe mimetypes one after another until something comes back
        t0 = now();
        for (const p of PROBE) { const d = await get(p); if (d && d.length) break; }
        B.push(now() - t0);
        // hash algorithms on the same payload
        const h = {};
        for (const [n, ty] of [['sha256', GLib.ChecksumType.SHA256], ['sha1', GLib.ChecksumType.SHA1], ['md5', GLib.ChecksumType.MD5]]) { const a = now(); GLib.compute_checksum_for_data(ty, data); (h[n] ??= []).push(now() - a); H.push([n, now() - a]); }
    }
    const hmin = n => min(H.filter(x => x[0] === n).map(x => x[1]));
    return JSON.stringify({payload, mimes: cb.get_mimetypes(T).join(','), A_list: min(A.list), A_get_incl_toArray: min(A.get), A_hash_sha1: min(A.hash), A_total: min(A.all), B_probe_total: min(B), sha256: hmin('sha256'), sha1: hmin('sha1'), md5: hmin('md5')});
})()
