import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { app } from './app.ts'
import { sha256Hex } from './crypto.ts'
import type { Env } from './env.ts'

async function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(file, dir), 'utf8'))
  for (const id of ['rex', 'fido']) {
    sql.prepare('INSERT INTO users(id,username,pw_hash,is_admin,created_at) VALUES(?,?,?,?,?)').run(id, id, 'unused', 0, 1)
    sql.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(await sha256Hex(id), id, 1, Date.now() + 3600000)
  }
  for (const [id, user] of [['root', 'rex'], ['other', 'rex'], ['toybox:rex', 'rex']]) {
    const data = { id, kind: 'board', title: id, parentId: null, icon: 'paw', color: 'gold', createdAt: 1 }
    sql.prepare("INSERT INTO objects(id,kind,data,seq,updated_at,owner_id) VALUES(?,'board',?,1,1,?)").run(id, JSON.stringify(data), id.startsWith('toybox:') ? user : null)
    sql.prepare('INSERT INTO board_access(board_id,owner_id,legacy) VALUES(?,?,0)').run(id, user)
  }
  const db = {
    prepare(source: string) {
      let args: unknown[] = []
      const statement = {
        bind(...values: unknown[]) { args = values; return statement },
        query() {
          const values: unknown[] = []
          const text = source.replace(/\?(\d+)/g, (_, n: string) => { values.push(args[Number(n) - 1]); return '?' })
          return { query: sql.prepare(text), values: values as (string | number | null)[] }
        },
        async all() { const { query, values } = statement.query(); return { results: query.all(...values) } },
        async first() { const { query, values } = statement.query(); return query.get(...values) ?? null },
        async run() { const { query, values } = statement.query(); const r = query.run(...values); return { success: true, meta: { changes: Number(r.changes) } } },
      }
      return statement
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      sql.exec('BEGIN')
      try { const result = []; for (const s of statements) result.push(await s.run()); sql.exec('COMMIT'); return result } catch (e) { sql.exec('ROLLBACK'); throw e }
    },
  } as unknown as D1Database
  const env = { DB: db } as unknown as Env
  const request = (path: string, body?: unknown, user = 'rex', protocol = '4') => app.request(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json', 'x-doggynote-protocol': protocol }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  const push = (...changes: Record<string, unknown>[]) => request('/sync', { changes: changes.map((patch) => ({ id: patch.id, patch })) })
  return { push, request }
}
const area=(id='area')=>({id,kind:'card',type:'area',boardId:'root',x:500,y:300,w:800,h:480,z:1,color:'none',createdAt:1,content:{title:'Project'}})
const member=(id='note', extra: object={})=>({id,kind:'card',type:'todo',boardId:'root',areaId:'area',x:24,y:72,w:260,h:90,z:1,color:'none',createdAt:1,content:{md:'Context'},...extra})
it('validates parent kinds, boards, one-level nesting, conflicting parents and permissions',async()=>{
  const {push,request}=await fixture()
  expect((await push(area(),member())).status).toBe(200)
  expect((await push({...area('nested'),areaId:'area'})).status).toBe(403)
  expect((await push(member('wrong-board',{boardId:'other'}))).status).toBe(403)
  expect((await push(member('missing',{areaId:'missing'}))).status).toBe(403)
  const col=member('col',{type:'column',content:{title:'Doing'}})
  expect((await push(col)).status).toBe(200)
  expect((await push(member('two',{columnId:'col'}))).status).toBe(403)
  expect((await push(member('child',{areaId:null,columnId:'col'}))).status).toBe(200)
  expect((await request('/sync',{changes:[{id:'note',patch:{x:40}}]},'fido')).status).toBe(403)
})
it('area and member field edits merge independently, including offline-sized chunked operations',async()=>{
  const {push,request}=await fixture()
  await push(area())
  const members=Array.from({length:230},(_,i)=>member(`note${i}`))
  for(let i=0;i<members.length;i+=200)expect((await push(...members.slice(i,i+200))).status).toBe(200)
  await push({id:'area',x:800})
  await push({id:'note0',x:48,content:{md:'Offline edit'}})
  let objects=(await (await request('/sync?since=0')).json() as {objects:Record<string,unknown>[]}).objects
  expect(objects.find(o=>o.id==='area')).toMatchObject({x:800})
  expect(objects.find(o=>o.id==='note0')).toMatchObject({x:48,areaId:'area',content:{md:'Offline edit'}})
  const conflict=await push({id:'area',deletedAt:1})
  expect(conflict.status).toBe(409)
  expect(await conflict.json()).toMatchObject({areaConflictIds:['area']})
  for(let i=0;i<members.length;i+=200)expect((await push(...members.slice(i,i+200).map(o=>({id:o.id,areaId:null,x:824,y:372})))).status).toBe(200)
  // A concurrent join after those detach chunks prevents the final tombstone.
  await push(member('joined'))
  expect((await push({id:'area',deletedAt:1})).status).toBe(409)
  expect((await push({id:'joined',areaId:null,x:824,y:372},{id:'area',deletedAt:1})).status).toBe(200)
  expect((await push(member('late'))).status).toBe(403)
  objects=(await (await request('/sync?since=0')).json() as {objects:Record<string,unknown>[]}).objects
  expect(objects.filter(o=>o.areaId==='area'&&!o.deletedAt)).toHaveLength(0)
})
it('layout locks protect an area through its locked members and allow content edits',async()=>{
  const {push,request}=await fixture()
  await push(area(),member('locked',{positionLocked:true}),member('free'))
  expect(await (await push({id:'area',x:999,h:999,deletedAt:1})).json()).toMatchObject({lockedIds:['area']})
  await push({id:'locked',content:{md:'Still editable'}})
  await push({id:'free',x:70})
  const objects=(await (await request('/sync?since=0')).json() as {objects:Record<string,unknown>[]}).objects
  expect(objects.find(o=>o.id==='area')).toMatchObject({x:500,h:480})
  expect(objects.find(o=>o.id==='area')!.deletedAt).toBeUndefined()
  expect(objects.find(o=>o.id==='locked')).toMatchObject({content:{md:'Still editable'}})
  expect(objects.find(o=>o.id==='free')).toMatchObject({x:70})
})
it('protocol 3 cannot misinterpret relative coordinates and protocol 4 can pull them',async()=>{
  const {push,request}=await fixture()
  await push(area(),member())
  expect((await request('/sync?since=0',undefined,'rex','3')).status).toBe(426)
  expect((await request('/sync',{changes:[{id:'note',patch:{x:1}}]},'rex','3')).status).toBe(426)
  expect((await request('/sync?since=0')).status).toBe(200)
})
