// Real cross-process clipboard owner for E8: a GTK4 client offering several formats at once.
//   gjs -m bench/shell/clip-client.js text|html|image <bytes>      (run inside the dev session env)
// Text payload = <bytes> chars; image payload = a PNG of roughly <bytes> bytes (incompressible noise).
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

const [kind, sizeArg] = ARGV;
const size = parseInt(sizeArg ?? '1024');
const ENC = new TextEncoder();

function pngOfSize(target) {
    // 8-bit gray, stored (uncompressed) deflate blocks => file size ≈ w*h
    const w = 1024, h = Math.max(1, Math.round(target / (w + 1)));
    const raw = new Uint8Array(h * (w + 1));
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (x * 7 + y * 13 + ((x * y) >> 3)) & 255; }
    const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const be32 = n => new Uint8Array([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
    const chunk = (t, d) => { const td = cat(ENC.encode(t), d); return cat(be32(d.length), td, be32(crc(td))); };
    // zlib stream with stored blocks
    const blocks = [];
    for (let i = 0; i < raw.length; i += 65535) {
        const part = raw.subarray(i, Math.min(raw.length, i + 65535));
        blocks.push(new Uint8Array([i + 65535 >= raw.length ? 1 : 0, part.length & 255, part.length >> 8, ~part.length & 255, (~part.length >> 8) & 255]), part);
    }
    let a = 1, b = 0; for (const x of raw) { a = (a + x) % 65521; b = (b + a) % 65521; }
    const z = cat(new Uint8Array([0x78, 1]), ...blocks, be32(((b << 16) | a) >>> 0));
    return cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', cat(be32(w), be32(h), new Uint8Array([8, 0, 0, 0, 0]))), chunk('IDAT', z), chunk('IEND', new Uint8Array(0)));
}

const app = new Gtk.Application({application_id: 'org.palette.BenchClient'});
app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({application: app, default_width: 200, default_height: 100});
    win.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
        const text = ('lorem ipsum dolor sit amet ').repeat(Math.ceil(size / 27)).slice(0, size);
        const providers = [];
        if (kind === 'text' || kind === 'html') {
            providers.push(Gdk.ContentProvider.new_for_bytes('text/plain;charset=utf-8', new GLib.Bytes(ENC.encode(text))));
            if (kind === 'html') providers.push(Gdk.ContentProvider.new_for_bytes('text/html', new GLib.Bytes(ENC.encode(`<p>${text}</p>`))));
        } else {
            providers.push(Gdk.ContentProvider.new_for_bytes('image/png', new GLib.Bytes(pngOfSize(size))));
        }
        win.get_clipboard().set_content(Gdk.ContentProvider.new_union(providers));
        print(`clip-client: offered ${kind} ~${size}B`);
        return GLib.SOURCE_REMOVE;
    });
});
app.run([]);
System.exit(0);
