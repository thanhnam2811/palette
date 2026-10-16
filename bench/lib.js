import GLib from 'gi://GLib';

/**
 * Best (minimum) wall time in ms of fn() over `runs` runs after one warm-up.
 * Minimum, not median: the machine is shared and noise only ever adds time.
 */
export function ms(fn, runs = 9) {
    fn();
    const t = [];
    for (let i = 0; i < runs; i++) {
        const a = GLib.get_monotonic_time();
        fn();
        t.push((GLib.get_monotonic_time() - a) / 1000);
    }
    t.sort((x, y) => x - y);
    return t[0];
}

export async function msAsync(fn, runs = 7) {
    await fn();
    const t = [];
    for (let i = 0; i < runs; i++) {
        const a = GLib.get_monotonic_time();
        await fn();
        t.push((GLib.get_monotonic_time() - a) / 1000);
    }
    t.sort((x, y) => x - y);
    return t[0];
}

export function now() {
    return GLib.get_monotonic_time() / 1000;
}

export function table(title, header, rows) {
    print(`\n### ${title}\n`);
    print(`| ${header.join(' | ')} |`);
    print(`|${header.map(() => '---').join('|')}|`);
    for (const r of rows) print(`| ${r.join(' | ')} |`);
}

export const f = (x, d = 3) => (x < 0.001 ? '<0.001' : x.toFixed(d));
