"""Render an edited walkthrough from actual captured UI states and local audio."""
from pathlib import Path
import argparse,hashlib,json,math,subprocess
import numpy as np
import soundfile as sf
from PIL import Image,ImageDraw,ImageFont

parser=argparse.ArgumentParser()
parser.add_argument('--work-dir',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,required=True)
parser.add_argument('--source-commit',required=True)
args=parser.parse_args()
root=args.work_dir.resolve();out=args.output_dir.resolve();out.mkdir(parents=True,exist_ok=True)
scenes=json.loads((root/'timeline.json').read_text())
schedule=json.loads((root/'capture-schedule.json').read_text())
fps=4;width,height=1920,1080
navy='#202A38';muted='#AEBBD0';blue='#88ACFF';amber='#F3C777'
fonts=[('/System/Library/Fonts/Supplemental/Arial.ttf','/System/Library/Fonts/Supplemental/Arial Bold.ttf'),('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')]
regular,bold=next((a,b) for a,b in fonts if Path(a).exists() and Path(b).exists())
def font(size,strong=False):return ImageFont.truetype(bold if strong else regular,size)
def wrap(text,draw,f,limit):
    lines=[];line=''
    for word in text.split():
        candidate=(line+' '+word).strip()
        if line and draw.textlength(candidate,font=f)>limit:lines.append(line);line=word
        else:line=candidate
    if line:lines.append(line)
    return lines
def sha(file):
    h=hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):h.update(block)
    return h.hexdigest()
required={name for values in schedule.values() for _,name in values if name not in ['title','closing']}
for name in required:assert (root/'frames'/f'{name}.png').is_file(),name
cache={}
def background(name):
    if name in cache:return cache[name]
    image=Image.new('RGB',(width,height),'#EEF2F7');draw=ImageDraw.Draw(image)
    if name in ['title','closing']:
        draw.rounded_rectangle((100,170,1820,904),radius=24,fill='white',outline='#CBD5E1',width=2)
        draw.text((150,222),'INDUSTRIAL GTM ENGINE',font=font(20,True),fill='#315CBA')
        headline='Supplier context.\nHuman-reviewed outreach.' if name=='title' else 'Evidence and human decisions,\nacross every handoff.'
        draw.multiline_text((150,305),headline,font=font(65,True),fill=navy,spacing=18)
        sub='Allco Hydraulic  /  United States  /  Equipment OEMs' if name=='title' else 'Intake → research → native graph → review → synchronized pipeline'
        draw.text((155,508),sub,font=font(26),fill='#667085')
        cards=[('Native Kuzu','Directional source-linked paths'),('Message brief','Audience, focus and CTA'),('Exact HITL','Edits require fresh approval'),('Local demo','No external message sent')]
        for index,(title,description) in enumerate(cards):
            x=150+index*410;draw.rounded_rectangle((x,605,x+380,805),radius=13,fill='#F7F8FA',outline='#E6E9EF')
            draw.text((x+22,635),title,font=font(26,True),fill='#315CBA')
            for j,line in enumerate(wrap(description,draw,font(22),335)):draw.text((x+22,693+j*30),line,font=font(22),fill='#667085')
        note='EDITED WALKTHROUGH OF THE WORKING PORTAL' if name=='title' else 'Live providers off · Public hosting and Snyk verification outstanding'
        draw.text((155,851),note,font=font(20,True),fill='#667085')
    else:
        shot=Image.open(root/'frames'/f'{name}.png').convert('RGB')
        ratio=min(1872/shot.width,884/shot.height)
        shot=shot.resize((round(shot.width*ratio),round(shot.height*ratio)),Image.Resampling.LANCZOS)
        x=(width-shot.width)//2;y=88+(884-shot.height)//2
        image.paste(shot,(x,y));draw.rectangle((x-1,y-1,x+shot.width,y+shot.height),outline='#CBD5E1',width=1)
    cache[name]=image;return image
captions=[];audio=[];offset=0;chapters=[]
for scene in scenes:
    scene['videoDuration']=math.ceil(scene['duration']*fps)/fps;scene['start']=offset
    samples,sr=sf.read(root/'audio'/f"{scene['id']}.wav",dtype='float32')
    assert samples.ndim==1
    samples=np.pad(samples,(0,max(0,round(scene['videoDuration']*sr)-len(samples))))
    audio.append(samples);chapters.append((offset,offset+scene['videoDuration'],scene['title']))
    for cue in scene['captions']:
        chunks=[];buffer=[]
        for word in cue['text'].split():
            buffer.append(word)
            if len(' '.join(buffer))>=82:chunks.append(' '.join(buffer));buffer=[]
        if buffer:chunks.append(' '.join(buffer))
        total=sum(len(c) for c in chunks);position=cue['start']
        for chunk in chunks:
            duration=(cue['end']-cue['start'])*len(chunk)/total
            captions.append({'start':offset+position,'end':offset+position+duration,'text':chunk});position+=duration
    offset+=scene['videoDuration']
assert 120<=offset<=180,offset
sf.write(root/'narration-heart.wav',np.concatenate(audio),sr)
def stamp(value):
    ms=round(value*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'
subtitle=out/'gtm-current-heart.srt'
subtitle.write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(captions))+'\n')
metadata=';FFMETADATA1\ntitle=GTM Engine — Current industrial sales walkthrough\nartist=GTM Engine\ncomment=Edited actual UI captures. Local af_heart narration. Native graph and dry-run delivery. No live provider connection claimed.\n'
for start,end,title in chapters:metadata+=f'\n[CHAPTER]\nTIMEBASE=1/1000\nSTART={round(start*1000)}\nEND={round(end*1000)}\ntitle={title}\n'
(root/'chapters.ffmeta').write_text(metadata)
target=out/'gtm-current-heart.mp4'
command=['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0','-i',str(root/'narration-heart.wav'),'-i',str(root/'chapters.ffmeta'),'-map','0:v','-map','1:a','-map_metadata','2','-map_chapters','2','-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','fast','-crf','20','-threads','4','-c:a','aac','-b:a','160k','-ar','48000','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-metadata:s:a:0','language=eng','-movflags','+faststart','-t',str(offset),str(target)]
process=subprocess.Popen(command,stdin=subprocess.PIPE)
steps=['Intake','Account matching','Native graph','Composition','HITL review','Pipeline']
for scene in scenes:
    print('Rendering',scene['id'],scene['videoDuration'],flush=True)
    for frame in range(round(scene['videoDuration']*fps)):
        local=frame/fps;now=scene['start']+local;name=schedule[scene['id']][0][1]
        for start,candidate in schedule[scene['id']]:
            if local>=start:name=candidate
        image=background(name).copy();draw=ImageDraw.Draw(image)
        draw.rectangle((0,0,width,80),fill=navy);draw.text((32,18),'GTM ENGINE',font=font(24,True),fill=blue)
        draw.text((235,18),scene['title'],font=font(27,True),fill='white')
        draw.text((1880,26),'EDITED DEMO · DRY RUN ONLY',font=font(17,True),fill=amber,anchor='ra')
        for i,step in enumerate(steps):draw.text((34+i*280,60),step,font=font(13,True),fill=amber if i+1==scene['chapter']==5 else 'white' if i+1==scene['chapter'] else muted)
        draw.rectangle((0,979,width,height),fill=navy)
        cue=next((c['text'] for c in captions if c['start']<=now<c['end']),'')
        for i,line in enumerate(wrap(cue,draw,font(29),1760)):draw.text((width/2,990+i*34),line,font=font(29),fill='white',anchor='mt')
        draw.rectangle((0,1075,width,1079),fill='#42536B');draw.rectangle((0,1075,round(width*now/offset),1079),fill=amber if scene['chapter']==5 else blue)
        if frame==min(round(scene['videoDuration']*fps)-1,round(scene['videoDuration']*fps*.55)):image.save(root/f"preview-{scene['id']}.jpg",quality=93)
        process.stdin.write(image.tobytes())
process.stdin.close();result=process.wait()
if result:raise SystemExit(result)
manifest={'duration':offset,'resolution':[width,height],'voice':'af_heart','sourceCommit':args.source_commit,'editedUiCaptures':True,'externalDelivery':False,'chapters':[{'start':a,'end':b,'title':c} for a,b,c in chapters],'captions':len(captions),'videoSha256':sha(target),'frames':[{'name':name,'sha256':sha(root/'frames'/f'{name}.png')} for name in sorted(required)],'output':str(target)}
(root/'render-manifest.json').write_text(json.dumps(manifest,indent=2))
(out/'gtm-current-script.txt').write_text('\n\n'.join(scene['title']+'\n'+' '.join(scene['sentences']) for scene in scenes))
print('COMPLETE',target,'seconds',offset,flush=True)
