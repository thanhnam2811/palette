#!/usr/bin/env python3
"""Record one real GNOME interaction flow, then edit a continuous product film."""
import ast
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/media'
RUN=Path(sys.argv[1]).resolve()
CTL=[str(ROOT/'scripts/dev/control.py'),str(RUN)]
RECORD=RUN/'artifacts'/f'continuous-{time.time_ns()}'
EVENTS=[]
CLIENTS=[]

def call(*args):
    return subprocess.check_output(CTL+list(args),text=True,timeout=20).strip()

def ev(code):
    value=ast.literal_eval(call('eval',code))[0]
    if value.startswith('ERR '):raise RuntimeError(value)
    return value

def until(code):
    for _ in range(100):
        if ev(code)=='true':return
        time.sleep(.08)
    raise RuntimeError('Timed out: '+code)

def method(name,*args):
    return call('gdbus','call','--session','--dest','org.palette.Dev','--object-path','/org/palette/Dev','--method','org.palette.Dev.'+name,*args)

def keys(*names):
    ev('(()=>{const C=imports.gi.Clutter,G=imports.gi.GLib;globalThis.__filmKeys??=C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE);let t=G.get_monotonic_time();for(const tok of '+json.dumps(names)+'){const ks=tok.split("+").map(n=>C["KEY_"+n]);for(const k of ks)__filmKeys.notify_keyval(t+=1000,k,C.KeyState.PRESSED);for(const k of ks.reverse())__filmKeys.notify_keyval(t+=1000,k,C.KeyState.RELEASED);}return true})()')
    time.sleep(.07)

def type_text(text):
    for char in text:
        keys(char)
        time.sleep(.045)

def focus_box(target):
    if target=='panel':return [1025,0,255,340]
    if target=='editor':
        return json.loads(ev('(()=>{const r=global.get_window_actors().find(a=>a.meta_window.get_title()==="Launch notes").meta_window.get_frame_rect();return [r.x,r.y,r.width,r.height]})()'))
    return json.loads(ev('(()=>{function find(a){if((a.get_style_class_name?.()??"").split(" ").includes("palette-popup"))return a;for(const c of a.get_children?.()??[]){const r=find(c);if(r)return r;}return null;}const a=find(Main.layoutManager.uiGroup);return [...a.get_transformed_position(),...a.get_transformed_size()]})()'))

def mark(label,shortcut='',target='popup'):
    box=focus_box(target)
    EVENTS.append({'us':round(time.monotonic()*1e6),'label':label,'shortcut':shortcut,'focus':box})
    print(label,flush=True)

def copy(text):
    ev('(imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD,'+json.dumps(text)+'),true)')
    until('palette.store.list().some(e=>e.inline==='+json.dumps(text)+')')

recording=False
try:
    until('Main.layoutManager.monitors.length===1')
    assert ev('Main.extensionManager.lookup("palette@namtt").path')==str(RUN/'data/gnome-shell/extensions/palette@namtt')
    ev('(global.settings.set_strv("enabled-extensions",["devtools@namtt","palette@namtt"]),true)')
    until('!!palette?.store')
    ev('(()=>{Main.overview.hide();for(const a of global.get_window_actors())a.meta_window.delete(global.get_current_time());const s=palette.getSettings();s.set_boolean("private-mode",false);s.set_boolean("paste-on-select",true);s.set_string("popup-position","center");s.set_string("density","comfortable");s.set_strv("toggle-shortcut",["<Super>v"]);s.set_strv("emoji-shortcut",["<Super>period"]);const b=imports.gi.Gio.Settings.new("org.gnome.desktop.background");b.set_string("picture-uri","");b.set_string("picture-uri-dark","");b.set_string("picture-options","none");b.set_string("primary-color","#171420");imports.gi.Gio.Settings.new("org.gnome.desktop.interface").set_string("color-scheme","prefer-dark");palette.popup.close();palette.store.clear();return true})()')
    for text in ['Invoice #1042 — Studio North — $240','Invoice #1043 — Type Foundry — $180','git switch -c feature/new-ideas','A small idea worth keeping','The new Palette build is ready for a spin.']:
        copy(text)
    ev('(()=>{const G=imports.gi.GLib,S=imports.gi.St;const [,d]=G.file_get_contents('+json.dumps(str(ROOT/'assets/branding/palette.png'))+');S.Clipboard.get_default().set_content(S.ClipboardType.CLIPBOARD,"image/png",new G.Bytes(d));return true})()')
    until('palette.store.list()[0]?.kind==="image"')
    pasted=RUN/'artifacts/film-pasted.txt'
    client=subprocess.Popen(CTL+['gjs','-m',str(ROOT/'scripts/dev/demo-editor.js'),str(pasted)],stdout=open(RUN/'artifacts/film-editor.log','w'),stderr=subprocess.STDOUT,start_new_session=True)
    CLIENTS.append(client)
    until('global.get_window_actors().some(a=>a.meta_window.get_title()==="Launch notes")')
    ev('(()=>{const w=global.get_window_actors().find(a=>a.meta_window.get_title()==="Launch notes").meta_window;w.move_frame(true,640,300);Main.activateWindow(w);return true})()')
    until('global.get_window_actors().some(a=>a.meta_window.get_title()==="Launch notes"&&a.meta_window.has_focus())')
    ev('(imports.gi.Meta.CursorTracker.get_for_display(global.display).set_pointer_visible(false),true)')
    keys('Super_L+v')
    RECORD.mkdir(parents=True)
    assert method('RecordStart',str(RECORD),'30')=='(true,)'
    recording=True
    mark('Within reach.','',target='popup');time.sleep(1.0)
    mark('Find it as you type.','Super + V');type_text('invoice');time.sleep(.5)
    keys('Down');time.sleep(.25);keys('Up');time.sleep(.3)
    mark('Keep the useful ones.','Ctrl + P');keys('Control_L+p');time.sleep(.5)
    keys('Control_L+a','BackSpace','Control_L+2');time.sleep(.7)
    assert ev('palette.store.list().some(e=>e.pinned&&e.inline?.includes("Invoice"))')=='true'
    keys('Control_L+4','Tab');mark('Preview before pasting.','Tab');time.sleep(1.0)
    keys('Tab','Control_L+1');type_text('build');time.sleep(.2);keys('Return')
    mark('Back to your work.','Enter',target='editor');time.sleep(.8)
    assert 'The new Palette build is ready for a spin.' in pasted.read_text()
    keys('Return','Return')
    keys('Super_L+period');time.sleep(.3)
    mark('A little more expression.','Super + .');type_text('rocket');time.sleep(.4);keys('Return');time.sleep(.65)
    keys('Escape');time.sleep(.5)
    until('palette.store.list().some(e=>e.inline==="🚀")')
    assert '🚀' in pasted.read_text()
    keys('Super_L+v');mark('Copy. Find. Keep creating.','',target='popup');time.sleep(1.5)

finally:
    if recording:
        method('RecordStop')
        for _ in range(100):
            if (RECORD/'recording.json').exists():break
            time.sleep(.05)
    for client in CLIENTS:
        if client.poll() is None:os.killpg(client.pid,signal.SIGTERM);client.wait()

source=json.loads((RECORD/'recording.json').read_text())
assert source['error'] is None and len(source['frames'])>=60,source.get('error')
for event in EVENTS:event['time']=(event.pop('us')-source['startUs'])/1e6
(RECORD/'events.json').write_text(json.dumps(EVENTS,indent=2)+'\n')
subprocess.run([sys.executable,str(ROOT/'scripts/dev/render-demo.py'),str(RECORD)],check=True)
