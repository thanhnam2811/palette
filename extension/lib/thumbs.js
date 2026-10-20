import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

import {yieldToMainLoop} from './core/yield.js';

// Longest side of the stored thumbnail; rows draw 18px icons (E10 in docs/BENCH.md).
const THUMB_PX = 128;
// 16KB of JPEG decodes in ~1.2ms at the worst point of a 12MP photo, so the main
// loop gets a turn between slices instead of one ~6ms stall (E10).
const CHUNK = 16 * 1024;
const QUALITY = '85';
const DEBUG = GLib.getenv('PALETTE_DEBUG') === '1';

/**
 * Write the small JPEG an image row draws instead of the full photo.
 *
 * The photo is decoded straight to thumbnail size (libjpeg's 1/8 scale), in 16KB
 * slices with a main-loop turn in between — a worker thread is not an option,
 * because GJS refuses to run JS callbacks on other threads. A failure is not
 * fatal: the row falls back to the original blob, so it is logged, not thrown.
 *
 * @returns {Promise<void>} resolves when the file is written (or given up on)
 */
export async function writeThumbnail(blobFile, thumbFile) {
    const t0 = GLib.get_monotonic_time();
    const loader = GdkPixbuf.PixbufLoader.new();
    let turns = 0;
    let worst = 0;
    try {
        // Ask for a thumbnail-sized decode (libjpeg then starts at 1/8 scale
        // instead of 4032px wide) with the aspect ratio of the real image.
        loader.connect('size-prepared', (_loader, width, height) => {
            const scale = Math.min(1, THUMB_PX / Math.max(width, height));
            loader.set_size(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
        });
        const input = blobFile.read(null);
        for (;;) {
            const bytes = input.read_bytes(CHUNK, null);
            if (bytes.get_size() === 0) break;
            const t = GLib.get_monotonic_time();
            loader.write_bytes(bytes);
            worst = Math.max(worst, (GLib.get_monotonic_time() - t) / 1000);
            turns++;
            await yieldToMainLoop();
        }
        input.close(null);
        loader.close();
        const pixbuf = loader.get_pixbuf();
        pixbuf.savev(thumbFile.get_path(), 'jpeg', ['quality'], [QUALITY]);
        if (DEBUG)
            console.log(`palette: thumbnail ${pixbuf.get_width()}x${pixbuf.get_height()} in ${((GLib.get_monotonic_time() - t0) / 1000).toFixed(2)}ms over ${turns} turns (worst ${worst.toFixed(2)}ms)`);
    } catch (err) {
        console.error(`palette: no thumbnail for ${blobFile.get_basename()}: ${err.message}`);
    }
}

/**
 * Catch up on images that were copied before thumbnails existed (or whose
 * thumbnail was lost); their rows draw the full blob until this runs. Called once
 * after startup, one image at a time.
 */
export function fillMissingThumbnails(store) {
    const missing = store.list().filter(e => e.kind === 'image' &&
        !GLib.file_test(store.thumbFile(e).get_path(), GLib.FileTest.EXISTS));
    if (missing.length === 0) return 0;
    // One at a time: starting every decode at once would spike RAM by ~0.5MB each.
    (async () => {
        for (const entry of missing) {
            if (!store.alive) break; // extension was disabled mid-pass
            if (!store.get(entry.id)) continue; // deleted while the pass was running
            await writeThumbnail(store.blobFile(entry), store.thumbFile(entry));
        }
    })().catch(err => console.error(`palette: thumbnail pass failed: ${err.message}`));
    return missing.length;
}
