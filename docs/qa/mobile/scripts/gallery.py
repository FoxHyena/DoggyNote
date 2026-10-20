"""Before/after gallery for the mobile QA record.
Run from the repo root: python3 docs/qa/mobile/scripts/gallery.py
Writes output/review/doggynote-mobile.html and docs/qa/mobile/review-matrix.csv."""
import csv, json
from pathlib import Path

root = Path('docs/qa/mobile')
DEVICES = {'se': 'iPhone SE · 375', 'iphone15': 'iPhone 15 Pro · 393', 'pixel7': 'Pixel 7 · 412', 'landscape': 'iPhone landscape · 852×393', 'ipadmini': 'iPad mini · 744'}
ROUNDS = ['r2', 'r3', 'after']

def index(folder):
    out = {}
    for p in sorted((root / folder).glob('*.png')):
        engine, theme, device, state = p.stem.split('-', 3)
        out[(engine, theme, device, state)] = f'../../docs/qa/mobile/{folder}/{p.name}'
    return out

before = index('before')
rounds = {r: index(r) for r in ROUNDS if (root / r).exists()}
final = rounds.get('after') or rounds.get(ROUNDS[-2]) or {}
pairs = []
for key in sorted(set(before) | set(final)):
    engine, theme, device, state = key
    pairs.append(dict(engine=engine, theme=theme, device=device, deviceName=DEVICES.get(device, device), state=state,
                      before=before.get(key), after=final.get(key), rounds={r: m[key] for r, m in rounds.items() if key in m}))

with (root / 'review-matrix.csv').open('w') as f:
    w = csv.writer(f, lineterminator='\n')
    w.writerow(['State', 'Device', 'Engine', 'Appearance', 'Before', *ROUNDS])
    for p in pairs:
        rel = lambda u: (u or '').replace('../../', '')
        w.writerow([p['state'], p['deviceName'], p['engine'], p['theme'], rel(p['before']), *[rel(p['rounds'].get(r)) for r in ROUNDS]])

page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DoggyNote on phones: before and after</title>
<style>
:root{font:14px/1.5 system-ui;color:#312c26;background:#f4f1eb}*{box-sizing:border-box}body{margin:0}header{padding:24px 4vw;background:#fffaf3;border-bottom:1px solid #d6cfc3}h1{font-size:26px;margin:0 0 8px}p{max-width:860px;margin:6px 0;color:#686057}a{color:#845300}main{padding:16px 4vw 48px}.filters{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:#f4f1eb;padding:12px 0}select,button{font:inherit;min-height:40px;border:1px solid #c5bcaf;border-radius:8px;padding:6px 10px;background:#fff;color:inherit}.count{color:#686057;margin:4px 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:18px}.pair{background:#fff;border:1px solid #d6cfc3;border-radius:12px;padding:10px}.pair h3{margin:0 0 8px;font-size:13px}.pair small{color:#686057;font-weight:400}.sides{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sides figure{margin:0}.sides img{width:100%;height:360px;object-fit:contain;background:#e4ded5;border-radius:8px;cursor:zoom-in;display:block}.sides figcaption{font-size:11px;color:#686057;text-align:center;padding-top:2px}.missing{display:grid;place-items:center;height:360px;background:#ece7df;border-radius:8px;color:#8a8177;font-size:12px}dialog{border:0;border-radius:12px;width:96vw;height:95vh;padding:12px;background:#f4f1eb}dialog::backdrop{background:#000c}dialog .row{display:flex;gap:12px;height:calc(100% - 48px)}dialog figure{flex:1;margin:0;display:flex;flex-direction:column;min-width:0}dialog img{flex:1;min-height:0;object-fit:contain;width:100%}dialog .head{display:flex;justify-content:space-between;align-items:center;height:40px}@media(max-width:600px){.grid{grid-template-columns:1fr}.sides img,.missing{height:300px}}
</style>
<header><h1>DoggyNote on phones and touchscreens</h1><p>Before: the desktop layout squeezed onto a phone (left rail, two-row header, a drag that drew selection boxes, tapping a note opened the keyboard). After: a thumb dock with +, bottom sheets, touch gestures, a docked selection bar, editing that rides above the keyboard, and a home-screen app.</p><p><a href="../../docs/qa/mobile/README.md">Findings, rounds and verification</a> · <a href="../../docs/qa/mobile/review-matrix.csv">Every captured state</a></p></header>
<main><div class="filters"><select id="device" aria-label="Device"><option value="">All devices</option>__DEVICES__</select><select id="theme" aria-label="Appearance"><option value="">Both appearances</option><option value="light">Light</option><option value="dark">Dark</option></select><select id="state" aria-label="State"><option value="">All states</option>__STATES__</select><select id="after" aria-label="Compare with"><option value="final">Before vs final</option>__ROUNDS__</select></div><div class="count" id="count" aria-live="polite"></div><div class="grid" id="grid"></div></main>
<dialog id="viewer"><div class="head"><strong id="cap"></strong><button id="close">Close</button></div><div class="row"><figure><img id="b" alt="Before"><figcaption>Before</figcaption></figure><figure><img id="a" alt="After"><figcaption id="acap">After</figcaption></figure></div></dialog>
<script>
const data=__DATA__;const $=id=>document.getElementById(id);let shown=[],at=0
const side=(src,label)=>{const f=document.createElement('figure');if(src){const i=document.createElement('img');i.src=src;i.loading='lazy';i.alt=label;f.append(i)}else{const d=document.createElement('div');d.className='missing';d.textContent='Not captured';f.append(d)}const c=document.createElement('figcaption');c.textContent=label;f.append(c);return f}
const afterOf=p=>$('after').value==='final'?p.after:p.rounds[$('after').value]
function render(){shown=data.filter(p=>['device','theme','state'].every(k=>!$(k).value||p[k]===$(k).value));$('count').textContent=shown.length+' states';$('grid').replaceChildren(...shown.map((p,n)=>{const d=document.createElement('section');d.className='pair';const h=document.createElement('h3');h.textContent=p.state+' ';const s=document.createElement('small');s.textContent=p.deviceName+' · '+p.engine+' · '+p.theme;h.append(s);const sides=document.createElement('div');sides.className='sides';sides.append(side(p.before,'Before'),side(afterOf(p),$('after').value==='final'?'After':$('after').value));sides.onclick=()=>{at=n;show();$('viewer').showModal()};d.append(h,sides);return d}))}
function show(){const p=shown[at];$('cap').textContent=p.state+' · '+p.deviceName+' · '+p.engine+' · '+p.theme;$('b').src=p.before||'';$('a').src=afterOf(p)||''}
for(const k of ['device','theme','state','after'])$(k).addEventListener('input',render);$('close').onclick=()=>$('viewer').close()
$('viewer').addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();at=(at+(e.key==='ArrowRight'?1:-1)+shown.length)%shown.length;show()}});render()
</script></html>'''
opts = lambda pairs_: ''.join(f'<option value="{v}">{t}</option>' for v, t in pairs_)
page = (page.replace('__DATA__', json.dumps(pairs).replace('</', '<\\/'))
        .replace('__DEVICES__', opts(DEVICES.items()))
        .replace('__STATES__', opts((s, s) for s in sorted({p['state'] for p in pairs})))
        .replace('__ROUNDS__', opts((r, f'Before vs {r}') for r in rounds if r != 'after')))
Path('output/review').mkdir(parents=True, exist_ok=True)
Path('output/review/doggynote-mobile.html').write_text(page)
print(f'Gallery: {len(pairs)} states, rounds: {", ".join(rounds)}')
