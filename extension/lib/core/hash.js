import GLib from 'gi://GLib';

import {yieldToMainLoop} from './yield.js';

const SLICE = 256 * 1024;

/** SHA-256 (hex) of a Uint8Array, computed synchronously. Fine for small inputs. */
export function hashBytes(data) {
    return GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, data);
}

/**
 * Same hash, but big inputs are digested in 256 KB slices with a main-loop
 * turn in between, so hashing a screenshot never stalls a frame
 * (longest block ~1.2 ms instead of ~4.5 ms/MB; see docs/BENCH.md, E1b).
 */
export async function hashData(data) {
    if (data.length <= 2 * SLICE) return hashBytes(data);

    const checksum = new GLib.Checksum(GLib.ChecksumType.SHA256);
    for (let i = 0; i < data.length; i += SLICE) {
        checksum.update(data.subarray(i, i + SLICE));
        await yieldToMainLoop();
    }
    return checksum.get_string();
}
