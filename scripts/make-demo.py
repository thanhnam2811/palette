#!/usr/bin/env python3
import os
import sys
import time
import struct
import zlib
import subprocess
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO_DIR = os.path.join(ROOT, "demo")
SCREENSHOTS_DIR = os.path.join(DEMO_DIR, "screenshots")
FRAMES_DIR = os.path.join("/tmp", "palette-demo-frames")

os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
if os.path.exists(FRAMES_DIR):
    shutil.rmtree(FRAMES_DIR)
os.makedirs(FRAMES_DIR, exist_ok=True)

def run_bash(cmd):
    full_cmd = f"source {ROOT}/scripts/dev.sh && {cmd}"
    res = subprocess.run(["bash", "-c", full_cmd], capture_output=True, text=True)
    return res.stdout.strip()

def dev_eval(code):
    return run_bash(f'dev_eval "{code}"')

def dev_keys(*keys):
    toks = " ".join(keys)
    return run_bash(f'dev_keys {toks}')

def dev_shot(path):
    run_bash(f'dev_shot {path}')
    for _ in range(25):
        time.sleep(0.08)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            time.sleep(0.05)
            return
    time.sleep(0.2)

frame_idx = 0
def save_frame():
    global frame_idx
    frame_path = os.path.join(FRAMES_DIR, f"frame_{frame_idx:03d}.png")
    dev_shot(frame_path)
    frame_idx += 1
    return frame_path

def duplicate_frame(count=2):
    global frame_idx
    last_frame = os.path.join(FRAMES_DIR, f"frame_{frame_idx-1:03d}.png")
    for _ in range(count):
        target = os.path.join(FRAMES_DIR, f"frame_{frame_idx:03d}.png")
        shutil.copyfile(last_frame, target)
        frame_idx += 1

print("1. Seeding clean clipboard entries...")
dev_eval("palette.store.clear()")
dev_eval("palette.popup.close()")
time.sleep(0.3)

entries = [
    "curl -sSLo /tmp/emoji-test.txt https://unicode.org/Public/emoji/latest/emoji-test.txt",
    "SELECT users.name, orders.total FROM users JOIN orders ON users.id = orders.user_id WHERE orders.created_at > NOW() - INTERVAL 7 DAY;",
    "const {EmojiData} = await import('./lib/core/emoji.js');",
    "git commit -m 'feat(emoji): upgrade emoji dataset to Unicode 18.0 (1923 emoji)'",
    "https://github.com/thanhnam2811/palette",
]

for t in entries:
    run_bash(f'dev_set_text "{t}"')
    time.sleep(0.2)

# Create colorful gradient image
tmp_img = "/tmp/palette-demo-sample.png"
w, h = 180, 120
raw = b"".join(b"\x00" + b"".join(bytes([(x * 3) % 256, (y * 4) % 256, 200]) for x in range(w)) for y in range(h))
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
open(tmp_img, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
dev_eval(f"(()=>{{const G=imports.gi.GLib,St=imports.gi.St;const [ok,d]=G.file_get_contents('{tmp_img}');St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD,'image/png',new G.Bytes(d));return 'image set'}})()")
time.sleep(0.4)

run_bash('dev_set_text "Fast, compact palette at your cursor 🚀"')
time.sleep(0.3)

print("2. Capturing high-resolution screenshots & demo frames...")
# Frame 0: Initial desktop
save_frame()

# 01. Clipboard history (clean list without preview)
dev_eval("palette.popup.open()")
time.sleep(0.4)
dev_shot(os.path.join(SCREENSHOTS_DIR, "01_clipboard_history.png"))
save_frame()
duplicate_frame(2)

# 02. Move down to image row and open preview
dev_keys("Down")
time.sleep(0.3)
dev_keys("Tab")
time.sleep(0.4)
dev_shot(os.path.join(SCREENSHOTS_DIR, "02_preview_image.png"))
save_frame()
duplicate_frame(3)

# 03. Move down to SQL query with text preview
dev_keys("Down", "Down", "Down", "Down")
time.sleep(0.4)
dev_shot(os.path.join(SCREENSHOTS_DIR, "03_preview_text.png"))
save_frame()
duplicate_frame(3)

# 04. Search clipboard for "git"
dev_keys("Tab") # close preview
time.sleep(0.2)
dev_keys("g")
time.sleep(0.15)
save_frame()
dev_keys("i")
time.sleep(0.15)
save_frame()
dev_keys("t")
time.sleep(0.4)
dev_shot(os.path.join(SCREENSHOTS_DIR, "04_search_clipboard.png"))
save_frame()
duplicate_frame(3)

# 05. Switch to Emoji Picker (Super+.)
dev_eval("(()=>{ palette.popup.close(); palette.popup.toggleEmoji(); })()")
time.sleep(0.5)
dev_shot(os.path.join(SCREENSHOTS_DIR, "05_emoji_picker.png"))
save_frame()
duplicate_frame(3)

# 06. Move in emoji grid
dev_keys("Right", "Right", "Right", "Down")
time.sleep(0.3)
save_frame()
duplicate_frame(2)

# 07. Emoji groups (Tab through groups to People & Body)
dev_keys("Tab")
time.sleep(0.25)
save_frame()
dev_keys("Tab")
time.sleep(0.3)
dev_shot(os.path.join(SCREENSHOTS_DIR, "06_emoji_group.png"))
save_frame()
duplicate_frame(3)

# 08. Reset to All group and search "fire"
dev_eval("(()=>{ palette.popup.close(); palette.popup.toggleEmoji(); })()")
time.sleep(0.4)
dev_keys("f")
time.sleep(0.15)
save_frame()
dev_keys("i")
time.sleep(0.15)
save_frame()
dev_keys("r")
time.sleep(0.15)
save_frame()
dev_keys("e")
time.sleep(0.4)
dev_shot(os.path.join(SCREENSHOTS_DIR, "07_emoji_search.png"))
save_frame()
duplicate_frame(4)

# Move to Fire emoji (item 6)
dev_keys("Right", "Right", "Right", "Right", "Right")
time.sleep(0.3)
save_frame()
duplicate_frame(2)

# Select fire emoji (Enter)
dev_keys("Return")
time.sleep(0.3)
save_frame()
duplicate_frame(2)

print(f"Captured {frame_idx} frames. Encoding video and GIF with ffmpeg...")

mp4_path = os.path.join(DEMO_DIR, "palette-demo.mp4")
gif_path = os.path.join(DEMO_DIR, "palette-demo.gif")

# Generate MP4 (smooth 30fps playback from 2fps timeline)
subprocess.run([
    "ffmpeg", "-y", "-framerate", "2",
    "-i", os.path.join(FRAMES_DIR, "frame_%03d.png"),
    "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p",
    "-vf", "scale=1280:-2",
    mp4_path
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# Generate GIF (960px width with palettegen for crystal clear colors)
subprocess.run([
    "ffmpeg", "-y", "-framerate", "2",
    "-i", os.path.join(FRAMES_DIR, "frame_%03d.png"),
    "-vf", "fps=2,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
    gif_path
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

print("Demo generation complete!")
print("Screenshots:", SCREENSHOTS_DIR)
print("Video MP4:", mp4_path, f"({os.path.getsize(mp4_path)/1024:.1f} KiB)")
print("GIF Demo:", gif_path, f"({os.path.getsize(gif_path)/1024:.1f} KiB)")
