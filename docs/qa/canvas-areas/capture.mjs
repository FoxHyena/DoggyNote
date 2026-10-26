import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
import { mkdir } from 'node:fs/promises'
const base=process.env.CAPTURE_BASE_URL ?? 'http://localhost:5499'
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw Error('Use an isolated local fixture server')
const browser=await chromium.launch()
const context=await browser.newContext({baseURL:base,viewport:{width:1440,height:900},extraHTTPHeaders:{'x-doggynote-protocol':'4'}})
const directory=fileURLToPath(new URL('../../../apps/web/public/docs/assets/canvas-areas', import.meta.url))
await mkdir(directory,{recursive:true})
try {
 const login=await context.request.post('/api/auth/login',{data:{username:'rex',password:'goodboy123'}})
 if(!login.ok())throw Error('Local fixture login failed')
 const page=await context.newPage(),board=crypto.randomUUID(),prefix=crypto.randomUUID().slice(0,8),id=s=>`${prefix}-${s}`
 const area=id('area'),col=id('col'),ready=id('ready'),note=id('note'),child=id('child'),out=id('out')
 const baseCard={kind:'card',boardId:board,x:0,y:0,w:260,h:100,z:1,color:'none',createdAt:Date.now(),columnId:null,areaId:null}
 const objects=[
  {id:board,kind:'board',parentId:'home',title:'Project planning',icon:'paw',color:'gold',createdAt:Date.now()},
  {...baseCard,id:area,type:'area',x:40,y:40,w:900,h:500,color:'sky',content:{title:'Tracking Collars'}},
  {...baseCard,id:col,type:'column',areaId:area,x:24,y:80,w:280,h:200,color:'gold',content:{title:'Doing'}},
  {...baseCard,id:child,type:'todo',columnId:col,order:1,content:{title:'Build the sensor prototype',items:[]}},
  {...baseCard,id:note,type:'note',areaId:area,x:24,y:300,content:{md:'Test the collar fit before ordering parts.'}},
  {...baseCard,id:ready,type:'column',areaId:area,x:650,y:80,w:220,h:160,color:'ball',content:{title:'Ready'}},
  {...baseCard,id:out,type:'todo',x:1050,y:150,content:{title:'Launch checklist',items:[]}},
  {id:id('internal'),kind:'connection',boardId:board,createdAt:Date.now(),from:col,to:ready,arrow:'end'},
  {id:id('external'),kind:'connection',boardId:board,createdAt:Date.now(),from:child,to:out,arrow:'end'},
 ]
 const response=await context.request.post('/api/sync',{data:{changes:objects.map(o=>({id:o.id,patch:o}))}})
 if(!response.ok())throw Error(await response.text())
 await page.goto(`/#/b/${board}`)
 await page.locator('[data-testid=canvas]').waitFor()
 await page.evaluate(id=>localStorage.setItem(`doggynote.cam.${id}`,JSON.stringify({x:0,y:0,zoom:1})),board)
 const frame=page.locator(`[data-card-id="${area}"]`)
 for(const theme of ['light','dark']) {
  await page.evaluate(t=>localStorage.setItem('doggynote.theme',t),theme);await page.reload();await frame.waitFor()
  await page.waitForFunction(()=>{const e=document.querySelector('[data-testid=sync-status]');return e?.getAttribute('data-sync-state')==='idle'&&e?.getAttribute('data-pending')==='0'})
  await page.evaluate(()=>document.fonts.ready)
  const c=await page.locator('[data-testid=canvas]').boundingBox(),clip={x:c.x+12,y:c.y+12,width:1320,height:600},suffix=theme==='dark'?'-dark':''
  await page.screenshot({path:`${directory}/planning-area${suffix}.png`,clip})
  await frame.getByTestId('area-add').click()
  await page.getByTestId('area-add-menu').waitFor()
  await page.screenshot({path:`${directory}/add-context${suffix}.png`,clip})
  await page.keyboard.press('Escape')
  await frame.getByRole('button',{name:'Collapse area',exact:true}).click()
  await page.screenshot({path:`${directory}/collapsed-area${suffix}.png`,clip:{...clip,height:320}})
  await frame.getByRole('button',{name:'Expand area',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[data-testid=sync-status]')?.getAttribute('data-pending')==='0')
 }
 process.stdout.write(JSON.stringify({board,revision:'7a0ceaec2a401c3319a8e42a5e279fa30ffed27d',directory,width:1320,heights:[600,320]})+'\n')
}finally{await context.close();await browser.close()}
