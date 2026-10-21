import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Card } from '@doggynote/core'

const io = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(), pulls: 0, calls: [] as string[],
  pushes: [] as { id: string; patch: Record<string, unknown> }[][],
  duringPull: undefined as ((count: number) => void) | undefined,
  duringPost: undefined as (() => Promise<void>) | undefined, pushError: null as Error | null,
}))
vi.mock('./api.ts', async (original) => ({
  ...await original<typeof import('./api.ts')>(),
  api: async (_path: string, init?: { method?: string; json?: { changes: { id: string; patch: Record<string, unknown> }[] } }) => {
    if (init?.method === 'POST') {
      io.calls.push('push')
      io.pushes.push(structuredClone(init.json!.changes))
      await io.duringPost?.()
      if (io.pushError) throw io.pushError
      return { ok: true }
    }
    io.calls.push('pull')
    io.pulls++; io.duringPull?.(io.pulls)
    return { objects: [], cursor: io.pulls, more: false, epoch: 'test-epoch', accessRevision: 'test-access', reset: false }
  },
}))
vi.mock('./idb.ts', () => {
  const store = (name: string) => {
    if (!io.stores.has(name)) io.stores.set(name, new Map())
    return io.stores.get(name)!
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
    put: async (name: string, key: string, value: unknown) => putMany(name, [[key, value]]), putMany,
    putDocument: async (objects: [string, unknown][], outbox: [string, unknown][]) => {
      await putMany('objects', objects); await putMany('outbox', outbox)
    },
  }
})
vi.mock('./access.ts', () => ({ accessRevision: () => 'test-access', refreshAccess: async () => { io.calls.push('access') }, canEditBoard: () => true }))
vi.mock('./assets.ts', () => ({ SIZES: {}, localBlob: async () => null, markUploaded: async () => {}, pendingUploads: async () => [], onAssetQueued: () => {} }))
vi.mock('./platform.ts', () => ({ isTauri: false }))
vi.mock('./ui.ts', () => ({ cancelEdit: () => {}, editingId: () => null }))

import * as doc from './doc.ts'
import { syncNow, syncState, pendingCount } from './sync.ts'
import { ApiError } from './api.ts'
import { loadRecovery, recoverableChanges } from './recovery.ts'
const card: Card<'note'> = { id: 'approved-note', kind: 'card', type: 'note', boardId: 'research', createdAt: 1, x: 0, y: 0, w: 260, h: 80, z: 1, color: 'none', content: { md: 'An approved reference' } }

beforeEach(async () => {
  vi.useFakeTimers()
  doc.ackOutbox(doc.pendingOutbox()); await doc.flush()
  io.stores.clear(); io.stores.set('meta', new Map([['epoch', 'test-epoch']]))
  await doc.load({ persist: true, readOnly: false })
  doc.setWriteGuard(() => true); doc.loadSnapshot([structuredClone(card)])
  await loadRecovery()
  io.pulls = 0; io.calls = []; io.pushes = []; io.duringPull = undefined; io.duringPost = undefined; io.pushError = null
})
afterEach(async () => { await doc.flush(); vi.useRealTimers() })

it('settles a measured height queued during the final pull before syncNow resolves', async () => {
  io.duringPull = (count) => { if (count === 2) doc.silent({ [card.id]: { h: 42 } }) }
  await syncNow()
  expect(doc.getCard(card.id)?.h).toBe(42)
  expect(io.pushes).toEqual([[{ id: card.id, patch: { h: 42, id: card.id } }]])
  expect(doc.outboxSize()).toBe(0)
  expect(io.calls).toEqual(['access', 'pull', 'pull', 'access', 'pull', 'push', 'pull'])
})

it('does not add another network pass when a successful sync is settled', async () => {
  await syncNow()
  expect(io.pulls).toBe(2)
  expect(io.pushes).toHaveLength(0)
})

it('bounds new automatic draining and preserves the newest pending measurement for a later explicit sync', async () => {
  io.duringPull = (count) => {
    if (count === 2) doc.silent({ [card.id]: { h: 42 } })
    if (count === 4) doc.silent({ [card.id]: { h: 43 } })
  }
  await syncNow()
  expect(io.pulls).toBe(4)
  expect(io.pushes).toEqual([[{ id: card.id, patch: { h: 42, id: card.id } }]])
  expect(doc.getCard(card.id)?.h).toBe(43)
  expect(doc.pendingOutbox()).toEqual([{ id: card.id, patch: { h: 43 } }])
  expect(pendingCount()).toBe(1)
  io.duringPull = undefined
  await syncNow()
  expect(io.pushes.at(-1)).toEqual([{ id: card.id, patch: { h: 43, id: card.id } }])
  expect(doc.outboxSize()).toBe(0)
})

it('retains offline late writes without spinning and can retry after recovery', async () => {
  io.duringPull = (count) => { if (count === 2) doc.silent({ [card.id]: { h: 42 } }) }
  io.pushError = new Error('Synthetic offline transport')
  await syncNow()
  expect(syncState()).toBe('offline')
  expect(doc.outboxSize()).toBe(1)
  expect(io.pushes).toHaveLength(1)
  io.pushError = null
  await syncNow()
  expect(syncState()).toBe('idle')
  expect(doc.outboxSize()).toBe(0)
})

it.each([400, 401, 403])('stops unsuccessful late writes on HTTP %s without an automatic retry loop', async (status) => {
  io.duringPull = (count) => { if (count === 2) doc.silent({ [card.id]: { h: 42 } }) }
  io.pushError = new ApiError(status, 'Synthetic invalid or signed-out update')
  await syncNow()
  expect(syncState()).toBe(status === 401 ? 'signed-out' : 'error')
  expect(doc.outboxSize()).toBe(1)
  expect(io.pushes).toHaveLength(1)
})

it('durably recovers an explicitly denied late write before removing it from the queue', async () => {
  io.duringPull = (count) => { if (count === 2) doc.silent({ [card.id]: { h: 42 } }) }
  io.pushError = new ApiError(403, 'Synthetic permission revocation', { deniedIds: [card.id] })
  await syncNow()
  expect(syncState()).toBe('idle')
  expect(io.pushes).toHaveLength(1)
  expect(doc.outboxSize()).toBe(0)
  expect(recoverableChanges()).toMatchObject([{ id: card.id, patch: { h: 42 }, object: { h: 42 } }])
  expect(io.stores.get('meta')?.get(`recovery:${card.id}`)).toMatchObject({ patch: { h: 42 }, object: { h: 42 } })
})

it('preserves the coalesced promise and lets an already-requested pass consume the automatic budget', async () => {
  let joined: Promise<void> | undefined
  io.duringPull = (count) => {
    if (count === 1) joined = syncNow()
    if (count === 2) doc.silent({ [card.id]: { h: 42 } })
    if (count === 4) doc.silent({ [card.id]: { h: 43 } })
  }
  const first = syncNow(); await first
  expect(joined).toBe(first)
  expect(io.pulls).toBe(4)
  expect(doc.pendingOutbox()).toEqual([{ id: card.id, patch: { h: 43 } }])
})

it('preserves newer fields queued while a POST is held and drains them after the old acknowledgement', async () => {
  let release!: () => void, reached!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const started = new Promise<void>((resolve) => { reached = resolve })
  io.duringPost = async () => { reached(); await held }
  doc.silent({ [card.id]: { h: 42 } })
  const first = syncNow(); await started
  doc.silent({ [card.id]: { h: 43, content: { md: 'Newer human text' } } })
  io.duringPost = undefined; release(); await first
  expect(io.pushes).toEqual([
    [{ id: card.id, patch: { h: 42, id: card.id } }],
    [{ id: card.id, patch: { h: 43, content: { md: 'Newer human text' }, id: card.id } }],
  ])
  expect(doc.getCard(card.id)?.content).toEqual({ md: 'Newer human text' })
  expect(doc.outboxSize()).toBe(0)
})


it('bounds a regenerated unchanged queue without dropping its patch', async () => {
  io.duringPull = (count) => {
    if (count === 2) doc.silent({ [card.id]: { h: 42 } })
    if (count === 4) {
      doc.receiveRemote([structuredClone(card)])
      doc.silent({ [card.id]: { h: 42 } })
    }
  }
  await syncNow()
  expect(io.pulls).toBe(4)
  expect(io.pushes).toHaveLength(1)
  expect(doc.pendingOutbox()).toEqual([{ id: card.id, patch: { h: 42 } }])
  expect(pendingCount()).toBe(1)
})

it('preserves the deliberate access-refresh follow-up for a 409 conflict', async () => {
  doc.silent({ [card.id]: { h: 42 } })
  io.pushError = new ApiError(409, 'Synthetic access revision conflict')
  io.duringPost = async () => { if (io.pushes.length === 2) io.pushError = null }
  await syncNow()
  expect(io.pushes).toHaveLength(2)
  expect(syncState()).toBe('idle')
  expect(doc.outboxSize()).toBe(0)
})

it.each([false, true])('keeps newer shared-body intent through a held POST and follow-up (unlink=%s)', async (unlink) => {
  const group = 'shared-research-brief'
  const peer: Card<'note'> = { ...card, id: 'research-instance', boardId: 'another-board', noteGroupId: group }
  doc.loadSnapshot([{ ...card, noteGroupId: group }, peer])
  let release!: () => void, reached!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { reached = resolve })
  io.duringPost = async () => { reached(); await held }
  doc.update({ [card.id]: { content: { md: 'First shared edit' } } })
  const first = syncNow(); await started
  if (unlink) doc.update({ [card.id]: { noteGroupId: null, noteBodyReadOnly: false, content: { md: 'New independent text' } } })
  else doc.update({ [card.id]: { content: { md: 'Newer shared text' } } })
  io.duringPost = undefined; release(); await first
  expect(io.pushes).toHaveLength(2)
  expect(io.pushes[0].find(change => change.id === card.id)?.patch).toMatchObject({ noteBodyEdit: { groupId: group, md: 'First shared edit' } })
  const latest = io.pushes[1].find(change => change.id === card.id)!.patch
  if (unlink) {
    expect(latest).toMatchObject({ noteGroupId: null, content: { md: 'New independent text' } })
    expect(latest).not.toHaveProperty('noteBodyEdit')
    expect(doc.getCard(card.id)).toMatchObject({ noteGroupId: null, content: { md: 'New independent text' } })
    expect(doc.getCard(peer.id)).toMatchObject({ noteGroupId: group, content: { md: 'First shared edit' } })
  } else {
    expect(latest).toMatchObject({ noteBodyEdit: { groupId: group, md: 'Newer shared text' } })
    expect(latest).not.toHaveProperty('content')
    for (const id of [card.id, peer.id]) expect(doc.getCard(id)).toMatchObject({ noteGroupId: group, content: { md: 'Newer shared text' } })
  }
  expect(doc.outboxSize()).toBe(0)
  expect(pendingCount()).toBe(0)
})
