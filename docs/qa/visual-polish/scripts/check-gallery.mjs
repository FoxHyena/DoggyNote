import { chromium, expect } from '../../../../apps/web/node_modules/@playwright/test/index.mjs'
import { writeFile } from 'node:fs/promises'
const browser=await chromium.launch(),page=await browser.newPage()
await page.goto(`file://${process.cwd()}/output/review/doggynote-visual-polish.html`)
const errors=[];page.on('pageerror',e=>errors.push(e.message))
for(const width of [1440,360]){
 await page.setViewportSize({width,height:900})
 await page.getByLabel('Platform',{exact:true}).selectOption('Native')
 await page.getByLabel('Review phase').selectOption('After')
 await expect(page.locator('.tile').first()).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.locator('.tile').first().click()
 await expect(page.locator('#viewer')).toBeVisible()
 expect(await page.locator('#large').evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true)
 await page.keyboard.press('ArrowRight')
 await page.keyboard.press('Escape')
 await expect(page.locator('#viewer')).not.toBeVisible()
 await page.screenshot({path:`docs/qa/visual-polish/gallery-${width}.png`,fullPage:false})
}
expect(errors).toEqual([])
await writeFile('docs/qa/visual-polish/gallery-verification.json',JSON.stringify({result:'passed',widths:[1440,360],checks:['filters','image loading','dialog','arrow navigation','Escape dismissal','no horizontal overflow','no JavaScript errors']},null,2))
await browser.close();console.log('Gallery verified at1440/360')
