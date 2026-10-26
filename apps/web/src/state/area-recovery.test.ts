import { afterEach, expect, it, vi } from 'vitest'
import type { Card, Obj } from '@doggynote/core'

afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();vi.doUnmock('./idb.ts')})
it('a cancelled IDB save restores every area detach and the final parent tombstone together',async()=>{
  vi.useFakeTimers();vi.resetModules()
  const session=new Map<string,string>()
  vi.stubGlobal('sessionStorage',{getItem:(key:string)=>session.get(key)??null,setItem:(key:string,value:string)=>session.set(key,value),removeItem:(key:string)=>session.delete(key)})
  const area:Card={id:'area',kind:'card',type:'area',boardId:'board',x:500,y:300,w:800,h:480,z:1,color:'none',createdAt:1,content:{title:'Project'}}
  const members:Card[]=Array.from({length:230},(_,i)=>({...area,id:`member${i}`,type:'todo',areaId:'area',x:24,y:72,w:260,h:90,content:{title:`Context ${i}`,items:[]}}))
  const stores={objects:new Map<string,unknown>([area,...members].map(o=>[o.id,o])),outbox:new Map<string,unknown>()}
  vi.doMock('./idb.ts',()=>({getAll:async(name:keyof typeof stores)=>new Map(stores[name]),put:async()=>{},clearAll:async()=>{},putDocument:async(objects:[string,unknown][],outbox:[string,unknown][])=>{for(const [id,o]of objects)stores.objects.set(id,o);for(const[id,p]of outbox){if(p===undefined)stores.outbox.delete(id);else stores.outbox.set(id,p)}}}))
  const before=await import('./doc.ts');await before.load({persist:true,readOnly:false});before.setWriteGuard(()=>true)
  before.update(Object.fromEntries([...members.map(o=>[o.id,{x:524,y:372,areaId:null}]),['area',{deletedAt:100}]]))
  before.journalDocument()
  // No debounce or IDB write lands before the old page disappears.
  expect(stores.outbox.size).toBe(0)
  vi.resetModules()
  const restored=await import('./doc.ts');await restored.load({persist:true,readOnly:false})
  expect(restored.pendingOutbox()).toHaveLength(231)
  expect(restored.getCard('area')!.deletedAt).toBe(100)
  for(const item of members)expect(restored.get(item.id) as Obj).toMatchObject({x:524,y:372,areaId:null})
  expect(stores.outbox.size).toBe(231)
  expect(session.has('doggynote.document-reload')).toBe(false)
})
