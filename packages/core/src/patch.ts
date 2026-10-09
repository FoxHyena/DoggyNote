import type { Id, Obj } from './model.ts'

/**
 * One object's change. `before` holds the previous values of exactly the keys
 * in `after`, so applying `before` undoes it. Creating an object is
 * `before: { purged: true }`, `after: <whole object>`.
 */
export type Change = { id: Id; before: Partial<Obj>; after: Partial<Obj> }
export type Transaction = Change[]

export function invert(tx: Transaction): Transaction {
  return tx.map((c) => ({ id: c.id, before: c.after, after: c.before })).reverse()
}

/** Build a change from the current object and the fields to set. Unchanged keys are dropped. */
export function diff(current: Obj | undefined, next: Partial<Obj>): Change | null {
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  const cur = (current ?? {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(next)) {
    if (!sameValue(cur[k], v)) {
      before[k] = cur[k] ?? null
      after[k] = v
    }
  }
  if (!Object.keys(after).length) return null
  return { id: (current?.id ?? (next as Obj).id) as Id, before: before as Partial<Obj>, after: after as Partial<Obj> }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if ((a === undefined || a === null) && (b === undefined || b === null)) return true
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/** Merge patches for the same id so the outbox sends one patch per object. */
export function mergePatch<T extends Record<string, unknown>>(a: Partial<T>, b: Partial<T>): Partial<T> {
  return { ...a, ...b }
}

/** Apply a patch to an object. Missing keys stay; `null` clears. */
export function applyPatch(obj: Obj | undefined, patch: Partial<Obj>): Obj {
  return { ...(obj ?? {}), ...patch } as Obj
}

export class UndoStack {
  private done: Transaction[] = []
  private undone: Transaction[] = []

  private limit: number

  constructor(limit = 200) {
    this.limit = limit
  }

  push(tx: Transaction) {
    if (!tx.length) return
    this.done.push(tx)
    if (this.done.length > this.limit) this.done.shift()
    this.undone = []
  }

  /** Returns the transaction to apply to undo, or null. */
  undo(): Transaction | null {
    const tx = this.done.pop()
    if (!tx) return null
    this.undone.push(tx)
    return invert(tx)
  }

  redo(): Transaction | null {
    const tx = this.undone.pop()
    if (!tx) return null
    this.done.push(tx)
    return tx
  }

  /** Fold `patch` into the newest transaction's change for `id`. Returns false if it isn't there. */
  amendTop(id: string, patch: Record<string, unknown>): boolean {
    const top = this.done[this.done.length - 1]
    const c = top?.find((ch) => ch.id === id)
    if (!c) return false
    Object.assign(c.after, structuredClone(patch))
    return true
  }

  /** The newest transaction, if any (read-only peek). */
  peek(): Transaction | undefined {
    return this.done[this.done.length - 1]
  }

  dropTop() {
    this.done.pop()
  }

  get canUndo() {
    return this.done.length > 0
  }
  get canRedo() {
    return this.undone.length > 0
  }
}
