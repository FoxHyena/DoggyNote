import { describe, expect, it } from 'vitest'
import { areaFamily, areaBurialFamily, planAreaTidy, areaFrame, areaMembers, areaVisibleEndpoint, itemWorldPosition, orderedAreaChanges } from './areas.ts'
import { collectClip, materialise, parseClip } from './clip.ts'
import { positionLocks } from './position.ts'
import { stickerBounds } from './stickers.ts'
import type { Card, Obj, Sticker } from './model.ts'
const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind:'card', type:'note', boardId:'board', x:10,y:20,w:200,h:100,z:1,color:'none',createdAt:1,content:{md:id}, ...extra })
const area = card('area',{type:'area',x:500,y:300,w:800,h:480,content:{title:'Launch'}})
const col = card('col',{type:'column',areaId:area.id,x:24,y:72,content:{title:'Doing'}})
const note = card('note',{areaId:area.id,x:300,y:72})
const child = card('child',{columnId:col.id,x:900,y:900})
const sticker: Sticker = { id:'sticker',kind:'sticker',boardId:'board',createdAt:1,areaId:area.id,x:-20,y:100,w:100,z:1,angle:45,content:{assetId:'asset',stickerId:'s',packName:'p',emoji:'',width:100,height:100,format:'static'} }
const all = [area,col,note,child,sticker]
const get = (id: string) => all.find(o => o.id === id)
describe('canvas areas', () => {
  it('keeps legacy positions and resolves direct members from a stable origin', () => {
    expect(itemWorldPosition(card('legacy'),get)).toEqual({x:10,y:20})
    expect(itemWorldPosition(note,get)).toEqual({x:800,y:372})
    expect(itemWorldPosition(note,id => id===area.id ? {...area,x:700} : get(id))).toEqual({x:1000,y:372})
    expect(note.x).toBe(300)
  })
  it('inherits membership through columns without assigning two parents', () => {
    expect(areaMembers(area,all).map(o=>o.id)).toEqual(['col','note','sticker'])
    expect(areaFamily(area,all).map(o=>o.id)).toEqual(['col','note','sticker','child'])
    expect(areaVisibleEndpoint(child.id,get,c=>c.id===area.id)).toBe(area.id)
    expect(areaVisibleEndpoint(child.id,get,c=>c.id===col.id)).toBe(col.id)
  })
  it('ignores cross-board parents and never treats overlapping items as members', () => {
    expect(itemWorldPosition({...note,boardId:'other'},get)).toEqual({x:300,y:72})
    expect(areaMembers(area,[card('overlap',{x:600,y:400})])).toEqual([])
    expect(areaFamily(area,[card('nested-board',{type:'board',areaId:area.id,content:{boardId:'inside'}}),card('inside',{boardId:'inside'})]).map(o=>o.id)).toEqual(['nested-board'])
  })
  it('expands around rotated stickers and negative member positions without rebasing', () => {
    const bounds=stickerBounds({...sticker,...itemWorldPosition(sticker,get)})
    const frame=areaFrame(area,[bounds])
    expect(frame.x).toBeLessThan(area.x)
    expect(frame.x).toBeLessThanOrEqual(bounds.x-24)
    expect(frame.w).toBeGreaterThan(area.w)
    expect(areaFrame(area,[bounds],true)).toEqual({...frame,h:48})
    expect([area.x,sticker.x,area.w]).toEqual([500,-20,800])
  })
  it('uses requested minimum dimensions and shrinks derived expansion when contents leave', () => {
    expect(areaFrame(area,[])).toEqual({x:500,y:300,w:800,h:480})
    expect(areaFrame(area,[{x:1500,y:900,w:200,h:100}]).w).toBe(1224)
    expect(areaFrame(area,[]).w).toBe(800)
  })
  it('projects external endpoints onto a collapsed area and drops dead endpoints', () => {
    expect(areaVisibleEndpoint(note.id,get,()=>true)).toBe(area.id)
    expect(areaVisibleEndpoint('missing',get,()=>true)).toBeNull()
    expect(areaVisibleEndpoint(note.id,id=>id===note.id?{...note,deletedAt:1}:get(id),()=>true)).toBeNull()
  })
  it('locks the entire area layout but lets a locked child pin just its area and column family', () => {
    expect([...positionLocks([{...area,positionLocked:true},col,note,child,sticker])].sort()).toEqual(all.map(o=>o.id).sort())
    const locks=positionLocks([area,col,note,{...child,positionLocked:true},sticker])
    expect([...locks].sort()).toEqual(['area','child','col'])
  })
  it('creates parents before references and removes parents after member detaches across 200-object chunks', () => {
    const items: Obj[]=[area,col,...Array.from({length:205},(_,i)=>card(`n${i}`,{areaId:area.id}))]
    const changes=items.slice().reverse().map(o=>({id:o.id,patch:o}))
    const ordered=orderedAreaChanges(changes,id=>items.find(o=>o.id===id))
    expect(ordered.slice(0,2).map(c=>c.id)).toEqual(['area','col'])
    const remove=orderedAreaChanges([{id:area.id,patch:{deletedAt:1}},...changes.slice(0,205).map(c=>({id:c.id,patch:{areaId:null,x:100}}))],get)
    expect(remove.at(-1)?.id).toBe(area.id)
    expect(remove.slice(0,200).some(c=>c.id===area.id)).toBe(false)
  })
  it('copies mixed area families and remaps membership, ink ownership and internal arrows', () => {
    const ink=card('ink',{type:'ink',areaId:area.id,content:{width:200,height:100}})
    const objects: Obj[]=[...all,ink,{id:'stroke',kind:'stroke',boardId:'board',cardId:ink.id,createdAt:1,points:[{x:0,y:0,pressure:.5},{x:10,y:10,pressure:.5}],color:'#000000',width:2,opacity:1,tool:'pen'},{id:'conn',kind:'connection',boardId:'board',createdAt:1,from:note.id,to:col.id,arrow:'end'}] as Obj[]
    const clip=collectClip([area.id],{get:id=>objects.find(o=>o.id===id),all:()=>objects,rect:id=>id===area.id?areaFrame(area,[]):null})
    expect(clip && clip!=='too-big').toBe(true)
    if(!clip||clip==='too-big')throw Error('clip')
    expect(parseClip(JSON.stringify(clip))).not.toBeNull()
    let next=0
    const pasted=materialise(clip,{at:{x:100,y:100},boardId:'target',maxZ:1,now:2,newId:()=>`copy${++next}`})
    const parent=pasted.objects.find(o=>o.kind==='card'&&o.type==='area') as Card
    expect(pasted.objects.filter(o=>(o.kind==='card'||o.kind==='sticker')&&o.areaId===parent.id)).toHaveLength(4)
    expect(pasted.objects.find(o=>o.kind==='card'&&o.type==='column')).toMatchObject({boardId:'target'})
    expect(pasted.objects.find(o=>o.kind==='connection')).toMatchObject({from:'copy3',to:'copy2'})
    expect(pasted.objects.find(o=>o.kind==='stroke')).toMatchObject({boardId:'target',cardId:pasted.objects.find(o=>o.kind==='card'&&o.type==='ink')!.id})
  })
  it('tidies columns in their current left-to-right order and supporting cards below, leaving drawings and stickers alone', () => {
    const right=card('right',{type:'column',areaId:area.id,x:500,w:280,h:300})
    const left={...col,x:100,h:500}
    const ink=card('ink',{type:'ink',areaId:area.id,x:2,y:500})
    const positions=planAreaTidy(area,[right,left,note,ink,sticker,child],c=>c.h)
    expect(positions.col).toEqual({x:24,y:72})
    expect(positions.right).toEqual({x:288,y:72})
    expect(positions.note).toEqual({x:24,y:604})
    expect(Object.keys(positions)).toEqual(['col','right','note'])
  })
  it('bulk restoration excludes earlier burials and includes a column’s children from the same operation', () => {
    const buried={...area,deletedAt:100}
    const members=[{...col,deletedAt:100},{...child,deletedAt:100},{...note,deletedAt:50},{...sticker,deletedAt:100}]
    expect(areaBurialFamily(buried,members).map(o=>o.id)).toEqual(['col','sticker','child'])
    expect(areaBurialFamily(area,members)).toEqual([])
  })
  it('distinguishes separate burial operations even when their timestamps match', () => {
    const buried={...area,deletedAt:100,burialId:'current'}
    const members=[{...col,deletedAt:100,burialId:'current'},{...child,deletedAt:100,burialId:'current'},{...note,deletedAt:100,burialId:'earlier'},{...sticker,deletedAt:100}]
    expect(areaBurialFamily(buried,members).map(o=>o.id)).toEqual(['col','child'])
  })
  it('deduplicates a selected area’s inherited column children in clipboard roots',()=>{
    const clip=collectClip([area.id,col.id,child.id,note.id],{get,all:()=>all,rect:id=>id===area.id?areaFrame(area,[]):null})
    if(!clip||clip==='too-big')throw Error('clip')
    expect(clip.roots).toEqual([area.id])
  })
  it('copies a member alone into independent world coordinates', () => {
    const clip=collectClip([note.id],{get,all:()=>all,rect:()=>({x:800,y:372,w:200,h:100})})
    if(!clip||clip==='too-big')throw Error('clip')
    expect(clip.objects[0]).toMatchObject({x:800,y:372,areaId:null,columnId:null})
  })
})
