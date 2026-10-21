import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Card, Obj } from '@doggynote/core'

const fixture = vi.hoisted(() => ({ stores: new Map<string, Map<string, unknown>>(), api: vi.fn() }))
vi.mock('./idb.ts', () => {
  const store = (name: string) => {
    if (!fixture.stores.has(name)) fixture.stores.set(name, new Map())
    return fixture.stores.get(name)!
  }
  const putMany = async (name: string, entries: Iterable<[string, unknown]>) => {
    for (const [key, value] of entries) {
      if (value === undefined) store(name).delete(key)
      else store(name).set(key, structuredClone(value))
    }
  }
  return {
    get: async (name: string, key: string) => store(name).get(key),
    getAll: async (name: string) => new Map(store(name)),
    put: async (name: string, key: string, value: unknown) => putMany(name, [[key, value]]),
    putMany,
    putDocument: async (objects: [string, unknown][], outbox: [string, unknown][]) => {
      await putMany('objects', objects); await putMany('outbox', outbox)
    },
  }
})
vi.mock('./access.ts', () => ({ accessRevision: () => '2', canEditBoard: (id: string) => ['overview', 'research'].includes(id), refreshAccess: async () => {} }))
vi.mock('./api.ts', () => ({ api: fixture.api, ApiError: class extends Error {} }))
vi.mock('./assets.ts', () => ({ SIZES: [], pendingUploads: async () => [], onAssetQueued: () => {}, localBlob: async () => null, markUploaded: async () => {} }))
vi.mock('./platform.ts', () => ({ isTauri: false }))

let doc: typeof import('./doc.ts')
let ui: typeof import('./ui.ts')
let sync: typeof import('./sync.ts')
let recovery: typeof import('./recovery.ts')
const board = (id: string) => ({ id, kind: 'board', parentId: null, title: id, icon: 'paw', color: 'none', createdAt: 1 }) as Obj
const note = (id: string, boardId: string, extra: Partial<Card> = {}) => ({ id, kind: 'card', type: 'note', boardId, noteGroupId: 'g', x: 0, y: 0, w: 260, h: 80, z: 0, color: 'none', content: { md: 'Original brief' }, createdAt: 1, ...extra }) as Card<'note'>

beforeEach(async () => {
  vi.resetModules()
  fixture.stores.clear(); fixture.api.mockReset()
  vi.stubGlobal('location', { pathname: '/', hash: '#/b/overview' })
  vi.stubGlobal('window', { addEventListener: () => {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  fixture.stores.set('meta', new Map([['epoch', 'test-epoch']]))
  doc = await import('./doc.ts')
  await doc.load({ persist: true, readOnly: false })
  ui = await import('./ui.ts')
  sync = await import('./sync.ts')
  recovery = await import('./recovery.ts')
})
afterEach(async () => { ui.cancelEdit(); await doc.flush(); vi.unstubAllGlobals() })

function snapshot(rows: Obj[]) {
  fixture.api.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === 'POST') return { ok: true }
    const url = new URL(path, 'http://test.local')
    return { objects: url.searchParams.get('since') === '0' ? rows : [], cursor: 10, more: false, epoch: 'test-epoch', accessRevision: '2', reset: url.searchParams.get('accessRevision') !== '2' }
  })
}

it('preserves active text and ends its busy session when the owner moves a linked note outside the authorized snapshot', async () => {
  doc.loadSnapshot([board('overview'), board('research'), note('one', 'overview'), note('two', 'research')])
  ui.focusNote('one')
  doc.transient('one', { content: { md: 'Private local draft before the move' } } as Partial<Card>)
  snapshot([board('overview'), board('research'), note('two', 'research', { noteBodyReadOnly: true })])
  await sync.syncNow()

  expect(sync.syncState()).toBe('idle')
  expect(ui.editingId()).toBeNull()
  expect(ui.focusedNoteId()).toBeNull()
  expect(doc.get('one')).toBeUndefined()
  expect(doc.getCard('two')).toMatchObject({ noteBodyReadOnly: true, content: { md: 'Original brief' } })
  expect(doc.pendingOutbox()).toEqual([])
  expect(fixture.api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  const saved = recovery.recoverableChanges().find((row) => row.id === 'one')
  expect(saved?.object).toMatchObject({ content: { md: 'Private local draft before the move' } })
  expect(JSON.stringify(recovery.recoverableChanges())).not.toContain('toybox:')
  // An authoritative row for the remaining instance must no longer be deferred.
  doc.receiveRemote([note('two', 'research', { content: { md: 'Owner-approved revision' }, noteBodyReadOnly: true }) as Obj])
  expect(doc.getCard('two')?.content).toEqual({ md: 'Owner-approved revision' })
})

it('retains a writable active local creation that has not appeared in the server snapshot yet', async () => {
  doc.loadSnapshot([board('overview')])
  doc.commit([doc.createChange(note('new-note', 'overview', { noteGroupId: null }))])
  ui.focusNote('new-note')
  doc.transient('new-note', { content: { md: 'New offline project brief' } } as Partial<Card>)
  snapshot([board('overview')])
  await sync.syncNow()

  expect(sync.syncState()).toBe('idle')
  expect(ui.editingId()).toBe('new-note')
  expect(ui.focusedNoteId()).toBe('new-note')
  expect(doc.getCard('new-note')?.content).toEqual({ md: 'New offline project brief' })
  expect(recovery.recoverableChanges()).toEqual([])
  expect(fixture.api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true)
})

it('preserves active text before a hidden delta removes a busy note and its outbox', async () => {
  doc.loadSnapshot([board('overview'), note('one', 'overview')])
  snapshot([board('overview'), note('one', 'overview')])
  await sync.syncNow()
  fixture.api.mockClear()
  ui.focusNote('one')
  doc.transient('one', { content: { md: 'Draft before a hidden delta' } } as Partial<Card>)
  fixture.api.mockImplementation(async () => ({ objects: [{ id: 'one', hidden: true }], cursor: 11, more: false, epoch: 'test-epoch', accessRevision: '2', reset: false }))
  await sync.syncNow()

  expect(sync.syncState()).toBe('idle')
  expect(ui.editingId()).toBeNull()
  expect(ui.focusedNoteId()).toBeNull()
  expect(doc.get('one')).toBeUndefined()
  expect(doc.pendingOutbox()).toEqual([])
  expect(fixture.api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  expect(recovery.recoverableChanges().find((row) => row.id === 'one')?.object).toMatchObject({ content: { md: 'Draft before a hidden delta' } })
})

it('keeps a first link and immediate typing queued while a pre-push snapshot still has the independent source', async () => {
  const source = note('one', 'overview', { noteGroupId: null })
  doc.loadSnapshot([board('overview'), board('research'), structuredClone(source)])
  doc.commit([...doc.changesFor({ one: { noteGroupId: 'g' } } as Record<string, Partial<Card>>), doc.createChange(note('two', 'research'))])
  ui.focusNote('two')
  doc.transient('two', { content: { md: 'Typing before the first link is accepted' } } as Partial<Card>)
  snapshot([board('overview'), board('research'), source])
  await sync.syncNow()

  expect(sync.syncState()).toBe('idle')
  expect(recovery.recoverableChanges()).toEqual([])
  expect(doc.getCard('one')).toMatchObject({ noteGroupId: 'g', content: { md: 'Typing before the first link is accepted' } })
  expect(doc.getCard('two')).toMatchObject({ noteGroupId: 'g', content: { md: 'Typing before the first link is accepted' } })
  const posts = fixture.api.mock.calls.filter(([, options]) => options?.method === 'POST')
  expect(posts).toHaveLength(1)
  expect(posts[0][1].json.changes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'one', patch: expect.objectContaining({ noteGroupId: 'g' }) }),
    expect.objectContaining({ id: 'two', patch: expect.objectContaining({ kind: 'card', noteGroupId: 'g' }) }),
  ]))
})

it('retains an explicit pending unlink when the pre-push snapshot still projects the old protected group', async () => {
  const protectedSource = note('one', 'overview', { noteBodyReadOnly: true })
  doc.loadSnapshot([board('overview'), structuredClone(protectedSource)])
  doc.update({ one: { noteGroupId: null, noteBodyReadOnly: false, content: { md: 'My independent version' } } as Partial<Card> })
  ui.focusNote('one')
  snapshot([board('overview'), protectedSource])
  await sync.syncNow()

  expect(sync.syncState()).toBe('idle')
  expect(ui.editingId()).toBe('one')
  expect(recovery.recoverableChanges()).toEqual([])
  expect(doc.getCard('one')).toMatchObject({ noteGroupId: null, content: { md: 'My independent version' } })
  expect(fixture.api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true)
})

it('drains actual shared-body group writes queued during the final pull before resolving', async () => {
  doc.loadSnapshot([board('overview'), board('research'), note('one', 'overview'), note('two', 'research')])
  let pulls = 0
  const posts: { id: string; patch: Record<string, unknown> }[][] = []
  fixture.api.mockImplementation(async (_path: string, options?: { method?: string; json?: { changes: typeof posts[number] } }) => {
    if (options?.method === 'POST') { posts.push(structuredClone(options.json!.changes)); return { ok: true } }
    if (++pulls === 2) doc.update({ one: { content: { md: 'Shared body queued during final pull' } } as Partial<Card> })
    return { objects: [], cursor: pulls, more: false, epoch: 'test-epoch', accessRevision: '2', reset: false }
  })
  await sync.syncNow()

  expect(posts).toHaveLength(1)
  expect(posts[0]).toHaveLength(2)
  for (const id of ['one', 'two']) {
    expect(posts[0]).toContainEqual({ id, patch: { id, noteBodyEdit: { groupId: 'g', md: 'Shared body queued during final pull' } } })
    expect(doc.getCard(id)).toMatchObject({ noteGroupId: 'g', content: { md: 'Shared body queued during final pull' } })
  }
  expect(sync.syncState()).toBe('idle')
  expect(doc.outboxSize()).toBe(0)
  expect(recovery.recoverableChanges()).toEqual([])
})

it('keeps a newer shared-body revision queued during a held POST and drains its expected-group writes', async () => {
  doc.loadSnapshot([board('overview'), board('research'), note('one', 'overview'), note('two', 'research')])
  const posts: { id: string; patch: Record<string, unknown> }[][] = []
  let release!: () => void, reached!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const started = new Promise<void>((resolve) => { reached = resolve })
  fixture.api.mockImplementation(async (_path: string, options?: { method?: string; json?: { changes: typeof posts[number] } }) => {
    if (options?.method === 'POST') {
      posts.push(structuredClone(options.json!.changes))
      if (posts.length === 1) { reached(); await held }
      return { ok: true }
    }
    return { objects: [], cursor: 10, more: false, epoch: 'test-epoch', accessRevision: '2', reset: false }
  })
  doc.update({ one: { content: { md: 'First shared revision' } } as Partial<Card> })
  const syncing = sync.syncNow()
  await started
  doc.update({ two: { content: { md: 'Newer shared revision while POST was held' } } as Partial<Card> })
  release()
  await syncing

  expect(posts).toHaveLength(2)
  for (const [index, md] of ['First shared revision', 'Newer shared revision while POST was held'].entries()) {
    expect(posts[index]).toHaveLength(2)
    for (const id of ['one', 'two']) expect(posts[index]).toContainEqual({ id, patch: { id, noteBodyEdit: { groupId: 'g', md } } })
  }
  for (const id of ['one', 'two']) expect(doc.getCard(id)).toMatchObject({ noteGroupId: 'g', content: { md: 'Newer shared revision while POST was held' } })
  expect(sync.syncState()).toBe('idle')
  expect(doc.pendingOutbox()).toEqual([])
  expect(recovery.recoverableChanges()).toEqual([])
})
