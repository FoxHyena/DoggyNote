import { describe, expect, it } from 'vitest'
import { clipText, collectClip, materialise, parseClip, type Board, type Card, type ClipPayload, type Obj } from './index.ts'

const card = (id: string, type: string, x: number, y: number, content: unknown, extra: Partial<Card> = {}) =>
  ({ id, kind: 'card', type, boardId: 'B', x, y, w: 100, h: 50, z: 1, color: 'none', createdAt: 1, content, ...extra }) as Card
const store = (objs: Obj[]) => {
  const m = new Map(objs.map((o) => [o.id, o]))
  return { get: (id: string) => m.get(id), all: () => m.values(), rect: (id: string) => { const c = m.get(id) as Card; return c?.columnId ? { x: 500, y: 500, w: c.w, h: c.h } : c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null } }
}
let n = 0
const fresh = () => `new${++n}`

describe('clips', () => {
  const a = card('a', 'note', 0, 0, { md: 'one' }, { z: 3 })
  const b = card('b', 'note', 200, 100, { md: 'two' }, { z: 1 })
  const c = card('c', 'note', 900, 900, { md: 'left behind' })
  const ab = { id: 'ab', kind: 'connection', boardId: 'B', from: 'a', to: 'b', arrow: 'end', createdAt: 1 } as Obj
  const ac = { id: 'ac', kind: 'connection', boardId: 'B', from: 'a', to: 'c', arrow: 'end', createdAt: 1 } as Obj

  it('takes connections between picked cards only, and leaves comments behind', () => {
    const comment = { id: 'm', kind: 'comment', boardId: 'B', cardId: 'a', authorId: 'u', author: 'rex', text: 'hi', createdAt: 1 } as Obj
    const clip = collectClip(['a', 'b'], store([a, b, c, ab, ac, comment])) as ClipPayload
    expect(clip.objects.map((o) => o.id).sort()).toEqual(['a', 'ab', 'b'])
  })

  it('pastes with new ids, the layout centred on the point, stacking kept above the board', () => {
    const clip = collectClip(['a', 'b'], store([a, b, ab])) as ClipPayload
    const { objects, roots } = materialise(clip, { at: { x: 1000, y: 1000 }, boardId: 'T', maxZ: 10, now: 5, newId: fresh })
    const [na, nb] = roots.map((id) => objects.find((o) => o.id === id) as Card)
    expect(na.id).not.toBe('a')
    expect([na.x, na.y, nb.x, nb.y]).toEqual([850, 925, 1050, 1025])
    expect([na.z, nb.z]).toEqual([12, 11])
    expect(objects.every((o) => o.createdAt === 5)).toBe(true)
    const conn = objects.find((o) => o.kind === 'connection') as { from: string; to: string; boardId: string }
    expect([conn.from, conn.to, conn.boardId]).toEqual([na.id, nb.id, 'T'])
  })

  it('brings a column’s cards along, and a card picked out of a column comes out free', () => {
    const col = card('col', 'column', 0, 0, { title: 'Ideas' })
    const k1 = card('k1', 'note', 0, 0, { md: 'kid' }, { columnId: 'col', order: 1 })
    const clip = collectClip(['col'], store([col, k1])) as ClipPayload
    const { objects } = materialise(clip, { at: { x: 0, y: 0 }, boardId: 'B', maxZ: 0, now: 1, newId: fresh })
    const nc = objects.find((o) => (o as Card).type === 'column')!
    expect((objects.find((o) => (o as Card).content && (o as Card<'note'>).content.md === 'kid') as Card).columnId).toBe(nc.id)
    expect(objects[0]).toBe(nc)
    const kidOnly = collectClip(['k1'], store([col, k1])) as ClipPayload
    expect(kidOnly.objects[0]).toMatchObject({ columnId: null, x: 500, y: 500 })
  })

  it('deep-copies the board inside a board card, parents first', () => {
    const inner = { id: 'I', kind: 'board', parentId: 'B', title: 'Inner', icon: 'paw', color: 'none', createdAt: 1 } as Board
    const deeper = { id: 'D', kind: 'board', parentId: 'I', title: 'Deeper', icon: 'paw', color: 'none', createdAt: 1 } as Board
    const tile = card('t', 'board', 0, 0, { boardId: 'I' })
    const innerNote = card('in', 'note', 0, 0, { md: 'inside' }, { boardId: 'I' })
    const innerTile = card('it', 'board', 0, 0, { boardId: 'D' }, { boardId: 'I' })
    const clip = collectClip(['t'], store([inner, deeper, tile, innerNote, innerTile])) as ClipPayload
    const { objects } = materialise(clip, { at: { x: 0, y: 0 }, boardId: 'T', maxZ: 0, now: 1, newId: fresh })
    const boards = objects.filter((o) => o.kind === 'board') as Board[]
    expect(boards.map((b) => b.title)).toEqual(['Inner', 'Deeper'])
    expect(boards[0].parentId).toBe('T')
    expect(boards[1].parentId).toBe(boards[0].id)
    const newTile = objects.find((o) => (o as Card).type === 'board' && (o as Card).boardId === 'T') as Card<'board'>
    expect(newTile.content.boardId).toBe(boards[0].id)
    expect((objects.find((o) => (o as Card<'note'>).content?.md === 'inside') as Card).boardId).toBe(boards[0].id)
    expect(objects.findIndex((o) => o.id === boards[0].id)).toBeLessThan(objects.findIndex((o) => o.id === newTile.id))
  })

  it('pastes into a column in reading order', () => {
    const clip = collectClip(['b', 'a'], store([a, b])) as ClipPayload
    const { objects } = materialise(clip, { at: { x: 0, y: 0 }, boardId: 'B', maxZ: 0, now: 1, newId: fresh, column: { id: 'col', orders: [1, 2] } })
    expect(objects.map((o) => [(o as Card<'note'>).content.md, (o as Card).columnId, (o as Card).order]).sort((x, y) => Number(x[2]) - Number(y[2]))).toEqual([['one', 'col', 1], ['two', 'col', 2]])
  })

  it('reads as markdown for other apps, and parses back defensively', () => {
    const todo = card('t', 'todo', 0, 300, { title: 'Chores', items: [{ id: '1', text: 'walk', done: true }, { id: '2', text: 'feed', done: false }] })
    const link = card('l', 'link', 300, 300, { url: 'https://dog.example', title: 'Dogs' })
    const clip = collectClip(['l', 't', 'a'], store([a, todo, link])) as ClipPayload
    expect(clipText(clip)).toBe('one\n\nChores\n- [x] walk\n- [ ] feed\n\n[Dogs](https://dog.example)')
    expect(parseClip(JSON.stringify(clip))).toEqual(clip)
    expect(parseClip('{"app":"other"}')).toBeNull()
    expect(parseClip('not json')).toBeNull()
  })

  it('refuses huge clips', () => {
    const many = Array.from({ length: 520 }, (_, i) => card(`k${i}`, 'note', 0, 0, { md: '' }, { columnId: 'col' }))
    expect(collectClip(['col'], store([card('col', 'column', 0, 0, { title: '' }), ...many]))).toBe('too-big')
  })
})
