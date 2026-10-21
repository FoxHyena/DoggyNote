import { describe, expect, it } from 'vitest'
import { checkPositionLocks, positionWriteGuards } from './position.ts'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  for (const name of ['0001_init','0002_epoch','0003_asset_index','0004_owner','0005_access']) sql.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'))
  const put = (id: string, extra: object = {}) => sql.prepare("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES (?,'card','b',?,1,1)").run(id, JSON.stringify({ id,kind:'card',type:'note',boardId:'b',x:10,y:20,w:200,h:60,z:1,content:{md:'original'}, ...extra }))
  put('col', { type: 'column' }); put('a', { columnId: 'col', positionLocked: true }); put('sibling', { columnId: 'col' }); put('free')
  const db = { prepare(source: string) {
    let args: unknown[] = []
    const query = () => { const values: (string | number | null)[] = []; const text = source.replace(/\?(\d+)/g, (_, n) => { values.push(args[Number(n)-1] as string | number | null); return '?' }); return { stmt: sql.prepare(text), values } }
    const statement = {
      bind(...values: unknown[]) { args = values; return statement },
      async all() { const { stmt,values } = query(); return { results: stmt.all(...values) } },
      async first() { const { stmt,values } = query(); return stmt.get(...values) },
      async run() { const { stmt,values } = query(); return stmt.run(...values) },
    }; return statement
  } } as unknown as D1Database
  return { sql, db, put }
}
describe('server position locks', () => {
  it('protects locked children, parent and siblings while permitting content, measurements, collapse and trash', async () => {
    const { sql,db } = fixture()
    try {
      for (const id of ['a','col','sibling']) expect((await checkPositionLocks(db,[{ id,patch:{x:99,w:300} }])).lockedIds).toEqual([id])
      expect((await checkPositionLocks(db,[{id:'a',patch:{content:{md:'new'},h:200,deletedAt:1}},{id:'col',patch:{collapsed:true}}])).lockedIds).toEqual([])
      expect((await checkPositionLocks(db,[{id:'free',patch:{columnId:'col'}}])).lockedIds).toEqual(['free'])
    } finally { sql.close() }
  })
  it('allows deliberate unlock with geometry without clearing unrelated fields', async () => {
    const { sql,db } = fixture()
    try { expect((await checkPositionLocks(db,[{id:'a',patch:{positionLocked:false}},{id:'col',patch:{x:30}}])).lockedIds).toEqual([]) } finally { sql.close() }
  })
  it('persists a move followed immediately by a new lock in one merged sync patch', async () => {
    const { sql,db } = fixture()
    try {
      expect((await checkPositionLocks(db,[{id:'free',patch:{x:55,positionLocked:true}}])).lockedIds).toEqual([])
      expect((await checkPositionLocks(db,[{id:'a',patch:{x:55,positionLocked:true}}])).lockedIds).toEqual(['a'])
    } finally { sql.close() }
  })
  it('atomically rejects a racing lock or new locked member but ignores unrelated boards', async () => {
    const { sql,db } = fixture()
    try {
      const { versions } = await checkPositionLocks(db,[{id:'free',patch:{x:30}}])
      await expect(positionWriteGuards(db,'1',versions)[0].run()).resolves.toBeDefined()
      sql.exec("INSERT INTO objects(id,kind,board_id,data,seq,updated_at) VALUES('else','card','other','{}',100,1)")
      await expect(positionWriteGuards(db,'1',versions)[0].run()).resolves.toBeDefined()
      sql.exec("UPDATE objects SET seq=101,data=json_set(data,'$.positionLocked',json('true')) WHERE id='free'")
      await expect(positionWriteGuards(db,'1',versions)[0].run()).rejects.toThrow('Access changed')
    } finally { sql.close() }
  })
})
