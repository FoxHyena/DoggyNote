import { chromium, webkit } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir } from 'node:fs/promises'
const base='http://localhost:5177',out='docs/qa/visual-polish/before-extra'
await mkdir(out,{recursive:true})
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(),ctx=await browser.newContext({viewport:{width:360,height:480}})
 const login=await ctx.request.post('http://localhost:8791/api/auth/login',{data:{username:'rex',password:'goodboy123',bearer:true}}),{token}=await login.json()
 await ctx.route('http://localhost:8787/api/**',async r=>{
  const response=await ctx.request.fetch(r.request().url().replace(':8787/',':8791/'),{method:r.request().method(),headers:{...r.request().headers(),authorization:`Bearer ${token}`,'x-doggynote-protocol':'2'},postData:r.request().postData()??undefined})
  await r.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':base}})
 })
 const page=await ctx.newPage()
 for(const theme of ['Light','Dark']){
  await page.setViewportSize({width:360,height:480});await page.goto(base);await page.reload();await page.getByTestId('canvas').waitFor()
  await page.getByTestId('account').click();await page.getByRole('radio',{name:theme,exact:true}).click();await page.keyboard.press('Escape')
  await page.getByTestId('open-fetch').click();await page.getByTestId('fetch-input').fill('Weekend');await page.getByTestId('fetch-hit').first().waitFor()
  await page.screenshot({path:`${out}/${engine}-${theme.toLowerCase()}-360-fetch.png`,animations:'disabled'})
  await page.setViewportSize({width:360,height:200});await page.goto(base+'/#/capture');await page.reload();await page.getByTestId('capture-input').waitFor();await page.getByTestId('capture-input').fill('A quick thought with room for a readable status')
  await page.screenshot({path:`${out}/${engine}-${theme.toLowerCase()}-360-capture.png`,animations:'disabled'})
 }
 await ctx.close();await browser.close()
}
