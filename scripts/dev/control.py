#!/usr/bin/env python3
"""Address one explicit isolated session; never discover or control host processes."""
import json, os, pathlib, subprocess, sys
run = pathlib.Path(sys.argv[1]).resolve()
assert run.parent == pathlib.Path('/tmp') and run.name.startswith('palette-session.')
env = dict(os.environ, HOME=str(run/'home'), XDG_CONFIG_HOME=str(run/'config'),
           XDG_DATA_HOME=str(run/'data'), XDG_CACHE_HOME=str(run/'cache'),
           XDG_STATE_HOME=str(run/'state'), XDG_RUNTIME_DIR=str(run/'runtime'),
           DBUS_SESSION_BUS_ADDRESS=(run/'bus').read_text().strip(),
           WAYLAND_DISPLAY='palette-test', GSETTINGS_BACKEND='keyfile')
env.pop('DISPLAY', None)
pid = int((run/'shell.pid').read_text())
proc = pathlib.Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
assert f'XDG_RUNTIME_DIR={run}/runtime'.encode() in proc
assert f'HOME={run}/home'.encode() in proc
assert ('DBUS_SESSION_BUS_ADDRESS='+env['DBUS_SESSION_BUS_ADDRESS']).encode() in proc
cmd = sys.argv[2:]
if cmd[0] == 'eval':
    cmd = ['gdbus','call','--session','--dest','org.palette.Dev','--object-path','/org/palette/Dev','--method','org.palette.Dev.Eval',json.dumps(cmd[1],ensure_ascii=False)]
elif cmd[0] == 'shot':
    cmd = ['gdbus','call','--session','--dest','org.palette.Dev','--object-path','/org/palette/Dev','--method','org.palette.Dev.Screenshot',str(run/'artifacts'/cmd[1])]
subprocess.run(cmd, env=env, check=True)
