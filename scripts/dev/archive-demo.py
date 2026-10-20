#!/usr/bin/env python3
"""Preserve the authentic native frames losslessly for editing without GNOME."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
root=Path(__file__).resolve().parents[2]
record=Path(sys.argv[1]).resolve()
data=json.loads((record/'recording.json').read_text())
out=root/'docs/media/source'
out.mkdir(parents=True,exist_ok=True)
lines=[]
for i,frame in enumerate(data['frames']):
    assert Path(frame['file']).name==frame['file']
    duration=(data['frames'][i+1]['time']-frame['time']) if i+1<len(data['frames']) else .1
    lines.extend([f"file '{record/frame['file']}'",'option framerate 1000',f'duration {duration:.6f}'])
timeline=record/'archive-timeline.txt'
timeline.write_text('\n'.join(lines)+'\n')
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(timeline),'-fps_mode','passthrough','-c:v','ffv1','-level','3','-pix_fmt','bgr0','-g','1',str(out/'palette-capture.mkv')],check=True)
for name in ['recording.json','events.json']:shutil.copyfile(record/name,out/name)
print('Lossless source archive:',out/'palette-capture.mkv')
