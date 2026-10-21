"""Original deterministic artwork for tests. Requires Pillow only to regenerate."""
from PIL import Image, ImageDraw
from pathlib import Path
import json, math
root = Path(__file__).parent
colors = [(236,174,83),(243,167,155),(156,190,168),(150,184,211),(191,165,206),(226,196,120)]
for i in range(12):
    im = Image.new('RGBA', (768,768))
    d=ImageDraw.Draw(im)
    def scale(box): return tuple(int(n*3) for n in box)
    def ellipse(box, fill, outline=None, width=1): d.ellipse(scale(box), fill=fill, outline=outline, width=width*3)
    def line(points, fill, width=1): d.line([(int(x*3),int(y*3)) for x,y in points],fill=fill,width=width*3,joint='curve')
    ink=(68,49,43); white=(255,251,239); col=colors[i%len(colors)]
    if i%3==0: # expressive puppy, transparent outside the ears
        ellipse((28,45,102,187), white); ellipse((154,45,228,187), white)
        ellipse((33,50,97,182), ink); ellipse((159,50,223,182), ink)
        ellipse((44,44,212,220), white); ellipse((49,49,207,215), col, ink, 3)
        ellipse((76,102,91,124), ink); ellipse((165,102,180,124), ink)
        ellipse((91,131,165,192), white); ellipse((116,139,140,156), ink)
        line([(128,154),(128,167),(113,173)],ink,3);line([(128,167),(143,173)],ink,3)
        if i>5: ellipse((123,173,141,190),(226,116,126))
        ellipse((64,133,84,144),(235,133,132));ellipse((174,133,194,144),(235,133,132))
    elif i%3==1: # rounded paw silhouette
        for box in [(40,40,93,108),(102,20,155,88),(164,40,217,108),(19,105,72,164)]:
            ellipse(box,white); ellipse(tuple(v+(5 if j<2 else -5) for j,v in enumerate(box)),col,ink,2)
        ellipse((69,94,214,225),white);ellipse((74,99,209,220),col,ink,3)
        ellipse((110,145,124,161),ink);ellipse((159,145,173,161),ink)
        line([(127,180),(142,189),(159,179)],ink,3)
    else: # a happy bone
        ellipse((25,56,97,130),white);ellipse((25,126,97,200),white)
        ellipse((159,56,231,130),white);ellipse((159,126,231,200),white)
        d.rounded_rectangle(scale((53,96,203,160)), radius=30,fill=white)
        ellipse((30,61,92,125),col,ink,3);ellipse((30,131,92,195),col,ink,3)
        ellipse((164,61,226,125),col,ink,3);ellipse((164,131,226,195),col,ink,3)
        d.rounded_rectangle(scale((57,101,199,155)),radius=20,fill=col)
        ellipse((100,117,111,129),ink);ellipse((145,117,156,129),ink)
        line([(115,136),(128,142),(142,135)],ink,2)
    # Little four-point glint outside the principal silhouette.
    d.polygon([(684,42),(696,78),(732,90),(696,102),(684,138),(672,102),(636,90),(672,78)],fill=col)
    im.resize((256,256),Image.Resampling.LANCZOS).save(root/f'{i}.png',optimize=True)
# Transparent shape-only animation. The player never evaluates expressions or loads images.
animation={'v':'5.9.0','fr':30,'ip':0,'op':60,'w':512,'h':512,'nm':'Fixture breathing paw','ddd':0,'assets':[], 'layers':[{'ddd':0,'ind':1,'ty':4,'nm':'Paw','sr':1,'ks':{'o':{'a':0,'k':100},'r':{'a':0,'k':0},'p':{'a':0,'k':[256,256,0]},'a':{'a':0,'k':[0,0,0]},'s':{'a':1,'k':[{'t':0,'s':[90,90,100],'e':[110,110,100],'i':{'x':[.5,.5,.5],'y':[1,1,1]},'o':{'x':[.5,.5,.5],'y':[0,0,0]}},{'t':30,'s':[110,110,100],'e':[90,90,100],'i':{'x':[.5,.5,.5],'y':[1,1,1]},'o':{'x':[.5,.5,.5],'y':[0,0,0]}},{'t':60,'s':[90,90,100]}]}},'shapes':[{'ty':'el','p':{'a':0,'k':[0,0]},'s':{'a':0,'k':[300,300]},'nm':'Pad'},{'ty':'fl','c':{'a':0,'k':[.95,.64,.52,1]},'o':{'a':0,'k':100},'r':1}], 'ip':0,'op':60,'st':0,'bm':0}]}
(root/'animation.json').write_text(json.dumps(animation))
