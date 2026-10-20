import { chromium, webkit } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const out='docs/qa/visual-polish/before-entry', base='http://localhost:5176'
const oldSource=await readFile(new URL('./before-login.css',import.meta.url),'utf8')
const oldStyles=oldSource
await mkdir(out,{recursive:true})
const inventory=[]
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch()
 for(const theme of ['light','dark']) {
  const ctx=await browser.newContext()
  await ctx.addInitScript(theme=>localStorage.setItem('doggynote.theme',theme),theme)
  const page=await ctx.newPage()
  await page.route('**/api/**',async r=>{
   const path=new URL(r.request().url()).pathname
   let data={},status=200
   if(path==='/api/me'){status=401;data={error:'Not signed in'}}
   else if(path.includes('/auth/invite/'))data={expiresAt:Date.now()+86400000}
   else if(path.includes('/auth/recovery/'))data={username:'a_long_username_for_recovery',expiresAt:Date.now()+3600000}
   else if(path.includes('/share/'))data={permission:'edit',boardId:'layout',title:'An editing invitation with a deliberately long board name that must wrap',allowSignup:true,includeChildren:true,expiresAt:Date.now()+86400000}
   else if(path.includes('/version'))data={version:'dev',minClient:'0.0.0'}
   await r.fulfill({status,json:data})
  })
  for(const width of [720,360]) {
   await page.setViewportSize({width,height:480})
   for(const [path,state] of [['/','login'],['/signup/visual-entry','signup'],['/reset/visual-entry','password-reset'],['/join/visual-entry','invitation']]) {
    await page.goto(base+path)
    await page.getByTestId(state==='password-reset'?'reset-form':state==='signup'?'signup-form':'login-form').waitFor()
    if(state==='invitation') await page.locator('.login-invitation').waitFor()
    await page.addStyleTag({content:oldStyles+'\n.login{overflow:visible}.login-card{margin:0}.login-card form{display:block}.login-card input{min-height:0}.login-card .primary-btn{min-height:0}'})
    if(state==='invitation') await page.evaluate(()=>{
      const intro=document.querySelector('.login-invitation'),login=document.querySelector('.login')
      intro.className='board-invite-heading';login.before(intro)
    })
    const file=`${engine}-${theme}-${width}-${state}.png`
    await page.screenshot({path:`${out}/${file}`,animations:'disabled'})
    inventory.push({engine,theme,width,height:480,state,file,reconstruction:'Current entry content with original pre-task CSS restored; invitation introduction returned to its original sibling position.'})
   }
  }
  await ctx.close()
 }
 await browser.close()
}
await writeFile(`${out}/inventory.json`,JSON.stringify(inventory,null,2))
