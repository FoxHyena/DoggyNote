import { describe, expect, it } from 'vitest'
import { duplicateObjects } from './duplicate.ts'
import { builtinTemplate, BUILTIN_TEMPLATES } from './templates.ts'
import type { Board, Card, Obj } from './model.ts'

const board = (id: string, parentId: string | null = null): Board => ({ id, kind: 'board', parentId, title: id, icon: 'paw', color: 'gold', createdAt: 1 })
const card = (id: string, boardId = 'root', extra: Partial<Card> = {}): Card => ({ id, kind: 'card', type: 'note', boardId, x: 10, y: 20, w: 260, h: 60, z: 1, color: 'none', content: { md: id }, createdAt: 1, ...extra })
function graph(): Obj[] {
  return [board('root'), board('child', 'root'), board('grandchild', 'child'), board('unrelated'),
    card('column', 'root', { type: 'column', content: { title: 'References' } }),
    card('note', 'root', { columnId: 'column', order: 3 }),
    card('nested', 'root', { type: 'board', content: { boardId: 'child' } }),
    card('shortcut', 'root', { type: 'board', content: { boardId: 'unrelated' } }),
    card('child-note', 'child'), card('deep-note', 'grandchild'), card('foreign', 'unrelated'),
    card('photo', 'root', { type: 'image', content: { assetId: 'shared-asset', width: 900, height: 600, caption: 'Source stays intact', sizes: ['thumb', 'full'] } }),
    { id: 'line', kind: 'connection', boardId: 'root', from: 'note', to: 'photo', fromSide: 'right', arrow: 'end', createdAt: 1 },
    { id: 'comment', kind: 'comment', cardId: 'note', boardId: 'root', authorId: 'original-author', author: 'Rex', text: 'Discussion', createdAt: 1 },
    card('trashed', 'root', { deletedAt: 1 }), card('purged', 'root', { purged: true })]
}
const freshIds = () => { let n = 0; return () => `copy-${++n}` }

describe('independent canonical graph copies', () => {
  it('remaps canonical hierarchy, columns and endpoints without traversing shortcuts or copying discussion', () => {
    const input = graph()
    const before = structuredClone(input)
    const result = duplicateObjects(input, { rootBoardId: 'root', title: 'My copy', id: freshIds(), now: 9 })
    const copied = (id: string) => result.objects.find((o) => o.id === result.idMap.get(id))!
    expect(result.idMap.has('unrelated')).toBe(false)
    expect(result.idMap.has('foreign')).toBe(false)
    expect(result.idMap.has('comment')).toBe(false)
    expect(result.idMap.has('trashed')).toBe(false)
    expect(result.idMap.has('purged')).toBe(false)
    expect(copied('root')).toMatchObject({ parentId: null, title: 'My copy', createdAt: 9 })
    expect(copied('grandchild')).toMatchObject({ parentId: result.idMap.get('child') })
    expect(copied('note')).toMatchObject({ columnId: result.idMap.get('column'), order: 3, boardId: result.rootId })
    expect(copied('line')).toMatchObject({ from: result.idMap.get('note'), to: result.idMap.get('photo'), fromSide: 'right' })
    expect(copied('shortcut')).toMatchObject({ content: { boardId: 'unrelated' } })
    expect(copied('nested')).toMatchObject({ content: { boardId: result.idMap.get('child') } })
    expect(copied('photo')).toMatchObject({ content: { assetId: 'shared-asset', caption: 'Source stays intact' } })
    ;(copied('note') as Card<'note'>).content.md = 'Changed copy'
    expect(input).toEqual(before)
  })

  it('expands selected columns, detaches lone members at their rendered positions, and omits external connectors', () => {
    const source = graph()
    const whole = duplicateObjects(source, { selectionIds: ['column', 'photo'], targetBoardId: 'root', id: freshIds() })
    expect(whole.idMap.has('note')).toBe(true)
    expect(whole.idMap.has('line')).toBe(true)
    expect(whole.selectedIds.sort()).toEqual([whole.idMap.get('column'), whole.idMap.get('photo')].sort())
    const partial = duplicateObjects(source, { selectionIds: ['note'], targetBoardId: 'root', positions: { note: { x: 321, y: 456 } }, id: freshIds() })
    expect(partial.objects).toHaveLength(1)
    expect(partial.objects[0]).toMatchObject({ x: 353, y: 488, columnId: null, boardId: 'root' })
  })

  it('copies a selected canonical board tree, and only a shortcut for an unrelated board', () => {
    const result = duplicateObjects(graph(), { selectionIds: ['nested', 'shortcut'], targetBoardId: 'root', id: freshIds() })
    expect(result.idMap.has('grandchild')).toBe(true)
    expect(result.idMap.has('deep-note')).toBe(true)
    expect(result.idMap.has('unrelated')).toBe(false)
    expect(result.objects.find((o) => o.id === result.idMap.get('child'))).toMatchObject({ parentId: 'root' })
  })

  it('clones editable strokes and metadata, remaps whole-graph synced groups and detaches singletons', () => {
    const input = [board('root'), board('child', 'root'),
      { ...card('a'), noteGroupId: 'shared-body', noteBodyReadOnly: true, positionLocked: true, imageSourceUrl: 'https://example.com' },
      { ...card('b', 'child'), noteGroupId: 'shared-body' },
      { ...card('c'), noteGroupId: 'other-body' },
      { id: 'stroke', kind: 'stroke', cardId: 'a', boardId: 'root', points: [{ x: 4, y: 5 }], createdAt: 1, width: 3, opacity: .4, order: 1, tool: 'highlighter', color: '#2F5D50', bounds: { x: 1, y: 2, w: 6, h: 6 } },
      { ...card('swatch'), type: 'swatch', content: {}, swatchHex: '#2F5D50', swatchHexDraft: '#2F', swatchName: 'Forest' },
    ] as unknown as Obj[]
    const result = duplicateObjects(input, { rootBoardId: 'root', id: freshIds() })
    const get = (id: string) => result.objects.find((o) => o.id === result.idMap.get(id)) as unknown as Record<string, unknown>
    expect(get('a').noteGroupId).toBe(get('b').noteGroupId)
    expect(get('a').noteGroupId).not.toBe('shared-body')
    expect(get('c').noteGroupId).toBeNull()
    expect(get('a')).not.toHaveProperty('noteBodyReadOnly')
    expect(get('a')).toMatchObject({ positionLocked: true, imageSourceUrl: 'https://example.com' })
    expect(get('stroke')).toMatchObject({ cardId: result.idMap.get('a'), boardId: result.rootId, points: [{ x: 4, y: 5 }] })
    expect(get('stroke').points).not.toBe((input[6] as unknown as { points: unknown }).points)
    expect(get('swatch')).toMatchObject({ swatchHex: '#2F5D50', swatchHexDraft: '#2F', swatchName: 'Forest' })
    const single = duplicateObjects(input, { selectionIds: ['a'], targetBoardId: 'root' })
    expect(single.objects[0]).toMatchObject({ noteGroupId: null })
  })

  it('orders dependencies before references across large sync chunks', () => {
    const source = [board('root'), board('child', 'root'), ...Array.from({ length: 450 }, (_, i) => card(`note-${i}`)), card('col', 'root', { type: 'column', content: { title: 'Last in source' } }), card('member', 'root', { columnId: 'col' })]
    const result = duplicateObjects(source, { rootBoardId: 'root', id: freshIds() })
    const index = (id: string) => result.objects.findIndex((o) => o.id === result.idMap.get(id))
    expect(index('root')).toBeLessThan(index('child'))
    expect(index('child')).toBeLessThan(200)
    expect(index('col')).toBeLessThan(index('member'))
    expect(result.objects.every((o) => o.kind === 'board' || index('root') < result.objects.indexOf(o))).toBe(true)
  })

  it('rejects unavailable roots and reused IDs instead of mutating source data', () => {
    expect(() => duplicateObjects([], { rootBoardId: 'missing' })).toThrow('unavailable')
    expect(() => duplicateObjects(graph(), { rootBoardId: 'root', id: () => 'root' })).toThrow('reused')
  })

  it('reserves original note-group identities when allocating copied groups', () => {
    const linked = [board('root'), card('one', 'root', { noteGroupId: 'original-group' }), card('two', 'root', { noteGroupId: 'original-group' })]
    const ids = ['root-copy', 'one-copy', 'two-copy', 'original-group']
    expect(() => duplicateObjects(linked, { rootBoardId: 'root', id: () => ids.shift()! })).toThrow('reused')
  })

  it('reserves original checklist-entry identities when allocating copied items', () => {
    const checklist = [board('root'), card('todo', 'root', { type: 'todo', content: { title: 'Next steps', items: [{ id: 'original-task', text: 'Review the brief', done: false }] } })]
    const ids = ['root-copy', 'todo-copy', 'original-task']
    expect(() => duplicateObjects(checklist, { rootBoardId: 'root', id: () => ids.shift()! })).toThrow('reused')
    expect(checklist[1]).toMatchObject({ content: { items: [{ id: 'original-task' }] } })
  })

  it.each(BUILTIN_TEMPLATES)('$name creates independent content on every use', ({ id }) => {
    const template = builtinTemplate(id)
    const one = duplicateObjects(template.objects, { rootBoardId: template.rootId })
    const two = duplicateObjects(template.objects, { rootBoardId: template.rootId })
    expect(one.rootId).not.toBe(two.rootId)
    expect(one.objects.filter((o) => o.kind === 'card').length).toBeGreaterThan(2)
    const ids = new Set(one.objects.map((o) => o.id))
    expect(two.objects.some((o) => ids.has(o.id))).toBe(false)
  })
})
