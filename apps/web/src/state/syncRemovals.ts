import type { Obj } from '@doggynote/core'

/** Whether an incoming removal should preserve pending work as a recovery copy.
 * Explicit Undo/restore intent must survive a delayed deletion snapshot. */
export function removalWithoutRestore(object: Pick<Obj, 'deletedAt' | 'purged'> & { hidden?: boolean }, pending: Partial<Obj> | undefined): boolean {
  if (object.hidden) return true
  if (!object.deletedAt && !object.purged) return false
  // Undo of an originally absent purge flag writes null, rather than false.
  const restoring = pending?.noteRestore || (pending && 'deletedAt' in pending && pending.deletedAt === null) || (pending && 'purged' in pending && !pending.purged && !pending.noteUpdate)
  // Our own delete must still reach the server, including clearing private comment text.
  const removing = pending?.purged === true || (typeof pending?.deletedAt === 'number' && pending.deletedAt > 0)
  return !restoring && !removing
}
