import csv, html, json, re
from pathlib import Path

root=Path('docs/qa/visual-polish')
items=[]
approved_review={'RV04-after-recovery-actions-clear.png'}
for name in ['independent-inventory.json','independent-inventory-narrow.json','supplemental-inventory.json']:
    p=root/'review'/name
    if p.exists(): approved_review.update(i['file'] for i in json.loads(p.read_text()))
for path in sorted(root.rglob('*')):
    if path.suffix not in ['.png','.jpg']: continue
    if 'contact' in path.name or path.name.startswith('gallery-'): continue
    relative=str(path.relative_to(root))
    engine='WebKit' if 'webkit' in relative else 'Chromium' if 'chromium' in relative else 'Native'
    theme='Dark' if 'dark' in relative else 'Light' if 'light' in relative else 'Both'
    match=re.search(r'(?:-|/)(1440|1024|720|600|360)(?:[.-]|$)',relative)
    width=match[1] if match else 'Other'
    phase='Before' if relative.startswith('before') or 'recreated-before' in relative else 'After'
    if relative.startswith('review/') and phase=='After' and path.name not in approved_review: phase='Earlier review'
    title=path.stem.replace('-',' ').replace('_',' ')
    items.append(dict(title=title,engine=engine,theme=theme,width=width,phase=phase,path=relative,url='../../docs/qa/visual-polish/'+relative))
with (root/'review-matrix.csv').open('w') as f:
    writer=csv.writer(f,lineterminator="\n")
    writer.writerow(['Surface state','Engine','Appearance','Width','Phase','Review result','Evidence'])
    for i in items:
        result='Approved final visual review'
        if i['phase']=='Before': result='Baseline reference; see README for reconstruction provenance'
        elif i['phase']=='Earlier review': result='First visual round; superseded by integrated/supplemental captures'
        writer.writerow([i['title'],i['engine'],i['theme'],i['width'],i['phase'],result,i['path']])

page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DoggyNote visual polish review</title>
<style>
:root{font:14px/1.5 system-ui;color:#312c26;background:#f4f1eb}*{box-sizing:border-box}body{margin:0}header{padding:24px 4vw;background:#fffaf3;border-bottom:1px solid #d6cfc3}h1{font-size:26px;margin:0 0 8px}p{max-width:850px;margin:6px 0;color:#686057}a{color:#845300}main{padding:24px 4vw}h2{font-size:18px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.comparison img{width:100%;border:1px solid #d6cfc3;border-radius:10px}figure{margin:0}figcaption{padding:6px 0;color:#686057}.filters{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:#f4f1eb;padding:12px 0}input,select,button{font:inherit;min-height:40px;border:1px solid #c5bcaf;border-radius:7px;padding:8px;background:#fff;color:inherit}input{flex:1;min-width:180px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}.tile{padding:0;text-align:left;overflow:hidden;background:#fff;border:1px solid #d6cfc3;border-radius:10px;cursor:zoom-in}.tile img{width:100%;height:230px;object-fit:contain;background:#e4ded5;display:block}.tile span{display:block;padding:10px;font-size:12px;overflow-wrap:anywhere}.tile small{display:block;color:#686057;margin-top:4px}dialog{border:1px solid #777;border-radius:12px;width:96vw;height:95vh;padding:16px;background:#f4f1eb}dialog::backdrop{background:#000b}.viewer-head{display:flex;justify-content:space-between;gap:16px;align-items:center}dialog img{display:block;max-width:100%;max-height:calc(95vh - 100px);margin:12px auto;object-fit:contain}.count{padding:8px 0;color:#686057}:focus-visible{outline:3px solid #9d6700;outline-offset:3px}@media(max-width:600px){.comparison{grid-template-columns:1fr}main{padding:16px}.filters{position:static}.tile img{height:200px}}
</style>
<header><h1>DoggyNote visual polish</h1><p>Boards labels now sit beside their icons, supporting text follows the same inset, and long content scrolls within clear, stable surfaces. The existing theme, icons and navigation are preserved.</p><p><a href="../../docs/qa/visual-polish/README.md">Findings, verification and review notes</a> · <a href="../../docs/qa/visual-polish/review-matrix.csv">Every captured state</a></p></header>
<main><h2>Boards, before and after</h2><div class="comparison"><figure><img src="../../docs/qa/visual-polish/before/webkit-light-720-boards.png" alt="Boards before polish: labels pushed to the right"><figcaption>Before · preserved previous native build in WebKit · 720 × 480</figcaption></figure><figure><img src="../../docs/qa/visual-polish/after/webkit-light-720-boards.png" alt="Boards after polish with aligned labels and supporting text"><figcaption>After · integrated web build · 720 × 480</figcaption></figure></div><h2>Review gallery</h2><p>Filter by state, browser, appearance or width. Open an image to inspect it; use ← / → to compare adjacent results and Escape to close. Before images come from the preserved previous build unless their finding note states a recreated CSS reproduction.</p><div class="filters"><input id="search" type="search" placeholder="Find a surface or state" aria-label="Find a surface or state"><select id="phase" aria-label="Review phase"><option value="">All phases</option><option>Before</option><option>After</option><option>Earlier review</option></select><select id="engine" aria-label="Platform"><option value="">All platforms</option><option>Chromium</option><option>WebKit</option><option>Native</option></select><select id="theme" aria-label="Appearance"><option value="">All appearances</option><option>Light</option><option>Dark</option></select><select id="width" aria-label="Width"><option value="">All widths</option><option>1440</option><option>1024</option><option>720</option><option>600</option><option>360</option></select></div><div class="count" id="count" aria-live="polite"></div><div class="grid" id="grid"></div></main>
<dialog id="viewer"><div class="viewer-head"><span id="caption"></span><button id="close">Close</button></div><img id="large" alt=""></dialog><script>
const data=__DATA__;let shown=[],index=0;const $=id=>document.getElementById(id);function render(){const query=$('search').value.toLowerCase();shown=data.filter(i=>(!query||(i.title+' '+i.path).toLowerCase().includes(query))&&['phase','engine','theme','width'].every(k=>!$(k).value||i[k]===$(k).value));$('count').textContent=shown.length+' captured states';$('grid').replaceChildren(...shown.map((i,n)=>{const b=document.createElement('button');b.className='tile';const img=document.createElement('img');img.src=i.url;img.alt=i.title;img.loading='lazy';const text=document.createElement('span');text.textContent=i.title;const small=document.createElement('small');small.textContent=[i.phase,i.engine,i.theme,i.width+'px'].join(' · ');text.append(small);b.append(img,text);b.onclick=()=>{index=n;show();$('viewer').showModal()};return b}))}function show(){const i=shown[index];$('large').src=i.url;$('large').alt=i.title;$('caption').textContent=i.title+' · '+i.engine+' · '+i.theme+' · '+i.phase}for(const k of ['search','phase','engine','theme','width'])$(k).addEventListener('input',render);$('close').onclick=()=>$('viewer').close();$('viewer').addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();index=(index+(e.key==='ArrowRight'?1:-1)+shown.length)%shown.length;show()}});render();
</script></html>'''
page=page.replace('__DATA__',json.dumps(items).replace('</','<\\/'))
Path('output/review/doggynote-visual-polish.html').write_text(page)
print(f'Gallery and matrix: {len(items)} captured states')
