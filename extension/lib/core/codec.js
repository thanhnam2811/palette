/**
 * One log operation <-> one line. Ops carry absolute values so replaying
 * the same op twice is harmless:
 *   a  add     {id, h:hash, k:kind, m:mime, n:size, t:ts, p:preview, x?:inline text, f?:1 pinned}
 *   d  delete  {id}
 *   p  pin     {id, v:0|1}
 *   u  touch   {id, t:ts}
 *
 * decodeOp validates the whole schema: a partially parsed line used to poison
 * the entry accounting (a string size makes #blobBytes NaN) or feed a path into
 * the blob directory (a hash such as "../../x"). Anything unexpected is treated
 * as a torn line, which replay skips and compaction repairs.
 */
const HASH_RE = /^[0-9a-f]{64}$/;

function isId(v) {
    return Number.isInteger(v) && v > 0;
}

function isTs(v) {
    return Number.isInteger(v) && v > 0;
}

function isSize(v) {
    return Number.isInteger(v) && v >= 0;
}

/** Returns null for a corrupt, torn or schema-invalid line. */
export function decodeOp(line) {
    let op;
    try {
        op = JSON.parse(line);
    } catch (_e) {
        return null;
    }
    if (!op || typeof op !== 'object' || Array.isArray(op) || !isId(op.id)) return null;

    switch (op.o) {
    case 'a':
        if (typeof op.h !== 'string' || !HASH_RE.test(op.h)) return null;
        if (op.k !== 'text' && op.k !== 'image') return null;
        if (typeof op.m !== 'string' || op.m === '') return null;
        if (!isSize(op.n) || !isTs(op.t)) return null;
        if (op.p !== undefined && typeof op.p !== 'string') return null;
        if (op.x !== undefined && (typeof op.x !== 'string' || op.k !== 'text')) return null;
        if (op.f !== undefined && op.f !== 0 && op.f !== 1) return null;
        return op;
    case 'd':
        return op;
    case 'p':
        return op.v === 0 || op.v === 1 ? op : null;
    case 'u':
        return isTs(op.t) ? op : null;
    default:
        return null;
    }
}

export function encodeOp(op) {
    return JSON.stringify(op) + '\n';
}
