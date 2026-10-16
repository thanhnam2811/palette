/** Longest preview kept in memory (chars). */
export const PREVIEW_MAX = 200;
/** Texts up to this many chars live in the log itself; longer ones go to a blob file. */
export const INLINE_MAX = 1024;

// Same set as the regex class \s, as char codes (see bench/text.js).
function isSpace(c) {
    if (c <= 32) return c === 32 || (c >= 9 && c <= 13);
    return c === 160 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
        c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

/**
 * One-line excerpt of `str`: whitespace runs collapsed to one space, at most
 * PREVIEW_MAX chars. Cost is O(PREVIEW_MAX), not O(str.length), unless the text
 * starts with a huge run of whitespace.
 */
export function makePreview(str) {
    let out = '';
    let pendingSpace = false;
    for (let i = 0; i < str.length && out.length < PREVIEW_MAX; i++) {
        if (isSpace(str.charCodeAt(i))) {
            pendingSpace = out !== '';
        } else {
            if (pendingSpace) out += ' ';
            pendingSpace = false;
            out += str[i];
        }
    }
    if (out.length > PREVIEW_MAX) out = out.slice(0, PREVIEW_MAX);
    // Don't leave half a surrogate pair at the end: it is not valid UTF-8 for labels.
    const last = out.charCodeAt(out.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}
