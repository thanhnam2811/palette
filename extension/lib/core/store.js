import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {encodeOp, decodeOp} from './codec.js';
import {makePreview, INLINE_MAX} from './text.js';
import {yieldToMainLoop} from './yield.js';

const PRIVATE = Gio.FileCreateFlags.PRIVATE; // files 0600
const ENC = new TextEncoder();
const DEC = new TextDecoder();
const MIN_WASTED_FOR_COMPACTION = 200;
const REPLAY_SLICE = 500; // log lines parsed per main-loop turn at startup
const THUMB_SUFFIX = '.thumb'; // blobs/<hash>.thumb: small copy for the row icon

const DEFAULT_LIMITS = {maxEntries: 50, maxTotalBytes: 256 * 1024 * 1024, inlineMax: INLINE_MAX};
// One lifetime per directory, from the start of open() until destroy() finishes.
// disable() cannot await destroy(), and a queued compaction of the old Store
// would otherwise rewrite history.log after the re-enabled Store appended to it.
// Registering the open too keeps a second enable from loading the same log while
// the first one is still replaying it.
const closing = new Map();

/** `blobs/<hash>.thumb` belongs to the blob `blobs/<hash>`. */
function baseHash(name) {
    return name.endsWith(THUMB_SUFFIX) ? name.slice(0, -THUMB_SUFFIX.length) : name;
}

/**
 * Clipboard history on disk.
 *
 *   <dir>/history.log        append-only op log (see codec.js), replayed at startup
 *   <dir>/blobs/<hash>       content of long texts and images
 *   <dir>/blobs/<hash>.thumb small copy of an image, for its row icon
 *
 * RAM holds only small Entry records; content is read on demand. Entries are
 * mutated synchronously; disk I/O is async and serialised through one promise
 * chain, so a blob is always written before the log op that references it.
 *
 * Entry: {id, hash, kind:'text'|'image', mime, size, ts, pinned, preview,
 *         inline: string|null (whole text when short, else content is a blob)}.
 * Treat entries as read-only outside this class.
 */
export class Store {
    #dir;
    #logFile;
    #blobsDir;
    #limits;
    #entries = new Map();
    #byHash = new Map();
    #sorted = null;
    #nextId = 1;
    #lastTs = 0;
    #lines = 0;
    #blobBytes = 0;
    #stream = null;
    #tail = Promise.resolve();
    #listeners = new Set();
    #closePromise = null;
    #lifetime = null;
    #release = null;

    /** Open (creating if needed) the store in `dir` and replay its log. */
    static async open(dir, limits = {}) {
        // Done here rather than at module scope: the extension review guidelines
        // forbid touching shared objects while the module is being imported.
        Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
        Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
        Gio._promisify(Gio.File.prototype, 'append_to_async', 'append_to_finish');
        Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');
        Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
        Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');
        Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
        Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
        Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');

        // Wait for both an in-flight open and a closing instance on this directory.
        while (closing.has(dir)) await closing.get(dir);

        let release;
        const lifetime = new Promise(resolve => { release = resolve; });
        closing.set(dir, lifetime);
        const store = new Store(dir, limits);
        store.#lifetime = lifetime;
        store.#release = release;
        try {
            await store.#load();
        } catch (err) {
            release();
            if (closing.get(dir) === lifetime) closing.delete(dir);
            throw err;
        }
        return store;
    }

    constructor(dir, limits = {}) {
        this.#dir = dir;
        this.#blobsDir = GLib.build_filenamev([dir, 'blobs']);
        this.#logFile = Gio.File.new_for_path(GLib.build_filenamev([dir, 'history.log']));
        this.#limits = {...DEFAULT_LIMITS, ...limits};
    }

    // ---- reading -------------------------------------------------------

    /** All entries, most recently used first. Do not mutate the returned array. */
    list() {
        return this.#sorted ??= [...this.#entries.values()].sort((a, b) => b.ts - a.ts);
    }

    get(id) {
        return this.#entries.get(id) ?? null;
    }

    get size() {
        return this.#entries.size;
    }

    blobFile(entry) {
        return Gio.File.new_for_path(GLib.build_filenamev([this.#blobsDir, entry.hash]));
    }

    /**
     * Small JPEG written next to the blob when an image is copied (see
     * bench/shell/e10.js): the row draws it at 18px, and decoding the full photo
     * for that costs ~17ms more on the first paint.
     */
    thumbFile(entry) {
        return Gio.File.new_for_path(GLib.build_filenamev([this.#blobsDir, entry.hash + THUMB_SUFFIX]));
    }

    /** File the row should draw for `entry`: its thumbnail when there is one. */
    iconFile(entry) {
        const thumb = this.thumbFile(entry);
        return GLib.file_test(thumb.get_path(), GLib.FileTest.EXISTS) ? thumb : this.blobFile(entry);
    }

    /** Full content as {mime, bytes: Uint8Array}, or null if the blob is missing. */
    async readContent(id) {
        const e = this.#entries.get(id);
        if (!e) return null;
        if (e.inline !== null) return {mime: e.mime, bytes: ENC.encode(e.inline)};
        try {
            const [bytes] = await this.blobFile(e).load_contents_async(null);
            return {mime: e.mime, bytes};
        } catch (err) {
            console.error(`palette: cannot read blob ${e.hash}: ${err.message}`);
            return null;
        }
    }

    /** True until destroy() starts; background passes use it to stop early. */
    get alive() {
        return this.#closePromise === null;
    }

    /** Subscribe to changes; returns an unsubscribe function. */
    connect(fn) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }

    // ---- mutation ------------------------------------------------------

    /** Move an existing entry to the top. Returns false if `hash` is unknown. */
    touchByHash(hash) {
        const e = this.#byHash.get(hash);
        if (!e) return false;
        this.#touch(e);
        return true;
    }

    /**
     * Add content. `data` is a Uint8Array (copied if it needs a blob); `text`
     * (decoded string) is required for kind 'text'. A known `hash` just
     * touches the existing entry. If a blob cannot be written (full disk,
     * permissions), the entry is removed again and its add op is not logged.
     */
    add({hash, kind, mime, data, text}) {
        const known = this.#byHash.get(hash);
        if (known) {
            this.#touch(known);
            return known;
        }

        const size = data.length;
        const isText = kind === 'text';
        const e = {
            id: this.#nextId++,
            hash, kind, mime, size,
            ts: this.#nextTs(),
            pinned: false,
            preview: isText ? makePreview(text) : '',
            inline: isText && text.length <= this.#limits.inlineMax ? text : null,
        };
        this.#register(e);

        if (e.inline === null) {
            const bytes = new GLib.Bytes(data); // own copy: `data` may be reused by the caller
            this.#enqueue(async () => {
                try {
                    await this.blobFile(e).replace_contents_bytes_async(bytes, null, false, PRIVATE, null);
                } catch (err) {
                    // Nothing references this content on disk: drop it from RAM too,
                    // and let #log skip the add op that is queued behind this write.
                    this.#unregisterSilently(e);
                    this.#changed();
                    throw err;
                }
            });
        }
        this.#log(addOp(e));

        this.#evict();
        this.#changed();
        return e;
    }

    setPinned(id, pinned) {
        const e = this.#entries.get(id);
        if (!e || e.pinned === pinned) return;
        e.pinned = pinned;
        this.#log({o: 'p', id, v: pinned ? 1 : 0});
        this.#changed();
    }

    remove(id) {
        const e = this.#entries.get(id);
        if (!e) return;
        this.#unregister(e);
        this.#log({o: 'd', id});
        this.#changed();
    }

    /** Delete everything (pinned entries too unless `keepPinned`). */
    clear({keepPinned = false} = {}) {
        for (const e of [...this.#entries.values()]) {
            if (keepPinned && e.pinned) continue;
            this.#unregister(e);
            this.#log({o: 'd', id: e.id});
        }
        this.#changed();
    }

    setLimits(limits) {
        this.#limits = {...this.#limits, ...limits};
        this.#evict();
        this.#changed();
    }

    // ---- lifecycle -----------------------------------------------------

    /** Resolves once every queued disk write has finished. */
    flush() {
        return this.#tail;
    }

    async destroy() {
        if (this.#closePromise) return this.#closePromise;
        this.#listeners.clear();
        const done = (async () => {
            await this.#tail;
            await this.#closeStream();
        })();
        this.#closePromise = done;
        try {
            await done;
        } finally {
            this.#release?.();
            this.#release = null;
            if (closing.get(this.#dir) === this.#lifetime) closing.delete(this.#dir);
        }
    }

    // ---- internals -----------------------------------------------------

    #nextTs() {
        this.#lastTs = Math.max(Date.now(), this.#lastTs + 1);
        return this.#lastTs;
    }

    #register(e) {
        this.#entries.set(e.id, e);
        this.#byHash.set(e.hash, e);
        if (e.inline === null) this.#blobBytes += e.size;
        this.#sorted = null;
    }

    #unregister(e) {
        this.#entries.delete(e.id);
        if (this.#byHash.get(e.hash) === e) this.#byHash.delete(e.hash);
        this.#sorted = null;
        if (e.inline !== null) return;
        this.#blobBytes -= e.size;
        this.#enqueue(async () => {
            for (const file of [this.blobFile(e), this.thumbFile(e)]) {
                try {
                    await file.delete_async(GLib.PRIORITY_DEFAULT, null);
                } catch (err) {
                    if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                        throw err;
                }
            }
        });
    }

    #touch(e) {
        e.ts = this.#nextTs();
        this.#sorted = null;
        this.#log({o: 'u', id: e.id, t: e.ts});
        this.#changed();
    }

    #evict() {
        const {maxEntries, maxTotalBytes} = this.#limits;
        const unpinned = this.list().filter(e => !e.pinned);
        let count = unpinned.length;
        for (let i = unpinned.length - 1; i >= 0; i--) {
            if (count <= maxEntries && this.#blobBytes <= maxTotalBytes) break;
            this.#unregister(unpinned[i]);
            this.#log({o: 'd', id: unpinned[i].id});
            count--;
        }
    }

    #changed() {
        for (const fn of this.#listeners) fn();
    }

    #enqueue(task) {
        this.#tail = this.#tail.then(task).catch(err => console.error(`palette: store I/O failed: ${err.message}`));
        return this.#tail;
    }

    #log(op) {
        this.#lines++;
        const bytes = ENC.encode(encodeOp(op));
        this.#enqueue(async () => {
            // The entry can be gone by now: its blob write failed, it was evicted,
            // or it was removed before this queued op reached the disk. Writing the
            // add anyway would leave a log entry with no content behind it.
            if (op.o === 'a' && !this.#entries.has(op.id)) return;
            try {
                this.#stream ??= await this.#logFile.append_to_async(PRIVATE, GLib.PRIORITY_DEFAULT, null);
                await writeAll(this.#stream, bytes);
            } catch (err) {
                // A failed append may have left a partial line. Drop the entry
                // that could not be recorded and rewrite the log from RAM so the
                // next op starts on a clean line. Once destroy() has started, do
                // neither: the repair would outlive its await, and the next open
                // already treats a torn tail as corrupt.
                if (op.o === 'a') {
                    const e = this.#entries.get(op.id);
                    if (e) {
                        if (this.alive) this.#unregister(e);
                        else this.#unregisterSilently(e);
                        this.#changed();
                    }
                }
                const stream = this.#stream;
                this.#stream = null;
                if (stream) await stream.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
                if (this.alive) this.#compact();
                throw err;
            }
        });
        const wasted = this.#lines - this.#entries.size;
        if (wasted > Math.max(MIN_WASTED_FOR_COMPACTION, 2 * this.#entries.size))
            this.#compact();
    }

    /**
     * Rewrite the log as one `a` op per live entry. The live set is taken now so
     * the snapshot is ordered correctly against later ops; entries dropped before
     * the write runs (failed blob, eviction) are filtered out at execution time.
     */
    #compact() {
        const live = [...this.#entries.values()].sort((a, b) => a.ts - b.ts);
        this.#lines = live.length;
        this.#enqueue(async () => {
            const ops = live.filter(e => this.#entries.get(e.id) === e).map(e => encodeOp(addOp(e))).join('');
            await this.#closeStream();
            if (ops === '') {
                // Gio hangs (assertion, promise never resolves) when asked to
                // replace a file with an empty GBytes. An empty history has no
                // log at all; the next append recreates it.
                try {
                    await this.#logFile.delete_async(GLib.PRIORITY_DEFAULT, null);
                } catch (err) {
                    if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) throw err;
                }
                return;
            }
            const bytes = new GLib.Bytes(ENC.encode(ops));
            await this.#logFile.replace_contents_bytes_async(bytes, null, false, PRIVATE, null);
        });
    }

    async #closeStream() {
        const s = this.#stream;
        this.#stream = null;
        if (s) await s.close_async(GLib.PRIORITY_DEFAULT, null);
    }

    async #load() {
        GLib.mkdir_with_parents(this.#blobsDir, 0o700); // also creates #dir
        GLib.chmod(this.#dir, 0o700);

        let text = '';
        try {
            const [contents] = await this.#logFile.load_contents_async(null);
            text = DEC.decode(contents);
        } catch (err) {
            if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) throw err;
        }

        let corrupt = text !== '' && !text.endsWith('\n'); // torn last write
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === '') continue;
            const op = decodeOp(lines[i]);
            if (op) {
                this.#lines++;
                this.#replay(op);
            } else {
                corrupt = true;
            }
            if (i % REPLAY_SLICE === REPLAY_SLICE - 1) await yieldToMainLoop(); // keep the shell responsive
        }

        this.#evict();
        const wasted = this.#lines - this.#entries.size;
        if (corrupt || wasted > Math.max(MIN_WASTED_FOR_COMPACTION, 2 * this.#entries.size))
            this.#compact();
    }

    #replay(op) {
        switch (op.o) {
        case 'a': {
            const old = this.#entries.get(op.id);
            if (old) this.#unregisterSilently(old);
            this.#register({
                id: op.id, hash: op.h, kind: op.k, mime: op.m, size: op.n, ts: op.t,
                pinned: op.f === 1, preview: op.p ?? '', inline: op.x ?? null,
            });
            this.#nextId = Math.max(this.#nextId, op.id + 1);
            this.#lastTs = Math.max(this.#lastTs, op.t);
            break;
        }
        case 'd': {
            const e = this.#entries.get(op.id);
            if (e) this.#unregisterSilently(e);
            break;
        }
        case 'p': {
            const e = this.#entries.get(op.id);
            if (e) e.pinned = op.v === 1;
            break;
        }
        case 'u': {
            const e = this.#entries.get(op.id);
            if (e) {
                e.ts = op.t;
                this.#sorted = null;
                this.#lastTs = Math.max(this.#lastTs, op.t);
            }
            break;
        }
        }
    }

    /** Remove from memory only: replay must not touch disk (the blob may belong to a later op). */
    #unregisterSilently(e) {
        this.#entries.delete(e.id);
        if (this.#byHash.get(e.hash) === e) this.#byHash.delete(e.hash);
        if (e.inline === null) this.#blobBytes -= e.size;
        this.#sorted = null;
    }

    /**
     * Delete blob files no entry refers to (left by crashes or failed deletes).
     * Async and low priority; call it some time after startup, not from open().
     */
    async sweepOrphans() {
        const en = await Gio.File.new_for_path(this.#blobsDir)
            .enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null);
        const orphans = [];
        for (;;) {
            const infos = await en.next_files_async(256, GLib.PRIORITY_LOW, null);
            if (infos.length === 0) break;
            for (const info of infos) {
                if (!this.#byHash.has(baseHash(info.get_name()))) orphans.push(info.get_name());
            }
        }
        await en.close_async(GLib.PRIORITY_LOW, null);

        for (const name of orphans) {
            if (!this.alive) return; // disabled while the sweep was running
            this.#enqueue(async () => {
                if (this.#byHash.has(baseHash(name))) return; // the same content was copied again meanwhile
                try {
                    await Gio.File.new_for_path(GLib.build_filenamev([this.#blobsDir, name])).delete_async(GLib.PRIORITY_DEFAULT, null);
                } catch (err) {
                    if (!err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) throw err;
                }
            });
        }
    }
}

function addOp(e) {
    const op = {o: 'a', id: e.id, h: e.hash, k: e.kind, m: e.mime, n: e.size, t: e.ts, p: e.preview};
    if (e.inline !== null) op.x = e.inline;
    if (e.pinned) op.f = 1;
    return op;
}

async function writeAll(stream, bytes) {
    let off = 0;
    while (off < bytes.length) {
        const written = await stream.write_bytes_async(new GLib.Bytes(bytes.subarray(off)), GLib.PRIORITY_DEFAULT, null);
        if (written <= 0) throw new Error('short write');
        off += written;
    }
}
