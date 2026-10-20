import { chromium, webkit } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const base='http://localhost:5177',api='http://localhost:8791'
const out='docs/qa/visual-polish/before-populated';await mkdir(out,{recursive:true})
const inventory=[]
for(const [engine,browserType] of Object.entries({chromium,webkit})) {
 const browser=await browserType.launch()
 for(const [width,touch] of (process.argv.includes('--narrow') ? [[360,true]] : [[720,false],[360,true]])) {
  const context=await browser.newContext({viewport:{width,height:480},hasTouch:touch})
  const login=await context.request.post(`${base}/api/auth/login`,{data:{username:'rex',password:'goodboy123',bearer:true}})
  if(!login.ok())throw new Error(`login ${login.status()}`)
  const {token,user}=await login.json();const headers={authorization:`Bearer ${token}`,'x-doggynote-protocol':'2'}
  await context.route('http://localhost:8787/api/**',async route=>{
   const response=await context.request.fetch(route.request().url().replace(':8787/',':8791/'),{method:route.request().method(),headers:{...route.request().headers(),...headers},postData:route.request().postData()??undefined});await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':base}})
  })
  const boardId=crypto.randomUUID(), nestedId=crypto.randomUUID(), imageId=crypto.randomUUID(),fileId=crypto.randomUUID(), now=Date.now()
  const card=(type,content,x,y=0,w=250)=>({id:crypto.randomUUID(),kind:'card',type,boardId,x,y,w,h:type==='image'?190:120,z:1,color:'none',content,createdAt:now})
  const cards=[
   card('note',{md:'# Weekend plans\nBring the **blue leash**, fresh water, and a comfortable blanket.\n- Walk by the river\n- Lunch in the shade'},0),
   card('todo',{title:'Before the next adventure',items:[{id:'a',text:'Pack water and snacks',done:true},{id:'b',text:'Call the dog-friendly café for a table',done:false},{id:'c',text:'Check the trail map',done:false}]},350),
   card('link',{url:'https://example.com/trails',title:'A guide to dog-friendly trails near home',description:'Short walks, shaded picnic spots, and places to stop for water.',siteName:'Trail guide',status:'ok'},700),
   card('image',{assetId:imageId,width:128,height:128,caption:'Our adventure companion',sizes:['thumb','small','medium','full']},1050,0,220),
   card('file',{assetId:fileId,name:'Weekend-adventure-planning-checklist-with-a-long-name.txt',size:224,mime:'text/plain',status:'ok'},1400),
   card('board',{boardId:nestedId},1750,0,180),
   card('column',{title:'Ready for the weekend'},2100,0,270),
  ]
  const columnId=cards.at(-1).id
  cards.push({...card('note',{md:'Confirm the café booking and share the meeting point.'},2100),columnId,order:0,w:246})
  const bytes=await readFile('apps/desktop/src-tauri/icons/128x128.png')
  for(const size of ['thumb','small','medium','full']){const r=await context.request.put(`${api}/api/assets/${imageId}/${size}`,{headers:{...headers,'content-type':'image/png'},data:bytes});if(!r.ok())throw new Error(`image ${r.status()}`)}
  await context.request.put(`${api}/api/files/${fileId}?name=checklist.txt`,{headers:{...headers,'content-type':'text/plain'},data:Buffer.from('Pack water, snacks, and a leash.')})
  const objs=[{id:boardId,kind:'board',parentId:'home',title:'Independent visual review — weekend plans',icon:'paw',color:'none',createdAt:now},{id:nestedId,kind:'board',parentId:boardId,title:'Long-name weekend adventure board',icon:'bone',color:'gold',createdAt:now},...cards]
  let seeded=await context.request.post(`${api}/api/sync`,{headers,data:{changes:objs.map(o=>({id:o.id,patch:o}))}})
  if(!seeded.ok())throw new Error(`seed ${seeded.status()} ${await seeded.text()}`)
  const page=await context.newPage();await page.goto(base);await page.getByTestId('canvas').waitFor()
  const capture=async(name)=>{await page.mouse.move(width-1,479);const file=`${engine}-${width}-${name}.png`;await page.screenshot({path:`${out}/${file}`,animations:'disabled'});inventory.push({engine,width,touch,file,theme:await page.locator('html').getAttribute('data-theme')})}
  for(const theme of ['Light','Dark']) {
   await page.getByTestId('account').click();await page.getByRole('radio',{name:theme,exact:true}).click();await page.keyboard.press('Escape')
   for(const c of cards.slice(0,7)) {
    await page.evaluate(({boardId,c,width})=>{localStorage.setItem(`doggynote.cam.${boardId}`,JSON.stringify({x:c.x-16,y:-80,zoom:1}));location.hash=`#/b/${boardId}`},{boardId,c,width})
    await page.reload();await page.getByTestId('canvas').waitFor();await page.evaluate(w=>document.documentElement.classList.toggle('tauri',w===720),width)
    const target=page.locator(`[data-card-id="${c.id}"]`).first();await target.waitFor();await capture(`${theme.toLowerCase()}-card-${c.type}`)
    if(c.type==='note'){
     const box=await target.boundingBox();await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+24,box.y+12,{steps:4});await page.mouse.up();await page.getByTestId('selection-bar').waitFor();await capture(`${theme.toLowerCase()}-selection`)
     await page.getByTestId('comment-button').scrollIntoViewIfNeeded();await page.getByTestId('comment-button').click();await page.getByTestId('comment-input').fill('The trail looks good. Meet by the entrance at 10:30?');await page.getByTestId('comment-send').click();await capture(`${theme.toLowerCase()}-comments`);await page.getByTestId('comment-edit').first().click();await capture(`${theme.toLowerCase()}-comment-editing`);await page.getByTestId('comment-save').click({force:true});await page.getByTestId('comment-delete').first().click();await page.getByTestId('toast').waitFor();await capture(`${theme.toLowerCase()}-notification`);await page.getByTestId('toast').click();await page.getByTestId('comments-close').click();await page.keyboard.press('Escape');await target.dblclick({position:{x:30,y:30}});await page.getByTestId('note-editor').waitFor();await capture(`${theme.toLowerCase()}-note-editing`);await page.keyboard.press('Escape')
    }
   }
  }
  await context.close()
 }
 await browser.close()
}
await writeFile(`${out}/${process.argv.includes('--narrow') ? 'independent-inventory-narrow.json' : 'independent-inventory.json'}`,JSON.stringify(inventory,null,2));console.log(`Captured ${inventory.length} independent populated states`)
