import { expect, type Page, type TestInfo } from '@playwright/test'
import { areaFixture } from './area-fixture.ts'
import { waitForSync } from './helpers.ts'
import { tapOn, touchDrag, pinch, setCamera } from './touch.ts'
export async function areaTouchFlow(page: Page, info: TestInfo) {
  const f=await areaFixture(page),area=f.element(f.area)
  const toggle=area.getByRole('button',{name:'Collapse area',exact:true})
  const t=(await toggle.boundingBox())!;expect(t.width).toBeGreaterThanOrEqual(44);expect(t.height).toBeGreaterThanOrEqual(44)
  await toggle.tap();await expect(f.element(f.child)).toHaveCount(0)
  await area.getByRole('button',{name:'Expand area',exact:true}).tap()
  await expect(f.element(f.child)).toBeVisible()
  await tapOn(page,area.locator('.area-title'))
  const before=(await f.element(f.col).boundingBox())!, grip=(await area.locator('.area-grip').boundingBox())!
  await touchDrag(page,{x:grip.x+grip.width/2,y:grip.y+grip.height/2},{x:grip.x+grip.width/2+35,y:grip.y+grip.height/2+30},{hold:600})
  await expect.poll(async()=>Math.round((await f.element(f.col).boundingBox())!.x-before.x)).toBe(35)
  await waitForSync(page)
  await setCamera(page,{x:0,y:0,zoom:.6})
  const size=await f.element(f.col).evaluate(el=>(el as HTMLElement).offsetWidth)
  expect(size).toBe(280)
  await pinch(page,{x:190,y:300},1.2)
  expect(await f.element(f.col).evaluate(el=>(el as HTMLElement).offsetWidth)).toBe(size)
  await page.screenshot({path:info.outputPath('canvas-area-touch.png')})
}
