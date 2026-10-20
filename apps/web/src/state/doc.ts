import { batch, createMemo, createRoot, createSignal } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'
import {
  HOME_BOARD_ID,
  UndoStack,
  diff,
  type Board,
  type Card,
  type Change,
  type Comment,
  type Connection,
  type Id,
  type Obj,
  type Transaction,
} from '@doggynote/core'
import * as idb from './idb.ts'

// The document store. Every edit goes through `commit` (undoable) or `silent`
// (not undoable, e.g. measured heights, unfurled link titles). Both apply the
// patch to the Solid store, persist it to IndexedDB and queue it for sync.
// `transient` changes the store only, for drags and in-progress typing; the
// final value is committed when the gesture ends.

const [state, setState] = createStore<{ objs: Record<Id, Obj> }>({ objs: {} })
export const objs = state.objs as Readonly<Record<Id, Obj>>

// Previewing an agent proposal: its objects sit in front of the store for every
// read, so the real canvas draws the proposal with the real cards. Nothing is
// ever written while previewing (every write below returns early), and the
// outbox and IndexedDB only ever read the store, so a preview can't be saved or
// synced. Remote changes keep landing in the store underneath.
const [overlay, setOverlay] = createStore<{ objs: Record<Id, Obj> | null }>({ objs: null })
export const previewing = () => overlay.objs !== null
export function setPreviewObjects(objects: Record<Id, Obj> | null) {
  // A JSON copy: the objects may hold store proxies, which structuredClone refuses.
  // Cleared first: setting an object on a store path merges into what's there.
  batch(() => {
    setOverlay('objs', null)
    if (objects) setOverlay('objs', JSON.parse(JSON.stringify(objects)) as Record<Id, Obj>)
  })
}
/** The stored object, ignoring any preview: for sync, access and recovery. */
export const base = (id: Id | null | undefined): Obj | undefined => (id ? state.objs[id] : undefined)

let persist = true
let readOnly = false
let writeGuard: ((object: Obj) => boolean) | null = null
export const setWriteGuard = (guard: (object: Obj) => boolean) => { writeGuard = guard }
export const canWriteObject = (object: Obj | undefined) => !!object && !readOnly && !previewing() && (!writeGuard || writeGuard(object))
const undoStack = new UndoStack()
const [undoTick, setUndoTick] = createSignal(0)
export const [localSaveError, setLocalSaveError] = createSignal<string | null>(null)
export const [lastLocalSave, setLastLocalSave] = createSignal<number | null>(null)

/** id → merged patch not yet acknowledged by the server. */
const outbox = new Map<Id, Partial<Obj>>()
/** Retain creation ownership across the gap between push acknowledgement and access refresh. */
export const localBoardCreations = new Set<Id>()
const outboxListeners = new Set<() => void>()
const transientListeners = new Set<(id: Id, patch: Partial<Obj>) => void>()
export const onTransient = (listener: (id: Id, patch: Partial<Obj>) => void) => { transientListeners.add(listener); return () => transientListeners.delete(listener) }

const dirtyObjs = new Set<Id>()
const dirtyOutbox = new Set<Id>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> | null = null

export const get = (id: Id | null | undefined): Obj | undefined => {
  if (!id) return undefined
  const o = overlay.objs
  return o && id in o ? o[id] : state.objs[id]
}
export const getCard = (id: Id | null | undefined) => {
  const o = get(id)
  return o?.kind === 'card' ? (o as Card) : undefined
}
export const getBoard = (id: Id | null | undefined) => {
  const o = get(id)
  return o?.kind === 'board' ? (o as Board) : undefined
}

export const isReadOnly = () => readOnly
export const canUndo = () => (undoTick(), undoStack.canUndo)
export const canRedo = () => (undoTick(), undoStack.canRedo)

function applyPatchToStore(id: Id, patch: Partial<Obj>) {
  if (state.objs[id]) setState('objs', id, patch as Obj)
  else setState('objs', id, { ...patch } as Obj)
}

function record(id: Id, patch: Partial<Obj>) {
  if (!persist) return
  if (patch.kind === 'board') localBoardCreations.add(id)
  dirtyObjs.add(id)
  outbox.set(id, { ...(outbox.get(id) ?? {}), ...structuredClone(unwrap(patch)) })
  dirtyOutbox.add(id)
  scheduleFlush()
}

function applyTx(tx: Transaction) {
  batch(() => {
    for (const c of tx) {
      applyPatchToStore(c.id, c.after)
      record(c.id, c.after)
    }
  })
  for (const l of outboxListeners) l()
}

/** Apply a transaction and push it onto the undo stack. */
export function commit(tx: Transaction) {
  if (readOnly || previewing() || !tx.length) return
  if (writeGuard && tx.some((c) => state.objs[c.id] && !writeGuard!({ ...state.objs[c.id], ...c.after, id: c.id } as Obj))) return
  if (writeGuard) {
    const freshBoards = new Map(tx.filter((change) => !state.objs[change.id] && change.after.kind === 'board').map((change) => [change.id, change.after as Board]))
    const writableBoard = (id: Id, seen = new Set<Id>()): boolean => {
      if (seen.has(id)) return false
      seen.add(id)
      const board = getBoard(id)
      if (board) return writeGuard!(board)
      const fresh = freshBoards.get(id)
      return !!fresh && (writeGuard!(fresh) || !fresh.parentId || writableBoard(fresh.parentId, seen))
    }
    if (tx.some((change) => {
      if (state.objs[change.id]) return !writeGuard!(state.objs[change.id])
      const object = change.after as Obj
      return object.kind === 'board' ? !writableBoard(change.id) : !writableBoard(object.boardId)
    })) return
  }
  applyTx(tx)
  undoStack.push(tx)
  setUndoTick((n) => n + 1)
}

/** Build changes from `{id: fields}` against current values and commit them. */
export function update(patches: Record<Id, Partial<Obj>>) {
  commit(changesFor(patches))
}

export function changesFor(patches: Record<Id, Partial<Obj>>): Change[] {
  const tx: Change[] = []
  for (const [id, p] of Object.entries(patches)) {
    const c = diff(state.objs[id], { ...p, id } as Partial<Obj>)
    if (c) tx.push({ id, before: c.before, after: c.after })
  }
  return tx
}

/** Change for creating `obj`. Undo purges it. */
export const createChange = (obj: Obj): Change => ({ id: obj.id, before: { purged: true }, after: { ...obj, purged: false } })

/** Persist + sync without an undo entry. */
export function silent(patches: Record<Id, Partial<Obj>>) {
  if (previewing()) {
    // Measured heights of previewed cards stay in the preview.
    batch(() => {
      for (const [id, p] of Object.entries(patches)) if (overlay.objs && id in overlay.objs) setOverlay('objs', id, p as Obj)
    })
    return
  }
  if (readOnly) {
    // Viewers still need measured heights in memory.
    batch(() => {
      for (const [id, p] of Object.entries(patches)) if (state.objs[id]) applyPatchToStore(id, p)
    })
    return
  }
  const writable: Record<Id, Partial<Obj>> = {}
  for (const [id, patch] of Object.entries(patches)) {
    // A queued measurement may arrive after access reconciliation removed its card.
    if (!state.objs[id] && !patch.kind) continue
    if (state.objs[id] && writeGuard && !writeGuard(state.objs[id])) {
      // Read-only viewers still need layout measurements in memory.
      applyPatchToStore(id, patch)
    } else writable[id] = patch
  }
  applyTx(changesFor(writable))
}

/**
 * Persist the current value of `keys` and fold it into the newest undo step if
 * that step created/changed this object; otherwise commit it as its own step.
 */
export function amendOrCommit(id: Id, snap: Partial<Obj>) {
  if (previewing()) return
  if (!canWriteObject(get(id))) return
  const cur = unwrap(state.objs[id]) as unknown as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(snap)) patch[k] = structuredClone(cur[k])
  if (undoStack.amendTop(id, patch)) {
    record(id, patch as Partial<Obj>)
    for (const l of outboxListeners) l()
  } else commitFrom({ [id]: snap })
}

/**
 * A background result for an object (an upload finishing): persist it, and fold
 * it into the newest undo step if that step touched the object, so redo never
 * brings back the in-progress value. Never an undo step of its own.
 */
export function amendOrSilent(id: Id, patch: Partial<Obj>) {
  if (previewing()) return
  if (!canWriteObject(get(id))) return
  applyPatchToStore(id, patch)
  const p = structuredClone(unwrap(patch)) as Record<string, unknown>
  undoStack.amendTop(id, p)
  record(id, p as Partial<Obj>)
  for (const l of outboxListeners) l()
}

/**
 * A follow-up to the newest edit (a ticked task settling into place a beat later):
 * folded into the newest undo step when that step changed the same fields of this
 * object, so one undo reverts both; otherwise committed as its own step.
 */
export function amend(id: Id, patch: Partial<Obj>) {
  if (previewing()) return
  if (!canWriteObject(get(id))) return
  const change = undoStack.peek()?.find((c) => c.id === id)
  if (!change || !Object.keys(patch).every((k) => k in change.before)) return update({ [id]: patch })
  const p = structuredClone(unwrap(patch)) as Record<string, unknown>
  applyPatchToStore(id, patch)
  undoStack.amendTop(id, p)
  record(id, p as Partial<Obj>)
  for (const l of outboxListeners) l()
}

/** Throw away a card that was just created and left empty, without an undo entry. */
export function discardNew(id: Id) {
  if (previewing()) return
  const top = undoStack.peek()
  if (top && top.length === 1 && top[0].id === id && top[0].before.purged) {
    undoStack.dropTop()
    setUndoTick((n) => n + 1)
  }
  silent({ [id]: { purged: true } })
}

/** Store only. Commit the final value with `commitFrom` when the gesture ends. */
export function transient(id: Id, patch: Partial<Obj>) {
  if (previewing()) return
  if (!canWriteObject(state.objs[id])) return
  applyPatchToStore(id, patch)
  for (const listener of transientListeners) listener(id, patch)
}

/** Durable editing checkpoint; the eventual edit commit still owns its undo step. */
export function checkpoint(id: Id, patch: Partial<Obj>) {
  if (previewing()) return
  if (!canWriteObject(get(id))) return
  record(id, patch)
  for (const listener of outboxListeners) listener()
}

/** Commit the difference between `snapshot` (values before the gesture) and the current store. False if nothing changed. */
export function commitFrom(snapshot: Record<Id, Partial<Obj>>): boolean {
  if (previewing()) return false
  const tx: Change[] = []
  for (const [id, before] of Object.entries(snapshot)) {
    if (!canWriteObject(state.objs[id])) continue
    const cur = state.objs[id] as unknown as Record<string, unknown>
    const b: Record<string, unknown> = {}
    const a: Record<string, unknown> = {}
    for (const k of Object.keys(before)) {
      const was = (before as Record<string, unknown>)[k]
      const now = structuredClone(unwrap(cur)[k])
      if (JSON.stringify(was ?? null) !== JSON.stringify(now ?? null)) {
        b[k] = was ?? null
        a[k] = now ?? null
      }
    }
    if (Object.keys(a).length) tx.push({ id, before: b as Partial<Obj>, after: a as Partial<Obj> })
  }
  if (!tx.length) return false
  // Already in the store; persist + record undo.
  for (const c of tx) record(c.id, c.after)
  for (const l of outboxListeners) l()
  undoStack.push(tx)
  setUndoTick((n) => n + 1)
  return true
}

/** Snapshot the given keys of an object (deep-cloned) for a later `commitFrom`. */
export function snapshot(id: Id, keys: string[]): Partial<Obj> {
  const o = unwrap(state.objs[id]) as unknown as Record<string, unknown>
  const s: Record<string, unknown> = {}
  for (const k of keys) s[k] = structuredClone(o?.[k] ?? null)
  return s as Partial<Obj>
}

export function undo() {
  if (previewing()) return
  const tx = undoStack.undo()
  if (tx && (!writeGuard || tx.every((change) => state.objs[change.id] && writeGuard!(state.objs[change.id])))) applyTx(tx)
  setUndoTick((n) => n + 1)
}

export function redo() {
  if (previewing()) return
  const tx = undoStack.redo()
  if (tx && (!writeGuard || tx.every((change) => state.objs[change.id] && writeGuard!(state.objs[change.id])))) applyTx(tx)
  setUndoTick((n) => n + 1)
}

function scheduleFlush() {
  flushTimer ??= setTimeout(() => void flush().catch(() => {}), 150)
}

export async function flush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (!persist) return
  if (flushing) {
    await flushing
    if (dirtyObjs.size || dirtyOutbox.size) return flush()
    return
  }
  flushing = (async () => {
    while (dirtyObjs.size || dirtyOutbox.size) {
      const objIds = [...dirtyObjs]
      const outIds = [...dirtyOutbox]
      const objects: [string, unknown][] = objIds.map((id) => [id, structuredClone(unwrap(state.objs[id]))])
      const patches: [string, unknown][] = outIds.map((id) => [id, structuredClone(outbox.get(id))])
      dirtyObjs.clear()
      dirtyOutbox.clear()
      try {
        await idb.putDocument(objects, patches)
        setLocalSaveError(null)
        setLastLocalSave(Date.now())
      } catch (error) {
        objIds.forEach((id) => dirtyObjs.add(id))
        outIds.forEach((id) => dirtyOutbox.add(id))
        setLocalSaveError('Changes could not be saved on this device. Keep this window open and retry.')
        throw error
      }
    }
  })().finally(() => { flushing = null })
  return flushing
}

// ---- sync hooks -----------------------------------------------------------

export function onOutbox(fn: () => void) {
  outboxListeners.add(fn)
  return () => outboxListeners.delete(fn)
}

export function pendingOutbox(): { id: Id; patch: Partial<Obj> }[] {
  return [...outbox].map(([id, patch]) => ({ id, patch: { ...patch } }))
}

/**
 * Drop acknowledged fields. A field that changed again while the push was in
 * flight stays queued; fields that didn't are removed, so a later push never
 * re-sends a stale value over someone else's newer edit.
 */
export function ackOutbox(sent: { id: Id; patch: Partial<Obj> }[]) {
  for (const s of sent) {
    const cur = outbox.get(s.id) as Record<string, unknown> | undefined
    if (!cur) continue
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cur)) {
      if (JSON.stringify(v ?? null) !== JSON.stringify((s.patch as Record<string, unknown>)[k] ?? null)) rest[k] = v
    }
    if (Object.keys(rest).length) outbox.set(s.id, rest as Partial<Obj>)
    else outbox.delete(s.id)
    dirtyOutbox.add(s.id)
  }
  scheduleFlush()
}

// Objects being dragged or edited right now. Remote rows for them wait until
// the gesture ends, so a background pull can't yank a card from under the
// cursor or overwrite text mid-sentence.
const busy = new Set<Id>()
const deferred = new Map<Id, Obj>()

export function markBusy(ids: Iterable<Id>) {
  for (const id of ids) busy.add(id)
}

export function unmarkBusy(ids: Iterable<Id>) {
  const ready: Obj[] = []
  for (const id of ids) {
    busy.delete(id)
    const row = deferred.get(id)
    if (row) {
      deferred.delete(id)
      ready.push(row)
    }
  }
  if (ready.length) receiveRemote(ready)
}

/** Server rows win, then our unsent patches are re-applied on top. */
export function receiveRemote(rows: Obj[]) {
  if (!rows.length) return
  batch(() => {
    for (const row of rows) {
      // Someone else's private object (e.g. moved into their Toy box): the server
      // sends only a stub, and any copy on this device goes away.
      if ((row as { hidden?: boolean }).hidden) {
        deferred.delete(row.id)
        outbox.delete(row.id)
        if (state.objs[row.id]) setState('objs', row.id, undefined as never)
        if (persist) {
          dirtyObjs.add(row.id)
          dirtyOutbox.add(row.id)
        }
        continue
      }
      if (busy.has(row.id)) {
        deferred.set(row.id, row)
        continue
      }
      const pending = outbox.get(row.id)
      const merged = pending ? { ...row, ...pending } : row
      // Replace rather than merge: the server row is complete.
      setState('objs', row.id, merged as Obj)
      for (const k of Object.keys(state.objs[row.id])) {
        if (!(k in merged)) setState('objs', row.id, k as never, undefined as never)
      }
      if (persist) dirtyObjs.add(row.id)
    }
  })
  scheduleFlush()
}

// ---- lifecycle ------------------------------------------------------------

export async function load(opts: { persist: boolean; readOnly: boolean }) {
  persist = opts.persist
  readOnly = opts.readOnly
  if (!persist) return
  const [all, out] = await Promise.all([idb.getAll<Obj>('objects'), idb.getAll<Partial<Obj>>('outbox')])
  const map: Record<Id, Obj> = {}
  for (const [id, o] of all) map[id] = o
  setState('objs', map)
  for (const [id, p] of out) { outbox.set(id, p); if (p.kind === 'board') localBoardCreations.add(id) }
}

/** Replace the whole document (share viewer). */
export function loadSnapshot(rows: Obj[]) {
  const map: Record<Id, Obj> = {}
  for (const r of rows) map[r.id] = r
  setState('objs', map)
}

/** Reconcile a new permission snapshot without discarding authorized offline creations. */
export function reconcileSnapshot(rows: Obj[], keepLocal: (object: Obj) => boolean) {
  const visible = new Set(rows.map((row) => row.id))
  batch(() => {
    for (const object of Object.values(state.objs)) {
      if (visible.has(object.id) || (outbox.has(object.id) && keepLocal(object))) continue
      deferred.delete(object.id)
      setState('objs', object.id, undefined as never)
      dirtyObjs.add(object.id)
    }
    receiveRemote(rows)
  })
  scheduleFlush()
}

export function ensureHome(title: string) {
  if (state.objs[HOME_BOARD_ID] || readOnly) return
  silent({
    [HOME_BOARD_ID]: {
      id: HOME_BOARD_ID,
      kind: 'board',
      parentId: null,
      title,
      icon: 'kennel',
      color: 'gold',
      createdAt: Date.now(),
    } as Board,
  })
}

export const outboxSize = () => outbox.size

export async function resetLocal() {
  outbox.clear()
  localBoardCreations.clear()
  setState('objs', {})
  await idb.clearAll()
}

// ---- indexes --------------------------------------------------------------

type Index = {
  cards: Map<Id, Card[]>
  connections: Map<Id, Connection[]>
  boards: Board[]
  /** cardId → live messages, oldest first. */
  comments: Map<Id, Comment[]>
}

/**
 * Board-level indexes. Only reads kind/boardId/deletedAt/purged, so moving or
 * editing a card doesn't rebuild it.
 */
export const index = createRoot(() =>
  createMemo<Index>(() => {
    const cards = new Map<Id, Card[]>()
    const connections = new Map<Id, Connection[]>()
    const boards: Board[] = []
    const comments = new Map<Id, Comment[]>()
    const shown = overlay.objs
    const all = shown ? [...Object.values(state.objs).filter((o) => !(o.id in shown)), ...Object.values(shown)] : Object.values(state.objs)
    for (const o of all) {
      if (o.purged || o.deletedAt) continue
      if (o.kind === 'card') {
        const list = cards.get(o.boardId)
        if (list) list.push(o)
        else cards.set(o.boardId, [o])
      } else if (o.kind === 'connection') {
        const list = connections.get(o.boardId)
        if (list) list.push(o)
        else connections.set(o.boardId, [o])
      } else if (o.kind === 'board') boards.push(o)
      else if (o.kind === 'comment') {
        const list = comments.get(o.cardId)
        if (list) list.push(o)
        else comments.set(o.cardId, [o])
      }
    }
    for (const list of comments.values()) list.sort((a, b) => a.createdAt - b.createdAt)
    return { cards, connections, boards, comments }
  }),
)

export const cardsOn = (boardId: Id): Card[] => index().cards.get(boardId) ?? []
export const connectionsOn = (boardId: Id): Connection[] => index().connections.get(boardId) ?? []
export const commentsOn = (cardId: Id): Comment[] => index().comments.get(cardId) ?? []

/** Trashed (soft-deleted, not purged) cards on a board. Not memoised; read when the panel opens. */
export function trashedOn(boardId: Id): Card[] {
  return Object.values(state.objs)
    .filter((o): o is Card => o.kind === 'card' && o.boardId === boardId && !!o.deletedAt && !o.purged)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

/** Your deleted (not yet wiped) comments on a board. Only the author's devices have them. */
export function trashedCommentsOn(boardId: Id): Comment[] {
  return Object.values(state.objs)
    .filter((o): o is Comment => o.kind === 'comment' && o.boardId === boardId && !!o.deletedAt && !o.purged)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

export function maxZ(boardId: Id): number {
  let z = 0
  for (const c of cardsOn(boardId)) z = Math.max(z, c.z ?? 0)
  return z
}
