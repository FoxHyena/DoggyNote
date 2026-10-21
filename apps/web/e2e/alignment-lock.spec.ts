import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { MOD, dragBy, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

const boardOf = (page: Page) => page.url().split('#/b/')[1]!
const card = (page: Page, id: string) => page.locator(`[data-card-id="${id}"]`)
async function geometry(page: Page, ids: string[]) {
  return Promise.all(ids.map((id) => card(page, id).evaluate((el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight }))))
}
async function seed(page: Page, images = false) {
  await freshBoard(page, 'Alignment QA — isolated references')
  const boardId = boardOf(page), ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  let assetId = ''
  if (images) {
    const png = await readFile(new URL('../../desktop/src-tauri/icons/128x128.png',import.meta.url))
    assetId = crypto.randomUUID()
    for (const size of ['thumb','small','medium','full']) expect((await page.request.put(`/api/assets/${assetId}/${size}`, { data: png, headers: { 'content-type': 'image/png' } })).ok()).toBe(true)
  }
  const objects = ids.map((id, i) => ({ id,kind:'card',type:images?'image':'note',boardId,x:80+i*270,y:100+[60,0,130][i]!,w:[180,220,160][i]!,h:100,z:i+1,color:['sky','gold','lilac'][i],content:images?{assetId,width:128,height:128,sizes:['thumb','small','medium','full']}:{md:`Reference ${i+1}\n\nLong reference text with **clear emphasis**, layout and content remain independent.`},createdAt:Date.now() }))
  const response = await postSync(page.request, { data: { changes: objects.map((o) => ({id:o.id,patch:o})) } })
  expect(response.ok(), await response.text()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.keyboard.press(`${MOD}+1`)
  for (const id of ids) await expect(card(page,id)).toBeVisible()
  await waitForSync(page)
  return ids
}
// Mouse notes open their editor on click in the existing product. Shift-click
// is the selection gesture, including a single-card layout selection.
async function selectOnly(page: Page, id: string) {
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await expect(page.locator('.card.selected')).toHaveCount(0)
  const target=await card(page,id).getAttribute('data-type')==='column' ? card(page,id).locator('.column-head') : card(page,id)
  await target.click({modifiers:['Shift']})
  await expect(card(page,id)).toHaveClass(/selected/)
}
async function selectAll(page: Page) { await page.keyboard.press(`${MOD}+a`); await expect(page.getByTestId('selection-bar')).toBeVisible() }

test('one Escape clears Select All from the restored board-control focus after closing its menu', async ({ page }) => {
  const ids = await seed(page, true)
  const before = await geometry(page, ids)
  const more = page.getByTestId('board-more')
  const menu = page.getByTestId('board-actions-menu')
  const selected = page.locator('.card.selected')
  await more.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  // Closing the real menu restores button focus; never force it for this test.
  await expect(more).toBeFocused()
  await page.keyboard.press(`${MOD}+a`)
  await expect(selected).toHaveCount(ids.length)
  await expect(more).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(selected).toHaveCount(0)
  await expect(more).toBeFocused()
  expect(await geometry(page, ids)).toEqual(before)

  // With a menu open, its first Escape closes only the menu, preserving selection.
  await page.keyboard.press(`${MOD}+a`)
  await expect(selected).toHaveCount(ids.length)
  await more.click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(more).toBeFocused()
  await expect(selected).toHaveCount(ids.length)
  await page.keyboard.press('Escape')
  await expect(selected).toHaveCount(0)
})

for (const zoom of ['64%','100%','125%']) test(`six alignments and exact single Undo at ${zoom}`, async ({ page }) => {
  const ids = await seed(page, true)
  await page.keyboard.press(`${MOD}+0`)
  await expect(page.getByTestId('zoom')).toHaveText('100%')
  if (zoom === '64%') { await page.keyboard.press(`${MOD}+-`); await expect(page.getByTestId('zoom')).toHaveText('80%'); await page.keyboard.press(`${MOD}+-`) }
  if (zoom === '125%') await page.keyboard.press(`${MOD}+=`)
  await expect(page.getByTestId('zoom')).toHaveText(zoom)
  await selectAll(page)
    const before = await geometry(page,ids)
  for (const mode of ['left','center-x','right','top','center-y','bottom']) {
    await page.getByTestId(`align-${mode}`).click()
        const rects = await geometry(page,ids)
    const edges = rects.map((r) => mode==='left'?r.x:mode==='center-x'?r.x+r.w/2:mode==='right'?r.x+r.w:mode==='top'?r.y:mode==='center-y'?r.y+r.h/2:r.y+r.h)
    expect(Math.max(...edges)-Math.min(...edges)).toBeLessThan(0.1)
    await page.keyboard.press(`${MOD}+z`)
    expect(await geometry(page,ids)).toEqual(before)
    await page.keyboard.press(`${MOD}+Shift+z`)
    expect(await geometry(page,ids)).toEqual(rects)
    await page.keyboard.press(`${MOD}+z`)
  }
  await waitForSync(page)
})

test('locks resist drag/nudge/alignment/resize, allow editing and recoverable trash, survive reload', async ({ page }) => {
  const ids = await seed(page)
  await selectOnly(page,ids[0]!)
  await page.getByTestId('position-lock').click()
  await expect(page.getByTestId('position-lock')).toHaveAccessibleName('Unlock position')
  await expect(card(page,ids[0]!).getByTestId('resize-handle')).toHaveCount(0)
  const original = (await geometry(page,[ids[0]!]))[0]
  await dragBy(page,card(page,ids[0]!),60,40)
  await page.keyboard.press('ArrowRight')
  expect((await geometry(page,[ids[0]!]))[0]).toEqual(original)
  await selectAll(page)
  await page.getByTestId('align-bottom').click()
  expect((await geometry(page,[ids[0]!]))[0]).toEqual(original)
  await expect(page.getByTestId('selection-bar').getByRole('status').filter({hasText:'1 locked'})).toBeVisible()
  await selectOnly(page,ids[0]!)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.type('Edited while position locked')
  await page.keyboard.press('Escape')
  await waitForSync(page)
  await page.reload()
  await expect(card(page,ids[0]!)).toContainText('Edited while position locked')
  await selectOnly(page,ids[0]!)
  await expect(page.getByTestId('position-lock')).toHaveAccessibleName('Unlock position')
  await page.keyboard.press('Delete')
  await expect(card(page,ids[0]!)).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`)
  await expect(card(page,ids[0]!)).toBeVisible()
  await selectOnly(page,ids[0]!)
  await page.getByTestId('position-lock').click()
  await expect(card(page,ids[0]!).getByTestId('resize-handle')).toBeVisible()
})

test('moving then immediately locking preserves the moved geometry after sync/reload', async ({ page }) => {
  const ids=await seed(page)
  await dragBy(page,card(page,ids[0]!),50,35)
  const moved=(await geometry(page,[ids[0]!]))[0]
  await page.getByTestId('position-lock').click()
  await waitForSync(page); await page.reload()
  expect((await geometry(page,[ids[0]!]))[0]).toEqual(moved)
  await selectOnly(page,ids[0]!); await expect(page.getByTestId('position-lock')).toHaveAccessibleName('Unlock position')
})

test('a locked reference image stays fixed while a surrounding note moves, nudges and resizes', async ({ page }) => {
  const ids=await seed(page,true), reference=ids[0]!, noteId=crypto.randomUUID()
  await selectOnly(page,reference); await page.getByTestId('position-lock').click(); await waitForSync(page)
  const badge = card(page,reference).getByTestId('position-lock-badge')
  expect(await badge.evaluate((el) => {
    const b=el.getBoundingClientRect(), c=el.closest('[data-card-id]')!.getBoundingClientRect()
    return b.top>=c.top && b.left>=c.left && b.right<=c.right && b.bottom<=c.bottom
  })).toBe(true)
  const response=await postSync(page.request,{data:{changes:[{id:noteId,patch:{id:noteId,kind:'card',type:'note',boardId:boardOf(page),x:350,y:430,w:220,h:80,z:4,color:'gold',content:{md:'Surrounding layout note\n\nMove and resize beside the locked reference.'},createdAt:Date.now()}}]}})
  expect(response.ok(),await response.text()).toBe(true)
  await page.reload(); await expect(card(page,noteId)).toBeVisible(); await waitForSync(page)
  const fixed=(await geometry(page,[reference]))[0], original=(await geometry(page,[noteId]))[0]!
  await dragBy(page,card(page,noteId),40,-30)
  const moved=(await geometry(page,[noteId]))[0]!
  expect(moved.x).not.toBe(original.x)
  await page.keyboard.press('Shift+ArrowRight')
  expect((await geometry(page,[noteId]))[0]!.x).toBe(moved.x+10)
  const handle=(await card(page,noteId).getByTestId('resize-handle').boundingBox())!
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2); await page.mouse.down()
  await page.mouse.move(handle.x+handle.width/2+50,handle.y+handle.height/2,{steps:6}); await page.mouse.up()
  const resized=(await geometry(page,[noteId]))[0]!
  expect(resized.w).toBeGreaterThan(original.w)
  expect((await geometry(page,[reference]))[0]).toEqual(fixed)
  await waitForSync(page); await page.reload(); await expect(card(page,noteId)).toBeVisible()
  expect((await geometry(page,[noteId]))[0]).toEqual(resized)
  expect((await geometry(page,[reference]))[0]).toEqual(fixed)
})

test('all-locked selection gives feedback and keeps PNG pixels unchanged', async ({ page }) => {
  const ids = await seed(page)
  const exportBoard = async () => {
    await page.getByTestId('board-more').click(); await page.getByTestId('export').click()
    await page.getByTestId('export-scale-1').click()
    const download = page.waitForEvent('download'); await page.getByTestId('export-go').click()
    return readFile((await (await download).path())!)
  }
  const before = await geometry(page,ids), png = await exportBoard()
  await selectAll(page); await page.getByTestId('position-lock').click()
  await expect(page.getByTestId('align-selection')).toHaveCount(0)
  await expect(page.getByTestId('selection-bar').getByRole('status').filter({hasText:'3 locked'})).toBeVisible()
  await selectOnly(page,ids[0]!); await selectAll(page); await page.keyboard.press('ArrowDown')
  expect(await geometry(page,ids)).toEqual(before)
  const lockedPng = await exportBoard()
  expect(lockedPng.equals(png)).toBe(true)
  await selectAll(page); await page.getByTestId('position-lock').click()
  await expect(page.getByTestId('align-selection')).toBeVisible()
})

for(const viewport of [{width:600,height:900},{width:720,height:900},{width:720,height:480}]) test(`crowded ${viewport.width}x${viewport.height} mixed toolbar exposes actions without sideways scrolling`, async ({ page }) => {
  await page.setViewportSize(viewport)
  const ids=await seed(page,true)
  await selectOnly(page,ids[0]!); await page.getByTestId('position-lock').click()
  await selectAll(page)
  const bar=page.getByTestId('selection-bar'), before=await geometry(page,ids)
  await expect.poll(()=>bar.evaluate((el)=>{
    const b=el.getBoundingClientRect()
    const controls=[...el.querySelectorAll<HTMLElement>('button,select')].filter(e=>e.getClientRects().length)
    return b.left>=0 && b.right<=innerWidth && b.top>=0 && b.bottom<=innerHeight && controls.every(e=>{
      const r=e.getBoundingClientRect()
      return r.left>=b.left && r.right<=b.right && r.top>=b.top && r.bottom<=b.bottom
    })
  })).toBe(true)
  await page.getByTestId('bury').click()
  for(const id of ids) await expect(card(page,id)).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`)
  for(const id of ids) await expect(card(page,id)).toBeVisible()
  expect(await geometry(page,ids)).toEqual(before)
  await expect(card(page,ids[0]!).getByTestId('position-lock-badge')).toBeVisible()
})

test('column/member is one alignment unit; member lock pins column and can be unlocked from parent', async ({ page }) => {
  const ids = await seed(page), boardId = boardOf(page), columnId = crypto.randomUUID()
  const response = await postSync(page.request,{data:{changes:[{id:columnId,patch:{id:columnId,kind:'card',type:'column',boardId,x:100,y:450,w:280,h:220,z:4,color:'none',content:{title:'Long research column title with a locked reference'},createdAt:Date.now()}},{id:ids[0],patch:{columnId,order:1,positionLocked:true}}]}})
  expect(response.ok(),await response.text()).toBe(true)
  await page.reload(); await expect(page.getByTestId('canvas')).toBeVisible(); await page.keyboard.press(`${MOD}+1`)
  await selectOnly(page,columnId)
  const before = (await geometry(page,[columnId]))[0]
  await dragBy(page,card(page,columnId).locator('.column-head'),60,50)
  expect((await geometry(page,[columnId]))[0]).toEqual(before)
  await expect(page.getByTestId('unlock-column-layout')).toBeVisible()
  await page.getByTestId('unlock-column-layout').click()
  await selectOnly(page,ids[0]!)
  await card(page,ids[1]!).click({modifiers:['Shift']})
  await page.getByTestId('align-top').click()
  expect((await geometry(page,[columnId,ids[1]!])).map((r)=>r.y)).toEqual([100,100])
  await expect(card(page,ids[0]!)).toHaveClass(/in-column/)
  await page.keyboard.press(`${MOD}+z`)
  expect((await geometry(page,[columnId]))[0]).toEqual(before)
})

test('Escape cancels a drag without committing or changing its Undo history', async ({ page }) => {
  const ids = await seed(page), before = await geometry(page, ids)
  const box = (await card(page,ids[0]!).boundingBox())!
  await page.mouse.move(box.x+30,box.y+14); await page.mouse.down(); await page.mouse.move(box.x+100,box.y+70,{steps:6})
  await page.keyboard.press('Escape'); await page.mouse.up()
  expect(await geometry(page,ids)).toEqual(before)
  await expect(page.locator('.card.dragging')).toHaveCount(0)
})

test('a later nudge retires the alignment Undo offer and keeps both history steps', async ({ page }) => {
  const ids=await seed(page,true), before=await geometry(page,ids)
  await selectAll(page); await page.getByTestId('align-top').click()
  const aligned=await geometry(page,ids)
  await expect(page.getByTestId('toast-action')).toBeVisible()
  await selectOnly(page,ids[0]!); await page.keyboard.press('ArrowRight')
  expect((await geometry(page,ids))[0]!.x).toBe(aligned[0]!.x+1)
  await expect(page.getByTestId('toast-action')).toHaveCount(0)
  await page.keyboard.press(`${MOD}+z`); expect(await geometry(page,ids)).toEqual(aligned)
  await page.keyboard.press(`${MOD}+z`); expect(await geometry(page,ids)).toEqual(before)
})

test('offline move reconciles a concurrent lock without losing unrelated text', async ({ page, browser }) => {
  const ids = await seed(page)
  const context = await browser.newContext({storageState:await page.context().storageState()})
  const other = await context.newPage()
  try {
    await other.goto(page.url()); await expect(card(other,ids[0]!)).toBeVisible(); await waitForSync(other)
    await context.setOffline(true)
    await dragBy(other,card(other,ids[0]!),50,30)
    await selectOnly(other,ids[1]!); await other.keyboard.press('Enter'); await expect(other.getByTestId('note-editor')).toBeVisible()
    await other.keyboard.press(`${MOD}+a`); await other.keyboard.type('Offline content kept'); await other.keyboard.press('Escape')
    await selectOnly(page,ids[0]!); await page.getByTestId('position-lock').click(); await waitForSync(page)
    const before = (await geometry(page,[ids[0]!]))[0]
    await context.setOffline(false)
    await other.evaluate(()=>window.dispatchEvent(new Event('online')))
    await waitForSync(other)
    expect((await geometry(other,[ids[0]!]))[0]).toEqual(before)
    await expect(card(other,ids[1]!)).toContainText('Offline content kept')
    const snapshot = await pullAllObjects(page.request)
    expect(snapshot.objects.find((o:{id:string})=>o.id===ids[0]).positionLocked).toBe(true)
    expect(snapshot.objects.find((o:{id:string})=>o.id===ids[1]).content.md).toBe('Offline content kept')
  } finally { await context.close() }
})

test('newer remote geometry is not overwritten by stale Undo', async ({ page }) => {
  const ids = await seed(page)
  await selectAll(page); await page.getByTestId('align-top').click(); await waitForSync(page)
  const response=await postSync(page.request,{data:{changes:[{id:ids[0],patch:{y:600}}]}})
  expect(response.ok()).toBe(true)
  // Focus triggers an authorized pull without replacing this session's Undo stack.
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await expect.poll(async()=> (await geometry(page,[ids[0]!]))[0]!.y).toBe(600)
  await page.getByTestId('toast-action').click()
  expect((await geometry(page,[ids[0]!]))[0]!.y).toBe(600)
  // Shared drawing history also explains changed/non-editable objects; retain
  // the refusal and exact geometry checks across both supported store messages.
  await expect(page.getByTestId('toast')).toContainText(/Cannot undo.*changed/)
  await page.keyboard.press(`${MOD}+z`)
  expect((await geometry(page,[ids[0]!]))[0]!.y).toBe(600)
  await expect(page.getByRole('status').filter({hasText:/Cannot undo.*changed/})).toBeVisible()
})

test('read-only share cannot align or change position locks; server rejects viewer writes', async ({ page, browser }) => {
  const ids=await seed(page); await selectOnly(page,ids[0]!); await page.getByTestId('position-lock').click(); await waitForSync(page)
  const boardId=boardOf(page)
  const share=await page.request.post('/api/shares',{data:{boardId}})
  expect(share.ok(),await share.text()).toBe(true)
  const body=await share.json()
  const context=await browser.newContext({storageState:{cookies:[],origins:[]}})
  try {
    const viewer=await context.newPage(); await viewer.goto(new URL(`/s/${body.share.token}`,page.url()).href)
    await expect(viewer.getByTestId('canvas')).toBeVisible()
    await expect(viewer.getByTestId('position-lock')).toHaveCount(0)
    await expect(viewer.getByTestId('align-selection')).toHaveCount(0)
    expect((await viewer.request.post('/api/sync',{data:{changes:[{id:ids[0],patch:{positionLocked:false,x:1}}]}})).status()).toBe(401)
  } finally {await context.close()}
})

test('signed-in view-only collaborator cannot move, align or unlock references', async ({ page, browser }) => {
  const ids=await seed(page)
  await selectOnly(page,ids[0]!); await page.getByTestId('position-lock').click(); await waitForSync(page)
  const origin=new URL(page.url()).origin, username=`layout_view_${crypto.randomUUID().slice(0,8)}`
  const created=await page.request.post('/api/users',{data:{username,password:'isolated-layout-qa'}})
  expect(created.status(),await created.text()).toBe(201)
  const granted=await page.request.post(`/api/boards/${boardOf(page)}/members`,{data:{username,permission:'view'}})
  expect(granted.status(),await granted.text()).toBe(201)
  const context=await browser.newContext({baseURL:origin,storageState:{cookies:[],origins:[]},extraHTTPHeaders:{'x-doggynote-protocol':'3'}})
  try {
    const login=await context.request.post('/api/auth/login',{data:{username,password:'isolated-layout-qa'}})
    expect(login.ok(),await login.text()).toBe(true)
    const viewer=await context.newPage(); await viewer.goto(page.url())
    await expect(viewer.getByTestId('board-permission')).toHaveText('View only')
    for(const id of ids) await expect(card(viewer,id)).toBeVisible()
    const before=await geometry(viewer,ids)
    await card(viewer,ids[0]!).click({modifiers:['Shift']}); await viewer.keyboard.press(`${MOD}+a`)
    await viewer.keyboard.press('ArrowRight'); await viewer.keyboard.press('Delete')
    await expect(viewer.getByTestId('position-lock')).toHaveCount(0)
    await expect(viewer.getByTestId('align-selection')).toHaveCount(0)
    await expect(card(viewer,ids[0]!).getByTestId('resize-handle')).toHaveCount(0)
    expect(await geometry(viewer,ids)).toEqual(before)
    const denied=await context.request.post('/api/sync',{data:{changes:[{id:ids[0],patch:{positionLocked:false,x:999}}]}})
    expect(denied.status()).toBe(403)
    const saved=await pullAllObjects(page.request)
    const reference=saved.objects.find((o:{id:string})=>o.id===ids[0])
    expect(reference.positionLocked).toBe(true)
    expect(reference.x).toBe(before[0]!.x)
  } finally {await context.close()}
})
