import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url))
const {chromium,expect}=require('@playwright/test')
import {mkdir} from 'node:fs/promises'
const base=process.env.CAPTURE_BASE_URL??'http://localhost:5499'
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw Error('Use a local preview')
const browser=await chromium.launch(),folder=fileURLToPath(new URL('./',import.meta.url))
await mkdir(folder,{recursive:true})
try{
 for(const width of [1440,720,600,360])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'})
  const page=await context.newPage(),api=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url())})
  await page.addInitScript(t=>localStorage.setItem('doggynote.theme',t),theme)
  await page.goto(`${base}/docs/canvas-areas`)
  await expect(page.getByRole('heading',{level:1,name:'Organize a project in an area',exact:true})).toBeVisible()
  await page.evaluate(()=>document.fonts.ready)
  for(const figure of await page.locator('.docs-section figure').all()){
   await figure.scrollIntoViewIfNeeded();await expect.poll(()=>figure.locator('img:visible').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true)
  }
  await page.evaluate(()=>scrollTo(0,0));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  await page.screenshot({path:`${folder}/article-${width}-${theme}.png`})
  if(width===360){await page.locator('#create-and-add').scrollIntoViewIfNeeded();await page.screenshot({path:`${folder}/article-phone-flow-${theme}.png`})}
  if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error(`Overflow ${width} ${theme}`)
  if(api.length)throw Error('Public guide requested private API')
  process.stdout.write(`${width} ${theme}: figures loaded; no horizontal overflow; no API requests\n`)
  await context.close()
 }
}finally{await browser.close()}
