#!/usr/bin/env -S gjs -m
// Build extension/data/emoji.json from the Unicode emoji test data.
//
//   scripts/gen-emoji.js [emoji-test.txt] [out.json]
//
// Source: /usr/share/unicode/emoji/emoji-test.txt (Debian/Ubuntu: `unicode-data`).
// The output is committed, so users never need that package; regenerate only
// when the Unicode data or the filters here change.
//
// Filters: `fully-qualified` entries only (the RGI set), minus skin-tone
// variants (U+1F3FB..U+1F3FF). See docs/ARCHITECTURE.md § Emoji data.
import GLib from 'gi://GLib';

const TONE_LO = 0x1f3fb;
const TONE_HI = 0x1f3ff;
const DEC = new TextDecoder();

const root = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));
const src = ARGV[0] ?? '/usr/share/unicode/emoji/emoji-test.txt';
const out = ARGV[1] ?? `${root}/extension/data/emoji.json`;

const [, bytes] = GLib.file_get_contents(src);
const text = DEC.decode(bytes);

const groups = [];
const emoji = [];
let group = -1;

for (const line of text.split('\n')) {
    const header = line.match(/^# group: (.+)$/);
    if (header) {
        group = groups.push(header[1].trim()) - 1;
        continue;
    }
    if (!line || line[0] === '#') continue;

    const m = line.match(/^([0-9A-F ]+?)\s*;\s*fully-qualified\s*#\s*(\S+)\s+E[0-9.]+\s+(.+?)\s*$/u);
    if (!m) continue;

    const [, codePoints, glyph, rawName] = m;
    const toned = codePoints.split(' ').some(cp => {
        const v = parseInt(cp, 16);
        return v >= TONE_LO && v <= TONE_HI;
    });
    if (toned) continue;

    // Names are English text. Fold typographic quotes ("twelve o’clock") and
    // diacritics (piñata, Türkiye) so plain ASCII typing always matches.
    const name = rawName
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    emoji.push([glyph, name, group]);
}

// Fail loudly rather than write a truncated file.
if (group < 0 || groups.length < 5 || emoji.length < 1000)
    throw new Error(`suspicious parse: ${groups.length} groups, ${emoji.length} emoji from ${src}`);
for (const [glyph, name, g] of emoji) {
    if (!glyph || !name || /[\u0000-\u001f]/.test(name) || /[^\x20-\x7e]/.test(name))
        throw new Error(`bad entry: ${JSON.stringify([glyph, name, g])}`);
}

// Groups without fully-qualified entries (Unicode "Component") are dropped and
// the remaining indices remapped, so every group chip in the UI has content.
const kept = groups.map((g, i) => [g, i]).filter(([, i]) => emoji.some(e => e[2] === i));
const remap = new Map(kept.map(([, old], newIndex) => [old, newIndex]));
const outGroups = kept.map(([g]) => g);
for (const e of emoji) e[2] = remap.get(e[2]);

const version = DEC.decode(bytes).match(/^# Version: (\S+)$/m)?.[1] ?? 'unknown';
const json = JSON.stringify({version, source: 'unicode emoji-test.txt', groups: outGroups, emoji});

GLib.mkdir_with_parents(GLib.path_get_dirname(out), 0o755);
GLib.file_set_contents(out, json);
print(`${out}: ${emoji.length} emoji, ${groups.length} groups, ` +
      `${(json.length / 1024).toFixed(1)} KiB (Unicode ${version})`);
