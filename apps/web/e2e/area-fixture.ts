import { expect, type Page } from '@playwright/test'
import { freshBoard, postSync } from './helpers.ts'
export async function areaFixture(page: Page) {
  const prefix=crypto.randomUUID().slice(0,8)
  await freshBoard(page,`Canvas planning ${prefix}`)
  const board=decodeURIComponent(page.url().split('/b/')[1]!)
  const id=(part:string)=>`${prefix}-${part}`
  const area=id('area'), col=id('col'), child=id('child'), note=id('note'), out=id('out'), second=id('second')
  const base={kind:'card',boardId:board,x:0,y:0,w:260,h:100,z:1,color:'none',createdAt:Date.now(),columnId:null,areaId:null}
  const objects=[
    {...base,id:area,type:'area',x:40,y:40,w:900,h:500,color:'sky',content:{title:'Tracking Collars'}},
    {...base,id:col,type:'column',areaId:area,x:24,y:80,w:280,h:200,color:'gold',content:{title:'Doing'}},
    {...base,id:child,type:'todo',columnId:col,order:1,content:{title:`Build the sensor prototype · ${prefix}`,items:[]}},
    {...base,id:note,type:'note',areaId:area,x:24,y:300,content:{md:'Project context: test the collar fit before ordering parts.'}},
    {...base,id:second,type:'column',areaId:area,x:650,y:80,w:220,h:160,color:'ball',content:{title:'Ready'}},
    {...base,id:out,type:'todo',x:1050,y:150,content:{title:'Launch checklist',items:[]}},
    {id:id('internal'),kind:'connection',boardId:board,createdAt:Date.now(),from:col,to:second,arrow:'end'},
    {id:id('external'),kind:'connection',boardId:board,createdAt:Date.now(),from:child,to:out,arrow:'end'},
  ]
  const response=await postSync(page.request,{data:{changes:objects.map(o=>({id:o.id,patch:o}))}})
  expect(response.ok(),await response.text()).toBe(true)
  await page.evaluate(id=>localStorage.setItem(`doggynote.cam.${id}`,JSON.stringify({x:0,y:0,zoom:1})),board)
  await page.reload()
  const element=(id:string)=>page.locator(`[data-card-id="${id}"]`)
  await expect(element(area)).toBeVisible()
  return {searchText:`Build the sensor prototype · ${prefix}`,id,board,area,col,child,note,out,second,element}
}
