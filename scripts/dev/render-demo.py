#!/usr/bin/env python3
"""Edit timestamped authentic GNOME frames into a 15s film and seamless GIF."""
import bisect
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import shutil
import tempfile
from PIL import Image,ImageDraw,ImageFont,ImageFilter

ROOT=Path(__file__).resolve().parents[2]
RECORD=Path(sys.argv[1]).resolve()
OUT=ROOT/'docs/media'
if not (RECORD/'000000.png').exists():
    archive=RECORD/'palette-capture.mkv'
    assert archive.exists(), 'Pass a raw capture directory or docs/media/source'
    extracted=Path(tempfile.mkdtemp(prefix='palette-render.'))
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(archive),'-fps_mode','passthrough','-start_number','0',str(extracted/'%06d.png')],check=True)
    for name in ['recording.json','events.json']:shutil.copyfile(RECORD/name,extracted/name)
    RECORD=extracted
raw=json.loads((RECORD/'recording.json').read_text())
events=json.loads((RECORD/'events.json').read_text())
assert not raw['error'] and len(events)==7
WIDTH,HEIGHT,FPS=1920,1080,30
DURATIONS=[1.6,3.0,1.3,1.6,1.7,3.2,2.6]
DURATION=sum(DURATIONS)
STARTS=[sum(DURATIONS[:i]) for i in range(len(DURATIONS))]
TIMES=[frame['time'] for frame in raw['frames']]
SOURCE_RANGES=[(event['time'],events[i+1]['time'] if i+1<len(events) else TIMES[-1]) for i,event in enumerate(events)]
# Keep the actual preview readable, then show selecting the saved message and its paste.
# Trim setup time rather than mislabeling query preparation as an image preview.
SOURCE_RANGES[3]=(events[3]['time'],events[3]['time']+1.0)
SOURCE_RANGES[4]=(events[3]['time']+1.0,events[5]['time']-.4)
STAGE=(80,150,1840,920)
SW,SH=STAGE[2]-STAGE[0],STAGE[3]-STAGE[1]
MASK=Image.new('L',(SW,SH),0)
ImageDraw.Draw(MASK).rounded_rectangle((0,0,SW-1,SH-1),radius=30,fill=255)

def font(size,bold=False):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans'+('-Bold' if bold else '')+'.ttf',size)
FONTS={size:font(size) for size in [23,26,28,30,32,36]}
FONTS['brand']=font(40,True)

def ease(u):
    u=max(0,min(1,u));return u*u*(3-2*u)

def camera(box):
    x,y,w,h=box
    view_h=max(h+52,SH/2.4)
    view_w=max(w+70,view_h*SW/SH)
    view_h=view_w*SH/SW
    cx,cy=x+w/2,y+h/2
    cx=max(view_w/2,min(1920-view_w/2,cx))
    cy=max(view_h/2,min(1080-view_h/2,cy))
    return [cx,cy,view_w,view_h]

BASE=Image.new('RGB',(WIDTH,HEIGHT))
# Restrained violet/indigo lighting outside the captured UI, never painted over it.
pixels=BASE.load()
for y in range(HEIGHT):
    for x in range(WIDTH):
        glow=math.exp(-(((x-420)/1000)**2+((y-280)/700)**2))
        glow2=math.exp(-(((x-1650)/800)**2+((y-920)/650)**2))
        pixels[x,y]=(round(15+8*glow+4*glow2),round(14+5*glow+5*glow2),round(24+17*glow+12*glow2))
LOGO=Image.open(ROOT/'assets/branding/palette.png').convert('RGBA').resize((56,56),Image.Resampling.LANCZOS)
draw=ImageDraw.Draw(BASE)
BASE.paste(LOGO,(83,47),LOGO)
draw.text((156,53),'Palette',font=FONTS['brand'],fill='#f7f6fb')
draw.text((1455,64),'CLIPBOARD + EMOJI',font=FONTS[23],fill='#a9a1bf')
draw.rounded_rectangle((78,148,1842,922),radius=32,fill='#0e0e16',outline='#332e47',width=2)

index=-1
source=None
first=Image.open(RECORD/raw['frames'][max(0,bisect.bisect_right(TIMES,events[0]['time'])-1)]['file']).convert('RGB')
cam=camera(events[0]['focus'])
initial_cam=cam[:]
source_hashes=[]
for frame in raw['frames']:
    source_hashes.append(hashlib.sha256((RECORD/frame['file']).read_bytes()).hexdigest())

movie=OUT/'palette-demo.mp4'
process=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{WIDTH}x{HEIGHT}','-r',str(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(movie)],stdin=subprocess.PIPE)
review_times=[0,.5,1.55,2.5,4.5,5.7,6.5,7.7,8.9,10,11.8,12.6,13.8,14.95]
review_indices={round(t*FPS) for t in review_times}
review=RECORD/'review'
review.mkdir(exist_ok=True)

for n in range(round(DURATION*FPS)):
    t=n/FPS
    scene=min(len(events)-1,bisect.bisect_right(STARTS,t)-1)
    u=(t-STARTS[scene])/DURATIONS[scene]
    a,b=SOURCE_RANGES[scene]
    native_time=a+(b-a)*u
    selected=max(0,min(len(TIMES)-1,bisect.bisect_right(TIMES,native_time)-1))
    if selected!=index:
        index=selected
        source=Image.open(RECORD/raw['frames'][index]['file']).convert('RGB')
    live_focus=raw['frames'][index].get('focus')
    focus_box=live_focus['box'] if live_focus else events[scene]['focus']
    target=camera(focus_box)
    # Damp pans/zoom over ~0.6 s. No interpolation or repainting of UI state.
    response=1-math.exp(-1/(FPS*.20))
    cam=[p+(q-p)*response for p,q in zip(cam,target)]
    if t>DURATION-1:
        mix=ease((t-(DURATION-1))/.85)
        cam=[p+(q-p)*mix for p,q in zip(cam,initial_cam)]
    cx,cy,vw,vh=cam
    # Opening has only a 1.5% scale settle; the loop returns to its exact first pose.
    settle=1+.015*(1-ease(t/.7))
    vw*=settle;vh*=settle
    box=(cx-vw/2,cy-vh/2,cx+vw/2,cy+vh/2)
    footage=source.resize((SW,SH),Image.Resampling.LANCZOS,box=box)
    # Focus treatment affects only the environment around the authentic UI.
    fx,fy,fw,fh=focus_box
    if (live_focus or {}).get('kind','palette')!='editor':
        focus=Image.new('L',(SW,SH),0)
        fd=ImageDraw.Draw(focus)
        sx,sy=SW/vw,SH/vh
        fd.rounded_rectangle(((fx-box[0]-12)*sx,(fy-box[1]-12)*sy,
            (fx+fw-box[0]+12)*sx,(fy+fh-box[1]+12)*sy),radius=28,fill=255)
        focus=focus.filter(ImageFilter.GaussianBlur(6))
        surround=Image.blend(Image.new('RGB',(SW,SH),'#11111b'),footage.filter(ImageFilter.GaussianBlur(7)),.18)
        surround.paste(footage,(0,0),focus)
        footage=surround
    if t>DURATION-.6:
        # Editorial cross-dissolve to the authentic opening overview, not a fake UI state.
        loop=ease((t-(DURATION-.6))/.6)
        x,y,w,h=initial_cam
        opening=first.resize((SW,SH),Image.Resampling.LANCZOS,box=(x-w*1.015/2,y-h*1.015/2,x+w*1.015/2,y+h*1.015/2))
        initial_focus=Image.new('L',(SW,SH),0)
        imd=ImageDraw.Draw(initial_focus)
        fx0,fy0,fw0,fh0=events[0]['focus']
        left,top=x-w*1.015/2,y-h*1.015/2
        imd.rounded_rectangle(((fx0-left-12)*SW/(w*1.015),(fy0-top-12)*SH/(h*1.015),
            (fx0+fw0-left+12)*SW/(w*1.015),(fy0+fh0-top+12)*SH/(h*1.015)),radius=28,fill=255)
        under=Image.blend(Image.new('RGB',(SW,SH),'#11111b'),opening.filter(ImageFilter.GaussianBlur(7)),.18)
        under.paste(opening,(0,0),initial_focus.filter(ImageFilter.GaussianBlur(6)))
        footage=Image.blend(footage,under,loop)
    opacity=.90+.10*ease(t/.7)
    if t>DURATION-.6:opacity=1-.10*ease((t-(DURATION-.6))/.6)
    if opacity<1:footage=Image.blend(Image.new('RGB',(SW,SH),'#11111b'),footage,opacity)
    frame=BASE.copy()
    frame.paste(footage,STAGE[:2],MASK)
    caption=Image.new('RGBA',frame.size)
    cd=ImageDraw.Draw(caption)
    label=events[scene]['label']
    alpha=round(255*min(1,(t-STARTS[scene])/.22)) if scene else 255
    if scene==len(events)-1 and t>DURATION-.6:
        label=events[0]['label'];alpha=round(255*ease((t-(DURATION-.6))/.6))
    cd.text((86,967),label,font=FONTS[36],fill=(239,236,249,alpha))
    shortcut=events[scene]['shortcut']
    if shortcut:
        width=cd.textlength(shortcut,font=FONTS[26])+48
        cd.rounded_rectangle((1838-width,963,1838,1011),radius=14,fill=(56,48,85,220))
        cd.text((1862-width,971),shortcut,font=FONTS[26],fill=(209,199,241,235))
    frame=Image.alpha_composite(frame.convert('RGBA'),caption).convert('RGB')
    process.stdin.write(frame.tobytes())
    if n in review_indices:frame.save(review/f'{t:05.2f}.png')
process.stdin.close()
assert process.wait()==0,'MP4 encoding failed'
# Shared palette, restrained ordered dithering; moving text stays stable across frames.
subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(movie),'-filter_complex','fps=16,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle','-loop','0',str(OUT/'palette-demo.gif')],check=True)
manifest={'format':'continuous authentic GNOME frame capture with edited camera motion',
    'source_resolution':[1920,1080],'source_frames':len(raw['frames']),
    'source_unique_pngs':len(set(source_hashes)),
    'source_effective_fps':round((len(TIMES)-1)/(TIMES[-1]-TIMES[0]),2),
    'native_recorder_limit':'GNOME PipeWire screencast returned AllPipelinesFailed in the isolated headless session; using timestamped real Shell screenshots. Master frame rate describes rendering, not native capture.',
    'master':{'path':'palette-demo.mp4','resolution':[WIDTH,HEIGHT],'fps':FPS,'duration':DURATION},
    'gif':{'path':'palette-demo.gif','width':960,'fps':16,'bytes':(OUT/'palette-demo.gif').stat().st_size},
    'loop':'0.6-second dissolve to the authentic opening view, matching camera and brightness',
    'chapters':[{'start':STARTS[i],'duration':DURATIONS[i],'label':e['label'],'source_start':SOURCE_RANGES[i][0],'source_end':SOURCE_RANGES[i][1]} for i,e in enumerate(events)],
    'checks':['Pinned invoice is present','Saved message pastes into real GTK editor','Selected rocket emoji reaches clipboard history and editor'],
    'source_directory':'source', 'editing':'Live native popup bounds drive damped camera tracking; surroundings are blurred/dimmed, UI pixels are preserved.'}
(OUT/'recording.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2),flush=True)

subprocess.run([sys.executable,str(ROOT/'scripts/dev/archive-demo.py'),str(RECORD)],check=True)
