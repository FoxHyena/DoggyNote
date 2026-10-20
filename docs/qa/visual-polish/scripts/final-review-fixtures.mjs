import { chromium, webkit } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const base='http://localhost:5176', api='http://localhost:8791', out='docs/qa/visual-polish/review'
await mkdir(out,{recursive:true})
const inventory=[]
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch();const context=await browser.newContext({viewport:{width:1440,height:480}})
 const login=await context.request.post(`${base}/api/auth/login`,{data:{username:'rex',password:'goodboy123',bearer:true}});const {token}=await login.json();const headers={authorization:`Bearer ${token}`,'x-doggynote-protocol':'2'}
 await context.route('http://localhost:8787/api/**',async route=>{const response=await context.request.fetch(route.request().url().replace(':8787/',':8791/'),{method:route.request().method(),headers:{...route.request().headers(),...headers},postData:route.request().postData()??undefined});await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':base}})})
 const id=crypto.randomUUID(),now=Date.now(),board={id,kind:'board',parentId:'home',title:'Narrow populated proposal review',icon:'paw',color:'none',createdAt:now}
 const seeded=await context.request.post(`${api}/api/sync`,{headers,data:{changes:[{id,patch:board}]}});if(!seeded.ok())throw new Error('fixture seed failed')
 const previewBoard={...board,id:'visual-preview-board',parentId:null,title:'Weekend plans'}
 const note={id:'preview-note',kind:'card',type:'note',boardId:previewBoard.id,x:20,y:20,w:250,h:100,z:1,color:'gold',content:{md:'# Meet by the river\nBring **water**, snacks, and the blue leash.'},createdAt:now}
 const todo={...note,id:'preview-todo',type:'todo',x:300,content:{title:'Before we go',items:[{id:'task',text:'Confirm the meeting point',done:false}]}}
 const page=await context.newPage()
 await page.route('**/api/agent-proposals?*',r=>r.fulfill({json:{proposals:[{id:'visual-preview',label:'Organize the weekend adventure',status:'pending',count:2,createdAt:now}]}}))
 await page.route('**/api/agent-proposals/visual-preview',r=>r.fulfill({json:{proposal:{id:'visual-preview',label:'Organize the weekend adventure',status:'pending',changes:[note,todo].map(after=>({before:null,after}))},before:[previewBoard],after:[previewBoard,note,todo]}}))
 await page.route('**/api/admin/invites',r=>r.fulfill({json:{invitations:[{id:'pending',createdAt:now,expiresAt:now+86400000},{id:'accepted',createdAt:now,expiresAt:now+86400000,usedAt:now,acceptedBy:'a_long_username_that_accepted'},{id:'expired',createdAt:now-86400000,expiresAt:now-1000},{id:'revoked',createdAt:now,expiresAt:now+86400000,revokedAt:now}]}}))
 let errorMode=false
 await page.route('**/api/agent-connections',r=>errorMode?r.fulfill({status:503,json:{error:'Could not load this review fixture'}}):r.fulfill({json:{connections:Array.from({length:12},(_,i)=>({id:`review-connection-${i}`,name:`A-long-unbroken-agent-connection-name-for-independent-layout-review-${i}`,mode:'propose',boardIds:[id],expiresAt:now+86400000,revokedAt:null,lastUsedAt:null}))}}))
 await page.goto(`${base}/#/b/${id}`);await page.getByTestId('canvas').waitFor()
 for(const theme of ['Light','Dark']){
  await page.getByTestId('account').click();await page.getByRole('radio',{name:theme,exact:true}).click();await page.keyboard.press('Escape')
  for(const width of [1440,1024,720,600,360]){
   await page.setViewportSize({width,height:480});await page.getByTestId('board-more').click();await page.getByTestId('agent-proposals').click();await page.locator('.agents-proposal-choice').click()
   const preview=page.getByTestId('agent-board-preview');await preview.waitFor();await preview.scrollIntoViewIfNeeded()
   let file=`${engine}-${theme.toLowerCase()}-${width}-populated-proposal-preview.png`;await page.screenshot({path:`${out}/${file}`,animations:'disabled'});inventory.push({engine,theme,width,surface:'populated-preview',file})
   await page.keyboard.press('Escape');await page.getByTestId('account').click();await page.getByTestId('manage-people').click();await page.getByRole('tab',{name:'Invitations',exact:true}).click()
   await page.getByTestId('account-invitation').last().scrollIntoViewIfNeeded()
   file=`${engine}-${theme.toLowerCase()}-${width}-invitation-statuses.png`;await page.screenshot({path:`${out}/${file}`,animations:'disabled'});inventory.push({engine,theme,width,surface:'invitation-statuses',file})
   await page.keyboard.press('Escape')
   errorMode=false;await page.getByTestId('account').click();await page.getByTestId('manage-agents').click();await page.locator('.agents-connection').last().scrollIntoViewIfNeeded();file=`${engine}-${theme.toLowerCase()}-${width}-agent-sticky-header-fixed.png`;await page.screenshot({path:`${out}/${file}`,animations:'disabled'});inventory.push({engine,theme,width,surface:'agent-sticky-header-fixed',file});await page.keyboard.press('Escape');errorMode=true
   await page.getByTestId('account').click();await page.getByTestId('manage-agents').click();await page.getByTestId('agent-connections').getByRole('alert').waitFor()
   file=`${engine}-${theme.toLowerCase()}-${width}-agent-error-fixed.png`;await page.screenshot({path:`${out}/${file}`,animations:'disabled'});inventory.push({engine,theme,width,surface:'error-contrast-fixed',file,colors:await page.getByTestId('agent-connections').getByRole('alert').evaluate(el=>({foreground:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}))})
   await page.keyboard.press('Escape')
  }
 }
 await context.close();await browser.close()
}
await writeFile(`${out}/supplemental-inventory.json`,JSON.stringify(inventory,null,2));console.log(`Captured ${inventory.length} final populated preview/status states`)
