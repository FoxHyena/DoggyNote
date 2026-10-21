import { batch, createMemo, createRoot, createSignal } from 'solid-js'
import { createStore, unwrap } from 'solid-js/store'
import {
  HOME_BOARD_ID,
  POSITION_FIELDS,
  UndoStack,
  changesPosition,
  positionLocks,
  diff,
  type Board,
  type Card,
  type Change,
  type Comment,
  type Connection,
  type Id,
  type Obj,
  type Transaction,
  type Sticker,
  usableSticker,
} from '@doggynote/core'
import * as idb from './idb.ts'
import { setToastAction, showToast } from './toast.ts'
import * as Y from 'yjs'
import { decodeUpdate, noteDocument, noteMarkdown, noteState, replaceText, REMOTE_ORIGIN } from '@doggynote/core'

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
export const canWriteObject = (object: Obj | undefined) => !!object && !readOnly && !previewing() && (!writeGuard || writeGuard(object)) && !(object.kind === 'card' && object.type === 'note' && !object.noteState)
const undoStack = new UndoStack()
const [undoTick, setUndoTick] = createSignal(0)
export const [localSaveError, setLocalSaveError] = createSignal<string | null>(null)
export const [lastLocalSave, setLastLocalSave] = createSignal<number | null>(null)

/** id → merged patch not yet acknowledged by the server. */
const outbox = new Map<Id, Partial<Obj>>()
const notes = new Map<Id, Y.Doc>()
const noteUndos = new Map<Id, Y.UndoManager>()
const composingNotes = new Set<string>()
const heldNoteStates = new Map<string, string>()
const compositionWaiters = new Map<string, Set<() => void>>()
export const isNoteComposing = (id: string) => composingNotes.has(id)
export function setNoteComposing(id: string, active: boolean) {
  if (active) { composingNotes.add(id); return }
  composingNotes.delete(id)
  const held = heldNoteStates.get(id)
  heldNoteStates.delete(id)
  if (held && notes.has(id)) Y.applyUpdate(notes.get(id)!, decodeUpdate(held), REMOTE_ORIGIN)
  for (const resolve of compositionWaiters.get(id) ?? []) resolve()
  compositionWaiters.delete(id)
}
/** Don't persist a pull cursor ahead of text held by an active native IME. */
export async function settleNoteCompositions() {
  await Promise.all([...heldNoteStates.keys()].map((id) => new Promise<void>((resolve) => {
    const waiters = compositionWaiters.get(id) ?? new Set()
    waiters.add(resolve); compositionWaiters.set(id, waiters)
  })))
}
export const finishNoteEdit = (id: string) => noteUndos.get(id)?.stopCapturing()
let noteFlushScheduled = false
let applyingTextUndo = false
let newNoteEdit: string | null = null
export const setNewNoteEdit = (id: string | null) => { newNoteEdit = id }
export const LOCAL_TEXT_ORIGIN = 'local-text'
export function noteUndo(id: string) {
  let manager = noteUndos.get(id)
  if (!manager) {
    manager = new Y.UndoManager(noteDoc(id).getText('markdown'), { trackedOrigins: new Set([LOCAL_TEXT_ORIGIN]), captureTimeout: Number.MAX_SAFE_INTEGER })
    noteUndos.set(id, manager)
    manager.on('stack-item-added', ({ type, origin }: { type: string; origin: unknown }) => {
      if (type !== 'undo' || applyingTextUndo || origin === manager) return
      if (newNoteEdit === id) return
      undoStack.push([{ id, before: { noteUpdate: 'undo' }, after: { noteUpdate: 'redo' } }])
      historyChanged()
    })
    manager.on('stack-item-popped', ({ type }: { type: string }) => {
      if (applyingTextUndo) return
      const top = type === 'undo' ? undoStack.peek() : undoStack.peekRedo()
      if (top?.length === 1 && top[0]!.id === id && top[0]!.after.noteUpdate === 'redo') {
        if (type === 'undo') undoStack.undo()
        else undoStack.redo()
        setUndoTick((n) => n + 1)
      }
    })
  }
  return manager
}
/** Shared text lives independently of mounted editors, including offline. */
export function noteDoc(id: Id): Y.Doc {
  let document = notes.get(id)
  if (document) return document
  const object = state.objs[id]
  document = noteDocument(object?.noteState)
  notes.set(id, document)
  if (object) applyPatchToStore(id, { noteState: noteState(document) })
  document.on('update', (_update: Uint8Array, origin: unknown) => {
    if (!state.objs[id]) return
    const text = document!.getText('markdown').toString(), encoded = noteState(document!)
    applyPatchToStore(id, { content: { md: text }, noteState: encoded } as Partial<Obj>)
    if (newNoteEdit === id && origin !== REMOTE_ORIGIN) undoStack.amendTop(id, { content: { md: text } })
    if (persist) dirtyObjs.add(id)
    if (origin !== REMOTE_ORIGIN) {
      record(id, { noteUpdate: encoded })
      for (const listener of outboxListeners) listener()
      if (!noteFlushScheduled) {
        noteFlushScheduled = true
        queueMicrotask(() => { noteFlushScheduled = false; void flush().catch(() => {}) })
      }
    } else scheduleFlush()
  })
  return document
}
/** Retain creation ownership across the gap between push acknowledgement and access refresh. */
export const localBoardCreations = new Set<Id>()
const outboxListeners = new Set<() => void>()
const transientListeners = new Set<(id: Id, patch: Partial<Obj>) => void>()
export const onTransient = (listener: (id: Id, patch: Partial<Obj>) => void) => { transientListeners.add(listener); return () => transientListeners.delete(listener) }

const dirtyObjs = new Set<Id>()
const dirtyOutbox = new Set<Id>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const saves = new Set<Promise<void>>()
const NOTE_JOURNAL = 'doggynote.note-reload'

/** A per-tab crash cushion: browsers may cancel queued IDB writes on reload.
 * Store each full CRDT state once; projection and outbox are restored together. */
export function journalNotes() {
  if (!persist) return
  try {
    const rows = [...outbox].flatMap(([id, patch]) => {
      const o = state.objs[id]
      if (o?.kind !== 'card' || o.type !== 'note' || !patch.noteUpdate) return []
      const { content: _content, noteState: _state, noteUpdate: _update, ...object } = unwrap(o)
      const { noteUpdate: _pending, ...metadata } = patch
      return [{ id, object, patch: metadata, state: o.noteState ?? patch.noteUpdate }]
    })
    if (rows.length) sessionStorage.setItem(NOTE_JOURNAL, JSON.stringify(rows))
    else sessionStorage.removeItem(NOTE_JOURNAL)
  } catch {
    setLocalSaveError('The reload recovery copy could not be saved. Keep this window open until local saving finishes.')
  }
}

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

function historyChanged() {
  // An Undo offer describes the previous command. Once history changes, its
  // button must not silently undo a different command. Keyboard Undo remains.
  setToastAction(null)
  setUndoTick((n) => n + 1)
}

/** Position locks guard explicit layout changes. Content edits and natural height reflow stay allowed. */
function layoutAllowed(tx: Transaction): boolean {
  if (tx.every((ch) => { const c = getCard(ch.id); return !c || !changesPosition(c, ch.after as Partial<Card>, true) })) return true
  const cards = Object.values(state.objs).filter((o): o is Card => o.kind === 'card')
  const byId = new Map(tx.map((ch) => [ch.id, ch]))
  // An explicit unlock in this command is deliberate.
  const nextLocks = positionLocks(cards.map((c) => {
    const change = byId.get(c.id)
    return change && 'positionLocked' in change.after && (change.after as Partial<Card>).positionLocked !== true ? { ...c, positionLocked: false } : c
  }))
  return tx.every((ch) => {
    const c = getCard(ch.id)
    if (!c || !changesPosition(c, ch.after as Partial<Card>, true)) return true
    const target = (ch.after as Partial<Card>).columnId
    return !nextLocks.has(c.id) && (!target || !nextLocks.has(target))
  })
}

function applyPatchToStore(id: Id, patch: Partial<Obj>) {
  if (state.objs[id]) setState('objs', id, patch as Obj)
  else setState('objs', id, { ...patch } as Obj)
}

function record(id: Id, patch: Partial<Obj>) {
  if (!persist) return
  const object = state.objs[id]
  // Text is always sent as CRDT operations, including task toggles and undo.
  if (object?.kind === 'card' && object.type === 'note' && 'content' in patch && !patch.purged) {
    if (!patch.kind) { const undo = noteUndo(id); undo.stopCapturing() }
    const text = noteDoc(id).getText('markdown')
    replaceText(text, noteMarkdown({ ...object, ...patch } as Card<'note'>), LOCAL_TEXT_ORIGIN)
    // Even an empty or unchanged copied note must carry its shared baseline.
    patch = { ...patch, noteUpdate: noteState(noteDoc(id)) }
    delete (patch as Partial<Card>).content
  }
  if ('noteState' in patch) { patch = { ...patch }; delete patch.noteState }
  if (patch.kind === 'board') localBoardCreations.add(id)
  dirtyObjs.add(id)
  const previous = { ...(outbox.get(id) ?? {}) } as Partial<Obj> & { noteRestore?: boolean }
  if (patch.purged) delete previous.noteRestore
  outbox.set(id, { ...previous, ...structuredClone(unwrap(patch)) } as Partial<Obj>)
  dirtyOutbox.add(id)
  scheduleFlush()
}

function applyTx(tx: Transaction) {
  batch(() => {
    for (const c of tx) {
      if (c.after.noteUpdate === 'undo' || c.after.noteUpdate === 'redo') {
        applyingTextUndo = true
        try { c.after.noteUpdate === 'undo' ? noteUndo(c.id).undo() : noteUndo(c.id).redo() } finally { applyingTextUndo = false }
        continue
      }
      const restoring = state.objs[c.id]?.purged && c.after.purged === false && c.after.kind === 'card' && c.after.type === 'note'
      // A deliberate creation redo restores the current shared text, including
      // peers' work. An old queued creation has no such restoration intent.
      const after = restoring ? { ...c.after, content: { md: noteDoc(c.id).getText('markdown').toString() } } as Partial<Obj> : c.after
      applyPatchToStore(c.id, after)
      record(c.id, restoring ? { ...after, noteRestore: true } as Partial<Obj> : after)
    }
  })
  for (const l of outboxListeners) l()
}

/** Apply a transaction and push it onto the undo stack. */
export function commit(tx: Transaction) {
  if (readOnly || previewing() || !tx.length || !layoutAllowed(tx)) return
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
  // CRDT text has its own origin-aware entry. Keeping a second whole-text
  // snapshot here would let a later undo erase another author's changes.
  const undoTx = tx.flatMap((c) => {
    const object = state.objs[c.id]
    if (object?.kind !== 'card' || object.type !== 'note' || c.before.purged || !('content' in c.after)) return [c]
    const before = { ...c.before } as Partial<Card>, after = { ...c.after } as Partial<Card>
    delete before.content; delete after.content
    return Object.keys(after).length ? [{ ...c, before, after }] : []
  })
  undoStack.push(undoTx)
  historyChanged()
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
    historyChanged()
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
    historyChanged()
  }
  silent({ [id]: { purged: true } })
}

/** Store only. Commit the final value with `commitFrom` when the gesture ends. */
export function transient(id: Id, patch: Partial<Obj>) {
  if (previewing()) return
  if (!canWriteObject(state.objs[id]) || !layoutAllowed([{ id, before: {}, after: patch }])) return
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
  if (!tx.length || !layoutAllowed(tx)) return false
  // Already in the store; persist + record undo.
  for (const c of tx) record(c.id, c.after)
  for (const l of outboxListeners) l()
  undoStack.push(tx)
  historyChanged()
  return true
}

/** Snapshot the given keys of an object (deep-cloned) for a later `commitFrom`. */
export function snapshot(id: Id, keys: string[]): Partial<Obj> {
  const o = unwrap(state.objs[id]) as unknown as Record<string, unknown>
  const s: Record<string, unknown> = {}
  for (const k of keys) s[k] = structuredClone(o?.[k] ?? null)
  return s as Partial<Obj>
}

function historyAllowed(tx: Transaction): boolean {
  if (readOnly || !layoutAllowed(tx)) return false
  return tx.every((change) => {
    const current = state.objs[change.id]
    if (!current || (writeGuard && !writeGuard(current))) return false
    if (current.kind !== 'card' || (current.purged && change.before.purged === true)) return true
    // Geometry undo is conditional: don't overwrite a newer collaborator move.
    return [...POSITION_FIELDS, 'h'].every((key) => !(key in change.after) || JSON.stringify((current as unknown as Record<string, unknown>)[key] ?? null) === JSON.stringify((change.before as Record<string, unknown>)[key] ?? null))
  })
}

export function undo() {
  if (previewing()) return
  const tx = undoStack.undo()
  if (tx && historyAllowed(tx)) applyTx(tx)
  else if (tx) { undoStack.redo(); showToast('Cannot undo because this item changed or is no longer editable.') }
  historyChanged()
}

export function redo() {
  if (previewing()) return
  const tx = undoStack.redo()
  if (tx && historyAllowed(tx)) applyTx(tx)
  else if (tx) { undoStack.undo(); showToast('Cannot redo because this item changed or is no longer editable.') }
  historyChanged()
}

function scheduleFlush() {
  flushTimer ??= setTimeout(() => void flush().catch(() => {}), 150)
}

export async function flush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (!persist) return
  if (dirtyObjs.size || dirtyOutbox.size) {
      const objIds = [...dirtyObjs]
      const outIds = [...dirtyOutbox]
      const objects: [string, unknown][] = objIds.map((id) => [id, structuredClone(unwrap(state.objs[id]))])
      const patches: [string, unknown][] = outIds.map((id) => [id, structuredClone(outbox.get(id))])
      dirtyObjs.clear()
      dirtyOutbox.clear()
      // Start the atomic IDB transaction now, even if an older save is pending.
      // IDB orders these transactions; a navigation need not run a continuation
      // in this page merely to start saving the newest input.
      const saving = idb.putDocument(objects, patches).then(() => {
        if (!dirtyObjs.size && !dirtyOutbox.size) setLocalSaveError(null)
        if (saves.size === 1 && !dirtyObjs.size && !dirtyOutbox.size) { try { sessionStorage.removeItem(NOTE_JOURNAL) } catch { /* IDB is already durable. */ } }
        setLastLocalSave(Date.now())
      }).catch((error) => {
        objIds.forEach((id) => dirtyObjs.add(id))
        outIds.forEach((id) => dirtyOutbox.add(id))
        setLocalSaveError('Changes could not be saved on this device. Keep this window open and retry.')
        throw error
      }).finally(() => saves.delete(saving))
      saves.add(saving)
  }
  await Promise.all([...saves])
  if (saves.size || dirtyObjs.size || dirtyOutbox.size) await flush()
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
      if (!(k in s.patch) || JSON.stringify(v ?? null) !== JSON.stringify((s.patch as Record<string, unknown>)[k] ?? null)) rest[k] = v
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
      if (row.noteState && row.kind === 'card' && row.type === 'note' && (notes.has(row.id) || outbox.get(row.id)?.noteUpdate)) {
        const document = noteDoc(row.id)
        if (composingNotes.has(row.id)) heldNoteStates.set(row.id, row.noteState)
        else Y.applyUpdate(document, decodeUpdate(row.noteState), REMOTE_ORIGIN)
        row.content = { md: document.getText('markdown').toString() }
        row.noteState = noteState(document)
      }
      // Someone else's private object (e.g. moved into their Toy box): the server
      // sends only a stub, and any copy on this device goes away.
      if ((row as { hidden?: boolean }).hidden) {
        notes.get(row.id)?.destroy(); notes.delete(row.id)
        noteUndos.get(row.id)?.destroy(); noteUndos.delete(row.id)
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
        // This pull can precede a push that acknowledges our queued fields while
        // the gesture is still busy. Preserve that committed overlay now, before
        // acknowledgment removes it from the outbox.
        deferred.set(row.id, { ...row, ...outbox.get(row.id) } as Obj)
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
  try {
    const journal = sessionStorage.getItem(NOTE_JOURNAL)
    if (journal) {
      const rows = JSON.parse(journal) as { id: string; object: Card<'note'>; patch: Partial<Obj>; state: string }[]
      const recovered: [string, Obj][] = [], pending: [string, Partial<Obj>][] = []
      for (const row of rows) {
        if (typeof row.id !== 'string' || row.object?.kind !== 'card' || row.object.type !== 'note' || typeof row.state !== 'string') throw new Error('Invalid recovery data')
        const document = noteDocument(map[row.id]?.noteState)
        try {
          if (out.get(row.id)?.noteUpdate) Y.applyUpdate(document, decodeUpdate(out.get(row.id)!.noteUpdate!))
          Y.applyUpdate(document, decodeUpdate(row.state))
          const state = noteState(document)
          recovered.push([row.id, { ...map[row.id], ...row.object, id: row.id, noteState: state, content: { md: document.getText('markdown').toString() } }])
          pending.push([row.id, { ...out.get(row.id), ...row.patch, noteUpdate: state } as Partial<Obj>])
        } finally { document.destroy() }
      }
      await idb.putDocument(recovered, pending)
      for (const [id, object] of recovered) map[id] = object
      for (const [id, patch] of pending) out.set(id, patch)
      sessionStorage.removeItem(NOTE_JOURNAL)
    }
  } catch { setLocalSaveError('A reload recovery copy could not be restored. Keep this tab open and retry local saving.') }
  setState('objs', map)
  for (const [id, p] of out) {
    // Protocol-2 replacements have no shared baseline. Keep a recovery draft;
    // replaying one would overwrite changes made since this device went away.
    const o = map[id]
    if (o?.kind === 'card' && o.type === 'note' && 'content' in p && !p.noteUpdate && !p.kind) {
      await idb.put('meta', `recovery:${id}`, { id, patch: p, object: o, reason: 'This draft was saved before collaborative editing. Copy the text into the updated note.', savedAt: Date.now() })
      delete (p as Partial<Card>).content
      await idb.put('outbox', id, Object.keys(p).length ? p : undefined)
    }
    if (Object.keys(p).length) outbox.set(id, p)
    if (p.kind === 'board') localBoardCreations.add(id)
  }
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
      notes.get(object.id)?.destroy(); notes.delete(object.id)
      noteUndos.get(object.id)?.destroy(); noteUndos.delete(object.id)
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
  try { sessionStorage.removeItem(NOTE_JOURNAL) } catch { /* No browser storage. */ }
  for (const id of composingNotes) setNoteComposing(id, false)
  for (const manager of noteUndos.values()) manager.destroy()
  noteUndos.clear()
  for (const document of notes.values()) document.destroy()
  notes.clear()
  outbox.clear()
  localBoardCreations.clear()
  setState('objs', {})
  await idb.clearAll()
}

// ---- indexes --------------------------------------------------------------

type Index = {
  stickers: Map<Id, Sticker[]>
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
    const stickers = new Map<Id, Sticker[]>()
    const cards = new Map<Id, Card[]>()
    const connections = new Map<Id, Connection[]>()
    const boards: Board[] = []
    const comments = new Map<Id, Comment[]>()
    const shown = overlay.objs
    const all = shown ? [...Object.values(state.objs).filter((o) => !(o.id in shown)), ...Object.values(shown)] : Object.values(state.objs)
    for (const o of all) {
      if (o.purged || o.deletedAt) continue
      if (o.kind === 'sticker') {
        const list = stickers.get(o.boardId)
        if (list) list.push(o)
        else stickers.set(o.boardId, [o])
      } else if (o.kind === 'card') {
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
    return { cards, stickers, connections, boards, comments }
  }),
)

export const cardsOn = (boardId: Id): Card[] => index().cards.get(boardId) ?? []
export const connectionsOn = (boardId: Id): Connection[] => index().connections.get(boardId) ?? []
export const commentsOn = (cardId: Id): Comment[] => index().comments.get(cardId) ?? []

/** Trashed (soft-deleted, not purged) cards on a board. Not memoised; read when the panel opens. */
export function trashedOn(boardId: Id): (Card | Sticker)[] {
  return Object.values(state.objs)
    .filter((o): o is Card | Sticker => (o.kind === 'card' || o.kind === 'sticker') && o.boardId === boardId && !!o.deletedAt && !o.purged)
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

export const stickersOn = (boardId: Id): Sticker[] => (index().stickers.get(boardId) ?? []).filter(usableSticker)
