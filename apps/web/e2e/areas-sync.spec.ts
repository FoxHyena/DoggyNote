import {expect,test} from '@playwright/test'
import {areaFixture} from './area-fixture.ts'
import {dragBy,freshBoard,postSync,selectAllText,waitForSync,pullAllObjects} from './helpers.ts'
test('an offline member edit merges with another device moving the area origin',async({page,browser})=>{
  const f=await areaFixture(page)
  expect((await page.request.post(`/api/boards/${f.board}/members`,{data:{username:'fido',permission:'edit',includeChildren:false}})).ok()).toBe(true)
  const context=await browser.newContext({storageState:{cookies:[],origins:[]},extraHTTPHeaders:{'x-doggynote-protocol':'4'}})
  try{
    expect((await context.request.post('/api/auth/login',{data:{username:'fido',password:'fetchfetch'}})).ok()).toBe(true)
    const other=await context.newPage();await other.goto(page.url());await expect(other.locator(`[data-card-id="${f.note}"]`)).toBeVisible();await waitForSync(other)
    await context.setOffline(true)
    const note=other.locator(`[data-card-id="${f.note}"]`);await note.dblclick()
    const editor=other.getByTestId('note-editor');await expect(editor).toBeVisible();await editor.click();await selectAllText(other);await other.keyboard.type('Offline planning context');await other.keyboard.press('Escape')
    await dragBy(page,f.element(f.area).locator('.area-grip'),100,40);await waitForSync(page)
    await context.setOffline(false);await waitForSync(other);await page.reload();await waitForSync(page)
    const objects=(await pullAllObjects(page.request)).objects
    expect(objects.find(o=>o.id===f.area)).toMatchObject({x:140,y:80})
    expect(objects.find(o=>o.id===f.note)).toMatchObject({areaId:f.area,x:24,y:300,content:{md:'Offline planning context'}})
    await expect(f.element(f.note)).toHaveText('Offline planning context')
  }finally{await context.close()}
})

test('a large area placed from the Inbox resumes a partially sent transfer after reload',async({page})=>{
  test.setTimeout(60000)
  await freshBoard(page,'Area transfer destination')
  await waitForSync(page)
  const target=page.url().split('/b/')[1]!,prefix=crypto.randomUUID().slice(0,8)
  const {user}=await (await page.request.get('/api/me')).json(),source=`toybox:${user.id}`
  const areaId=`${prefix}-area`,title=`Large Inbox project ${prefix}`
  const base={kind:'card',boardId:source,x:24,y:72,w:240,h:90,z:1,color:'none',createdAt:Date.now(),columnId:null,areaId}
  const area={...base,id:areaId,type:'area',areaId:null,x:500,y:300,w:900,h:500,content:{title}}
  const created=await postSync(page.request,{data:{changes:[{id:areaId,patch:area}]}})
  expect(created.ok(),await created.text()).toBe(true)
  const members=Array.from({length:230},(_,i)=>({...base,id:`${prefix}-member${i}`,type:'todo',content:{title:`Context ${i}`,items:[]},x:24+(i%10)*300,y:72+Math.floor(i/10)*150}))
  for(let i=0;i<members.length;i+=200)expect((await postSync(page.request,{data:{changes:members.slice(i,i+200).map(o=>({id:o.id,patch:o}))}})).ok()).toBe(true)
  await page.reload();await waitForSync(page)
  let interrupted=false
  await page.route('**/api/sync',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    if(interrupted){await route.abort('internetdisconnected');return}
    const changes=route.request().postDataJSON().changes
    if(changes.length&&changes.every((c:{id:string;patch:{areaId?:string|null}})=>c.id.startsWith(`${prefix}-member`)&&c.patch.areaId===null)){
      const response=await route.fetch();expect(response.ok()).toBe(true)
      interrupted=true;await route.fulfill({response});return
    }
    await route.continue()
  })
  await page.getByTestId('toybox-button').click()
  const project=page.getByTestId('toybox-item').filter({hasText:title})
  await expect(project).toBeVisible()
  await project.getByTestId('toybox-place').click()
  await expect.poll(()=>interrupted).toBe(true)
  await page.reload()
  await expect(page.locator(`[data-card-id="${areaId}"]`)).toBeVisible()
  await page.unroute('**/api/sync')
  await page.context().setOffline(true);await page.context().setOffline(false)
  await waitForSync(page)
  const rows=(await pullAllObjects(page.request)).objects
  expect(rows.find(o=>o.id===areaId)).toMatchObject({boardId:target})
  for(const member of members)expect(rows.find(o=>o.id===member.id)).toMatchObject({boardId:target,areaId,x:member.x,y:member.y})
})
