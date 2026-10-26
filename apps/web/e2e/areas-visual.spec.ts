import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { devices, expect, test } from '@playwright/test'
import { areaFixture } from './area-fixture.ts'
import { setCamera } from './touch.ts'
import { waitForSync } from './helpers.ts'

test('canvas-area visual review captures light/dark, collapsed, menus, phone and tablet',async({page,browser,browserName})=>{
  test.skip(browserName!=='chromium','One deterministic visual packet; behaviors run in both engines')
  await page.setViewportSize({width:1440,height:900})
  const f=await areaFixture(page),area=f.element(f.area)
  const directory=resolve('.impeccable/review');mkdirSync(directory,{recursive:true})
  const shot=async(name:string)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(directory,`canvas-areas-${name}.png`),fullPage:true})}
  await waitForSync(page)
  await shot('desktop-dark')
  await page.evaluate(()=>localStorage.setItem('doggynote.theme','light'));await page.reload();await expect(area).toBeVisible();await waitForSync(page)
  await shot('desktop-light')
  await area.getByRole('button',{name:'Collapse area',exact:true}).click();await shot('collapsed-light')
  await area.getByRole('button',{name:'Expand area',exact:true}).click()
  await area.getByTestId('area-add').click();await shot('add-menu-light');await page.keyboard.press('Escape')
  for(const [name,device] of [['phone','iPhone 15 Pro'],['tablet','iPad Pro 11']] as const){
    const context=await browser.newContext({...devices[device],storageState:'e2e/.auth/rex.json',extraHTTPHeaders:{'x-doggynote-protocol':'4'}})
    try{
      const p=await context.newPage();await p.goto(`/#/b/${f.board}`)
      await expect(p.getByTestId('canvas')).toBeVisible()
      await setCamera(p,{x:0,y:0,zoom:name==='phone'?.75:1})
      for(const theme of ['dark','light']){
        await p.evaluate(theme=>localStorage.setItem('doggynote.theme',theme),theme);await p.reload();await waitForSync(p)
        await p.screenshot({path:resolve(directory,`canvas-areas-${name}-${theme}.png`),fullPage:true})
      }
    }finally{await context.close()}
  }
})
