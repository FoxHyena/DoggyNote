import { chromium } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { writeFile } from 'node:fs/promises'
const base='http://localhost:5176',api='http://localhost:8791',out='docs/qa/visual-polish/review'
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:360,height:480}})
try{
 const login=await context.request.post(`${base}/api/auth/login`,{data:{username:'rex',password:'goodboy123',bearer:true}});const {token}=await login.json();const headers={authorization:`Bearer ${token}`,'x-doggynote-protocol':'2'}
 await context.route('http://localhost:8787/api/**',async route=>{const response=await context.request.fetch(route.request().url().replace(':8787/',':8791/'),{method:route.request().method(),headers:{...route.request().headers(),...headers},postData:route.request().postData()??undefined});await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':base}})})
 const id=crypto.randomUUID(),board={id,kind:'board',parentId:'home',title:'Recovery and update overlap review',icon:'paw',color:'none',createdAt:Date.now()}
 const seed=await context.request.post(`${api}/api/sync`,{headers,data:{changes:[{id,patch:board}]}});if(!seed.ok())throw new Error('fixture seed failed')
 const page=await context.newPage();await page.route('**/api/version',r=>r.fulfill({json:{version:'0.1.42',minClient:'0.0.0'}}));await page.goto(`${base}/#/b/${id}`);await page.getByTestId('canvas').waitFor()
 await page.getByTestId('account').click();await page.getByRole('radio',{name:'Light',exact:true}).click();await page.keyboard.press('Escape')
 await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('doggynote');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const tx=request.result.transaction('meta','readwrite');tx.objectStore('meta').put({id:'review-recovery',patch:{content:{md:'Preserved local edits'}},reason:'Board access changed',savedAt:Date.now()},'recovery:review-recovery');tx.oncomplete=()=>{request.result.close();resolve()};tx.onerror=()=>reject(tx.error)}}))
 await page.reload();await page.getByTestId('update-toast').waitFor({timeout:10000});await page.getByTestId('sync-status').click();await page.getByRole('button',{name:'Download unsynced changes'}).waitFor()
 const sheet=await page.addStyleTag({content:'.update-toast { display: flex !important; }'})
 await page.screenshot({path:`${out}/RV04-recreated-before-optional-toast-visible.png`,animations:'disabled'})
 await sheet.evaluate(el=>el.remove())
 await page.screenshot({path:`${out}/RV04-after-recovery-actions-clear.png`,animations:'disabled'})
 const download=page.getByRole('button',{name:'Download unsynced changes'})
 const actionable=await download.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})
 const hidden=await page.getByTestId('update-toast').isHidden();await page.keyboard.press('Escape');const returned=await page.getByTestId('update-toast').isVisible()
 await writeFile(`${out}/RV04-recreated-evidence.json`,JSON.stringify({width:360,height:480,theme:'light',engine:'chromium',before:'Recreated comparison on final build: temporary CSS forced optional update display:flex!important during recovery details. This is not the original first failing screenshot.',after:'Removed temporary style; final app CSS hides optional notification while recovery details are open.',downloadActionable:actionable,toastHiddenInDetails:hidden,toastReturnedAfterEscape:returned},null,2))
 if(!actionable||!hidden||!returned)throw new Error('Recovery/update interaction did not pass')
 console.log('Recreated comparison captured; final recovery download actionable, optional toast hidden during details and restored after Escape')
}finally{await context.close();await browser.close()}
