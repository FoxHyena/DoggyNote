import { chromium, webkit, expect } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const out='docs/qa/visual-polish/touch',base='http://localhost:5176'
await mkdir(out,{recursive:true})
const results=[]
for(const [engine,type] of Object.entries({chromium,webkit})){
 const browser=await type.launch(),context=await browser.newContext({hasTouch:true,extraHTTPHeaders:{'x-doggynote-protocol':'2'}})
 const login=await context.request.post(base+'/api/auth/login',{data:{username:'rex',password:'goodboy123'}})
 if(!login.ok())throw new Error(`Login ${login.status()}`)
 const page=await context.newPage();await page.goto(base);await page.getByTestId('canvas').waitFor()
 for(const theme of ['Light','Dark']){
  await page.getByTestId('account').click();await page.getByRole('radio',{name:theme,exact:true}).click();await page.keyboard.press('Escape')
  for(const width of [1440,1024,720,600,360]){
   await page.setViewportSize({width,height:480})
   const boxes=[]
   for(const id of ['board-navigation','board-name','sync-status','open-fetch','toybox-button','share','board-more','account','zoom','snap-toggle']){
    const box=await page.getByTestId(id).boundingBox();if(!box)throw new Error(id+' missing')
    expect(box.width,`${id} width at${width}`).toBeGreaterThanOrEqual(44);expect(box.height,`${id} height at${width}`).toBeGreaterThanOrEqual(44)
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1)
    if(!['zoom','snap-toggle'].includes(id))boxes.push({id,...box})
   }
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j]
    expect(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,`${a.id}/${b.id} don't collide at${width}`).toBe(true)
   }
   await page.mouse.move(width-1,479)
   const file=`${engine}-${theme.toLowerCase()}-${width}-touch-header.png`
   await page.screenshot({path:`${out}/${file}`,animations:'disabled'})
   results.push({engine,theme,width,height:480,state:'coarse pointer targets >=44px; header controls contained and separate',result:'passed',file})
  }
 }
 await context.close();await browser.close()
}
await writeFile(`${out}/verification.json`,JSON.stringify(results,null,2));console.log(`${results.length} touch layouts passed`)
