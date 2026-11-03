import { isTableField } from '@doggynote/core'

// A table spreads its rows, columns and cells over thousands of top-level
// fields, and the server writes each key of a request. Keep one request to a
// bounded number of keys: a big object goes over consecutive pushes (the queue
// acknowledges only what each push carried, so the rest stays queued).

/** Changes per request. */
export const PUSH_CHUNK = 200
/** Keys (across all changes) per request; the server accepts 5000 per object. */
export const PUSH_KEY_BUDGET = 2000

/**
 * The next request's worth of `changes`, in order. `complete` is true when that
 * is all of them, whole. A single change over the budget is cut: its ordinary
 * fields and as many table fields as fit now, the remaining table fields next time.
 */
export function budgetChanges<C extends { id: string; patch: object }>(changes: C[], limit = PUSH_CHUNK, budget = PUSH_KEY_BUDGET): { send: C[]; complete: boolean } {
  const send: C[] = []
  let used = 0
  for (const change of changes) {
    if (send.length >= limit) return { send, complete: false }
    const keys = Object.keys(change.patch)
    if (used + keys.length <= budget) {
      send.push(change)
      used += keys.length
      continue
    }
    if (send.length) return { send, complete: false }
    const plain = keys.filter((key) => !isTableField(key))
    const table = keys.filter(isTableField)
    const take = [...plain, ...table.slice(0, Math.max(1, budget - plain.length))]
    const patch = Object.fromEntries(take.map((key) => [key, (change.patch as Record<string, unknown>)[key]])) as C['patch']
    send.push({ ...change, patch })
    return { send, complete: false }
  }
  return { send, complete: true }
}
