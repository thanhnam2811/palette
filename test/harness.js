import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

import {Store} from '../extension/lib/core/store.js';
import {hashBytes} from '../extension/lib/core/hash.js';

const ENC = new TextEncoder();
const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export function assert(cond, msg = 'assertion failed') {
    if (!cond) throw new Error(msg);
}

export function eq(actual, expected, msg = '') {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

export function tmpDir() {
    return GLib.dir_make_tmp('palette-test-XXXXXX');
}

export function rmrf(path) {
    const f = Gio.File.new_for_path(path);
    const info = f.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
        const en = f.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let i;
        while ((i = en.next_file(null)) !== null)
            rmrf(GLib.build_filenamev([path, i.get_name()]));
        en.close(null);
    }
    f.delete(null);
}

/** Add a text entry the way the watcher does. */
export function addText(store, text, mime = 'text/plain;charset=utf-8') {
    const data = ENC.encode(text);
    return store.add({hash: hashBytes(data), kind: 'text', mime, data, text});
}

export function addImage(store, size, seed = 0) {
    const raw = new Uint8Array(size).fill(seed % 251);
    raw[0] = seed & 255; raw[1] = (seed >> 8) & 255;
    return store.add({hash: hashBytes(raw), kind: 'image', mime: 'image/png', data: raw});
}

/** Run `fn(store, dir)` on a fresh temp store and clean up afterwards. */
export async function withStore(limits, fn) {
    const dir = tmpDir();
    const store = await Store.open(dir, limits);
    try {
        await fn(store, dir);
    } finally {
        await store.destroy();
        rmrf(dir);
    }
}

export async function runAll() {
    let failed = 0;
    for (const {name, fn} of tests) {
        try {
            await fn();
            print(`ok   ${name}`);
        } catch (e) {
            failed++;
            print(`FAIL ${name}\n     ${e.stack ?? e.message}`);
        }
    }
    print(`\n${tests.length - failed}/${tests.length} passed`);
    if (failed) System.exit(1);
}
