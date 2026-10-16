#!/usr/bin/env bash
# Fill the dev shell's clipboard history with a few text entries and one image.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/scripts/dev.sh"
tmp=$(mktemp -d)
python3 - "$tmp/seed.png" <<'PY'
import struct, sys, zlib
w, h = 120, 80
raw = b''.join(b'\x00' + b''.join(bytes([(x * 2) % 256, (y * 3) % 256, 160]) for x in range(w)) for y in range(h))
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
open(sys.argv[1], 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                              + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
PY
for t in "hello palette world" "multi line text" "git commit -m 'fix: handle torn log' && git push" \
         "SELECT * FROM users WHERE id = 42 AND status = 'active' ORDER BY created_at DESC LIMIT 100; -- long line to test the ellipsis" \
         "https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator" "short"; do
    dev_set_text "$t" >/dev/null; sleep 0.3
done
dev_eval "(()=>{const G=imports.gi.GLib,St=imports.gi.St;const [ok,d]=G.file_get_contents('$tmp/seed.png');St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD,'image/png',new G.Bytes(d));return 'image set'})()"
sleep 0.5
rm -rf "$tmp"
dev_eval "palette.store.size"
