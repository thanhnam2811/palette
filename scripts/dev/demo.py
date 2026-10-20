#!/usr/bin/env python3
"""Capture real isolated GNOME UI and compose a captioned product walkthrough."""
import ast
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RUN = Path(sys.argv[1]).resolve()
CTL = [str(ROOT/'scripts/dev/control.py'), str(RUN)]
OUT = ROOT/'docs/media'
SHOTS = OUT/'screenshots'
RAW = SHOTS/'raw'
for directory in (OUT, SHOTS, RAW, RUN/'artifacts/demo-frames'):
    directory.mkdir(parents=True, exist_ok=True)
frames = []
manifest = []
clients = []

def call(*args):
    return subprocess.check_output(CTL+list(args), text=True, timeout=20).strip()

def ev(code):
    value = ast.literal_eval(call('eval', code))[0]
    if value.startswith('ERR '):
        raise RuntimeError(value)
    return value

def until(code):
    for _ in range(100):
        if ev(code) == 'true':
            return
        time.sleep(.1)
    raise RuntimeError('Timed out: '+code)

def keys(*names):
    ev('(()=>{const C=imports.gi.Clutter,G=imports.gi.GLib;globalThis.__demoKeys??=C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE);let t=G.get_monotonic_time();for(const tok of '+json.dumps(names)+'){const ks=tok.split("+").map(n=>C["KEY_"+n]);for(const k of ks)__demoKeys.notify_keyval(t+=1000,k,C.KeyState.PRESSED);for(const k of ks.reverse())__demoKeys.notify_keyval(t+=1000,k,C.KeyState.RELEASED);}return true})()')
    time.sleep(.16)

def copy(text):
    ev('(palette.popup.close(),palette.store.size)')
    ev('(imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD,'+json.dumps(text,ensure_ascii=False)+'),true)')
    until('palette.store.list().some(e=>e.inline==='+json.dumps(text,ensure_ascii=False)+')')

def query(text):
    keys('Control_L+a')
    keys(*list(text))

def font(size, bold=False):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans'+('-Bold' if bold else '')+'.ttf', size)

def capture(slug, number, title, description, hint, duration=2700, target='popup', gallery=True):
    time.sleep(.25)
    raw = RUN/'artifacts'/f'demo-{len(frames):03d}.png'
    call('shot', raw.name)
    for _ in range(100):
        try:
            shot = Image.open(raw).convert('RGB')
            shot.load()
            break
        except (FileNotFoundError, OSError):
            time.sleep(.05)
    else:
        raise RuntimeError('Incomplete screenshot: '+str(raw))
    if target == 'popup':
        geometry = json.loads(ev('(()=>{function find(a){if((a.get_style_class_name?.()??"").split(" ").includes("palette-popup"))return a;for(const c of a.get_children?.()??[]){const r=find(c);if(r)return r;}return null;}const a=find(Main.layoutManager.uiGroup);return [...a.get_transformed_position(),...a.get_transformed_size()]})()'))
        x,y,w,h = map(round,geometry)
        box = (max(0,x-22), max(0,y-22), min(1280,x+w+22), min(800,y+h+22))
    elif target == 'panel':
        box = (985,0,1280,360)
    else:
        x,y,w,h=json.loads(ev('(()=>{const r=global.get_window_actors().find(a=>a.meta_window.get_title()==="Palette test client").meta_window.get_frame_rect();return [r.x,r.y,r.width,r.height]})()'))
        box=(max(0,x-22),max(0,y-22),min(1280,x+w+22),min(800,y+h+22))
    crop = shot.crop(box)
    scale = min(1.5, 960/crop.width, 440/crop.height)
    crop = crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.LANCZOS)
    card = Image.new('RGB',(1080,720),'#171420')
    draw = ImageDraw.Draw(card)
    draw.text((48,27),'PALETTE',font=font(17,True),fill='#99c1f1')
    draw.text((980,27),f'{number:02d}/08',font=font(16),fill='#aaa5b8')
    title_size=35
    while draw.textlength(title,font=font(title_size,True))>984:title_size-=1
    draw.text((48,67),title,font=font(title_size,True),fill='white')
    draw.text((48,118),description,font=font(19),fill='#c9c4d7')
    draw.rounded_rectangle((38,165,1042,638),radius=20,fill='#24202f',outline='#393343')
    card.paste(crop,((1080-crop.width)//2,180+(440-crop.height)//2))
    draw.text((48,657),hint,font=font(18),fill='#99c1f1')
    draw.text((48,689),'Real GNOME Shell capture · Synthetic clipboard content',font=font(12),fill='#8c8799')
    path = RUN/'artifacts/demo-frames'/f'{len(frames):03d}.png'
    card.save(path)
    frames.append((path,duration))
    if gallery:
        card.save(SHOTS/f'{slug}.png')
        shot.save(RAW/f'{slug}.png')
        manifest.append({'feature':slug,'title':title,'crop':box,'raw':f'screenshots/raw/{slug}.png','image':f'screenshots/{slug}.png'})
    print('Captured',slug,flush=True)

def close():
    ev('(palette.popup.close(),true)')

try:
    until('Main.layoutManager.monitors.length===1')
    assert ev('Main.extensionManager.lookup("palette@namtt").path') == str(RUN/'data/gnome-shell/extensions/palette@namtt')
    ev('(global.settings.set_strv("enabled-extensions",["devtools@namtt","palette@namtt"]),true)')
    until('!!palette?.store')
    ev('(()=>{Main.overview.hide();for(const a of global.get_window_actors())a.meta_window.delete(global.get_current_time());const s=palette.getSettings();s.set_boolean("private-mode",false);s.set_boolean("paste-on-select",false);s.set_string("popup-position","center");s.set_string("density","comfortable");s.set_strv("toggle-shortcut",["<Super>v"]);s.set_strv("emoji-shortcut",["<Super>period"]);const b=imports.gi.Gio.Settings.new("org.gnome.desktop.background");b.set_string("picture-uri","");b.set_string("picture-uri-dark","");b.set_string("picture-options","none");b.set_string("primary-color","#171420");imports.gi.Gio.Settings.new("org.gnome.desktop.interface").set_string("color-scheme","prefer-dark");palette.store.clear();return true})()')
    entries = [
        'Design review — Friday, 10:30',
        'git switch -c feature/new-ideas',
        'Invoice #1042 — Studio North — $240',
        'Invoice #1043 — Type Foundry — $180',
        'Palette launch checklist\n\n✓ Finish the first draft\n✓ Share the design preview\n→ Collect feedback from the team\n→ Ship something useful',
        'A small idea worth keeping ✨',
        'Thanks for the thoughtful feedback!',
    ]
    for text in entries:
        copy(text)
    ev('(palette.popup.open(),true)')
    capture('01-history',1,'Your clipboard, ready when you are.','Text, images and useful fragments — together in one small palette.','Super + V  ·  Choose your shortcut in Preferences')

    for n,letter in enumerate('invoice'):
        keys(letter)
        capture('search-typing',2,'Find it as fast as you type.','Search the history without leaving what you are doing.','Type to search  ·  ↑ ↓ to choose  ·  Enter to paste',duration=140,gallery=False)
    capture('02-search',2,'Find it as fast as you type.','Search the history without leaving what you are doing.','Type to search  ·  ↑ ↓ to choose  ·  Enter to paste',duration=2300)

    close()
    image = str(ROOT/'assets/branding/banner.png')
    ev('(()=>{const G=imports.gi.GLib,S=imports.gi.St;const [,d]=G.file_get_contents('+json.dumps(image)+');S.Clipboard.get_default().set_content(S.ClipboardType.CLIPBOARD,"image/png",new G.Bytes(d));return true})()')
    until('palette.store.list()[0]?.kind==="image"')
    ev('(palette.popup.open(),true)')
    keys('Tab')
    capture('03-image-preview',3,'See the image before you paste.','A thumbnail in the list. A larger preview when you need it.','Tab  ·  Toggle the preview pane')

    keys('Down','Down','Down')
    capture('04-text-preview',4,'Keep the whole thought.','Multi-line notes stay intact, with a readable text preview.','↑ ↓  ·  Browse without losing the preview')
    keys('Tab')
    query('checklist')
    keys('Control_L+p')
    keys('Control_L+a','BackSpace','Control_L+2')
    assert ev('palette.store.list().some(e=>e.pinned && e.inline?.includes("checklist"))')=='true'
    capture('05-pinned',5,'Keep the things you reach for.','Pin a note or snippet, then find it in the Pinned filter.','Ctrl + P  ·  Pin or unpin     Ctrl + 2  ·  Pinned items')

    close()
    ev('(palette.popup.toggleEmoji(),true)')
    time.sleep(.6)
    capture('06-emoji',6,'A little expression, one shortcut away.','Browse emoji, jump between groups, or search by name.','Super + .  ·  Your configurable emoji shortcut',duration=1800)
    query('rocket');keys('Return')
    capture('emoji-one',6,'Say more with emoji.','Search by name and collect a whole run before inserting.','Enter  ·  Add to the run     Esc  ·  Insert the run',duration=900,gallery=False)
    query('sparkles');keys('Return')
    capture('07-emoji-run',6,'Say more with emoji.','Search by name and collect a whole run before inserting.','Enter  ·  Add to the run     Esc  ·  Insert the run',duration=2400)
    keys('Escape')
    until('palette.store.list().some(e=>e.inline==="🚀✨")')

    ev('(palette.getSettings().set_boolean("private-mode",true),Main.panel.statusArea["palette@namtt"].menu.open(),true)')
    before=ev('palette.store.size')
    ev('(imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD,"Private demo content — never recorded"),true)')
    time.sleep(.4)
    assert ev('palette.store.size')==before
    capture('08-private-mode',7,'Pause recording. Keep your focus.','Private mode stops new clipboard content from entering history.','Panel menu  ·  Private mode     Existing history stays saved',target='panel')
    ev('(Main.panel.statusArea["palette@namtt"].menu.close(),palette.getSettings().set_boolean("private-mode",false),true)')

    output=RUN/'artifacts/demo-pasted.txt'
    p=subprocess.Popen(CTL+['gjs','-m',str(ROOT/'scripts/dev/clipboard-client.js'),'text','Ready for the next idea.',str(output)],stdout=open(RUN/'artifacts/demo-client.log','w'),stderr=subprocess.STDOUT,start_new_session=True)
    clients.append(p)
    until('global.get_window_actors().some(a=>a.meta_window.get_title()==="Palette test client")')
    ev('(()=>{Main.activateWindow(global.get_window_actors().find(a=>a.meta_window.get_title()==="Palette test client").meta_window);return true})()')
    until('palette.store.list().some(e=>e.inline==="Ready for the next idea.")')
    ev('(palette.getSettings().set_boolean("paste-on-select",true),palette.popup.open(),true)')
    query('thoughtful');keys('Return')
    for _ in range(100):
        if output.exists() and output.read_text()=='Thanks for the thoughtful feedback!':break
        time.sleep(.05)
    else:raise RuntimeError('Real GTK paste did not arrive')
    capture('09-quick-paste',8,'Back to your work in one keystroke.','Choose a saved item. Palette pastes it into the focused app.','Enter  ·  Paste the selected item',target='window',duration=2600)
    os.killpg(p.pid,signal.SIGTERM);p.wait()

    ev('(imports.gi.Gio.Settings.new("org.gnome.desktop.interface").set_string("color-scheme","prefer-light"),true)')
    call('gnome-extensions','prefs','palette@namtt')
    until('global.get_window_actors().some(a=>a.meta_window.get_title()==="Palette")')
    ev('(()=>{Main.activateWindow(global.get_window_actors().find(a=>a.meta_window.get_title()==="Palette").meta_window);return true})()')
    time.sleep(1.2)
    call('shot','demo-preferences-light.png')
    time.sleep(.5)
    Image.open(RUN/'artifacts/demo-preferences-light.png').save(RAW/'preferences-light.png')

    # All animation states are real captured UI. Captions/cropping only; no UI is fabricated.
    images=[Image.open(path).convert('RGB') for path,_ in frames]
    atlas=Image.new('RGB',(270*len(images),180))
    for i,img in enumerate(images):atlas.paste(img.resize((270,180)),(270*i,0))
    palette=atlas.quantize(colors=192,method=Image.Quantize.MEDIANCUT)
    indexed=[img.quantize(palette=palette,dither=Image.Dither.NONE) for img in images]
    indexed[0].save(OUT/'palette-demo.gif',save_all=True,append_images=indexed[1:],duration=[duration for _,duration in frames],loop=0,optimize=True,disposal=2)
    timeline=RUN/'artifacts/demo-frames/timeline.txt'
    timeline.write_text(''.join(f"file '{path}'\nduration {duration/1000}\n" for path,duration in frames)+f"file '{frames[-1][0]}'\n")
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(timeline),'-vf','fps=30','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'palette-demo.mp4')],check=True)
    (OUT/'capture.json').write_text(json.dumps({'session':str(RUN),'shell':'46.0','resolution':[1280,800],'frame_size':[1080,720],'duration_ms':sum(d for _,d in frames),'captured_frames':len(frames),'gif_frames':Image.open(OUT/'palette-demo.gif').n_frames,'captions':True,'checks':['Pinned filter contains the pinned checklist','Emoji run is copied as 🚀✨','Private mode does not change history size','History selection arrives in a real GTK text view'],'features':manifest},indent=2,ensure_ascii=False)+'\n')
    print('Created',len(frames),'frames;',sum(d for _,d in frames)/1000,'seconds;',round((OUT/'palette-demo.gif').stat().st_size/1024),'KiB GIF',flush=True)
finally:
    for p in clients:
        if p.poll() is None:
            os.killpg(p.pid,signal.SIGTERM);p.wait()
