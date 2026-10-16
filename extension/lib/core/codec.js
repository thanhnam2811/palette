/**
 * One log operation <-> one line. Ops carry absolute values so replaying
 * the same op twice is harmless:
 *   a  add     {id, h:hash, k:kind, m:mime, n:size, t:ts, p:preview, x?:inline text, f?:1 pinned}
 *   d  delete  {id}
 *   p  pin     {id, v:0|1}
 *   u  touch   {id, t:ts}
 */
export function encodeOp(op) {
    return JSON.stringify(op) + '\n';
}

/** Returns null for a corrupt/torn line. */
export function decodeOp(line) {
    try {
        const op = JSON.parse(line);
        return op && typeof op.o === 'string' && Number.isInteger(op.id) ? op : null;
    } catch (_e) {
        return null;
    }
}
