#!/usr/bin/env python3
"""Real GNOME 46 integration smoke test. Usage: smoke.py /tmp/palette-session.XXXXXX"""
import ast, json, pathlib, subprocess, sys, time, os, signal
root = pathlib.Path(__file__).resolve().parents[2]
run = pathlib.Path(sys.argv[1]).resolve()
ctl = [str(root/'scripts/dev/control.py'),str(run)]
results = []
clients = []
text_payload = "Palette integration " + str(time.time_ns())
def call(*args):
    return subprocess.check_output(ctl+list(args),text=True,timeout=15).strip()
def ev(code):
    value = ast.literal_eval(call('eval',code))[0]
    if value.startswith('ERR '): raise AssertionError(value)
    return value
def check(name, code):
    assert ev(code) == 'true', name
    results.append(name); print('PASS',name,flush=True)
def until(code):
    for _ in range(100):
        if ev(code)=='true': return
        time.sleep(.1)
    raise AssertionError('Timeout: '+code)
def keys(*names):
    ev('(()=>{const C=imports.gi.Clutter,G=imports.gi.GLib;globalThis.__paletteKeys??=C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE);let t=G.get_monotonic_time();for(const tok of '+json.dumps(names)+'){const ks=tok.split("+").map(n=>C["KEY_"+n]);for(const k of ks) __paletteKeys.notify_keyval(t+=1000,k,C.KeyState.PRESSED);for(const k of ks.reverse()) __paletteKeys.notify_keyval(t+=1000,k,C.KeyState.RELEASED);}return true})()')
    time.sleep(.3)
def client(kind):
    payload = str(root/'assets/branding/palette.png') if kind == 'image' else text_payload if kind == 'text' else 'secret sentinel'
    p=subprocess.Popen(ctl+['gjs','-m',str(root/'scripts/dev/clipboard-client.js'),kind,payload,str(run/'artifacts/pasted.txt')],stdout=open(run/'artifacts'/f'client-{kind}.log','w'),stderr=subprocess.STDOUT,start_new_session=True)
    clients.append(p)
    ev('(Main.overview.hide(),true)')
    until('global.get_window_actors().some(a=>a.meta_window.get_title()==="Palette test client")')
    ev('(()=>{const w=global.get_window_actors().find(a=>a.meta_window.get_title()==="Palette test client").meta_window;Main.activateWindow(w);return true})()')
    until('global.get_window_actors().some(a=>a.meta_window.get_title()==="Palette test client" && a.meta_window.has_focus())')
    time.sleep(.5)
    return p
def stop(p):
    os.killpg(p.pid,signal.SIGTERM);p.wait()
try:
    until('Main.layoutManager.monitors.length===1')
    check('isolated install path',f'Main.extensionManager.lookup("palette@namtt").path==={json.dumps(str(run/"data/gnome-shell/extensions/palette@namtt"))}')
    ev('(global.settings.set_strv("enabled-extensions",["devtools@namtt","palette@namtt"]),true)')
    until('!!palette?.store')
    ev('(Main.overview.hide(),true)')
    time.sleep(.5)
    check('panel icon loaded', '!!Main.panel.statusArea["palette@namtt"]')
    check('new-install clipboard shortcuts unset', 'palette.getSettings().get_default_value("toggle-shortcut").deepUnpack().length===0 && palette.getSettings().get_default_value("emoji-shortcut").deepUnpack().length===0')
    ev('(palette.getSettings().set_strv("toggle-shortcut",["<Super>v"]),palette.getSettings().set_strv("emoji-shortcut",["<Super>period"]),true)')
    keys('Super_L+v');check('configured history shortcut','palette.popup.isOpen')
    keys('Escape')
    keys('Super_L+period');check('configured emoji shortcut','palette.popup.isOpen')
    keys('Escape')
    ev('(Main.panel.statusArea["palette@namtt"].menu.open(),true)')
    check('panel menu opens','Main.panel.statusArea["palette@namtt"].menu.isOpen')
    call('shot','panel-menu.png');time.sleep(.3)
    ev('(Main.panel.statusArea["palette@namtt"].menu.close(),true)')
    p=client('text')
    until('palette.store.list().some(e=>e.kind==="text")')
    check('real GTK Wayland text capture','palette.store.list().some(e=>e.inline?.startsWith("Palette integration"))')
    ev('(palette.getSettings().set_boolean("paste-on-select",true),palette.popup.open(),true)')
    keys('Return')
    for _ in range(40):
        if (run/'artifacts/pasted.txt').exists(): break
        time.sleep(.1)
    assert (run/'artifacts/pasted.txt').read_text()==text_payload
    results.append('history selection pastes into real GTK text view')
    print('PASS history selection pastes into real GTK text view',flush=True)
    stop(p)
    before=ev('palette.store.size')
    p=client('secret')
    check('password-manager hint blocks capture',f'palette.store.size==={before}')
    stop(p)
    time.sleep(.5)
    check('secret remains excluded after owner exits',f'palette.store.size==={before} && !palette.store.list().some(e=>e.inline==="secret sentinel")')
    p=client('image')
    until('palette.store.list().some(e=>e.kind==="image")')
    check('real GTK Wayland PNG capture','palette.store.list().some(e=>e.kind==="image")')
    stop(p)
    ev('(palette.getSettings().set_boolean("private-mode",true),true)')
    before=ev('palette.store.size')
    ev('(imports.gi.St.Clipboard.get_default().set_text(imports.gi.St.ClipboardType.CLIPBOARD,"private smoke sentinel"),true)')
    time.sleep(.5)
    check('private mode blocks capture',f'palette.store.size==={before}')
    ev('(palette.getSettings().set_boolean("private-mode",false),palette.getSettings().set_string("popup-position","center"),palette.popup.open(),true)')
    check('history modal opens','palette.popup.isOpen')
    keys('Down','Up','Tab')
    call('shot','history-dark.png');time.sleep(.3)
    keys('Escape');check('Escape closes history','!palette.popup.isOpen')
    ev('(palette.popup.toggleEmoji(),true)');time.sleep(.6)
    keys('s','m','i','l','e','Right','Return')
    call('shot','emoji-dark.png');time.sleep(.3)
    keys('Escape');check('emoji keyboard commit closes modal','!palette.popup.isOpen')
    until(r'palette.store.list().some(e=>Array.from(e.inline??"").some(c=>c.codePointAt(0)>0x1f000))')
    check('emoji copied into real clipboard history',r'palette.store.list().some(e=>Array.from(e.inline??"").some(c=>c.codePointAt(0)>0x1f000))')
    devices=ev("imports.gi.Clutter.get_default_backend().get_default_seat().list_devices().length")
    for i in range(3):
        ev('(global.settings.set_strv("enabled-extensions",["devtools@namtt"]),true)')
        until('!Main.panel.statusArea["palette@namtt"]')
        ev('(global.settings.set_strv("enabled-extensions",["devtools@namtt","palette@namtt"]),true)')
        until('!!palette?.store && !!Main.panel.statusArea["palette@namtt"]')
    check('three disable/enable cycles','!!palette?.store && !!Main.panel.statusArea["palette@namtt"]')
    check('virtual device count stable across cycles',f'imports.gi.Clutter.get_default_backend().get_default_seat().list_devices().length==={devices}')
    ev('(imports.gi.Gio.Settings.new("org.gnome.desktop.interface").set_string("color-scheme","prefer-light"),palette.popup.open(),true)')
    time.sleep(.4);call('shot','history-light.png');time.sleep(.3)
    keys('Escape')
    call('gnome-extensions','prefs','palette@namtt')
    until('global.get_window_actors().some(a=>a.meta_window.get_title()?.includes("Palette"))')
    ev('(()=>{Main.activateWindow(global.get_window_actors().find(a=>a.meta_window.get_title()?.includes("Palette")).meta_window);return true})()')
    time.sleep(1.5)
    call('shot','preferences-light.png');time.sleep(.3)
    check('preferences window opens','global.get_window_actors().some(a=>a.meta_window.get_title()?.includes("Palette"))')
finally:
    for p in clients:
        if p.poll() is None: stop(p)
    (run/'artifacts/results.json').write_text(json.dumps(results,indent=2)+'\n')
print(f'{len(results)} integration checks passed')
