import { DEFAULT_SIZE, boardMoveFamily, cardLabelIds, relabelPatch, isAlive, newId, planBoardMove, rankMoveBoards, type Board, type BoardMovePlacement, type Card, type Id, type Obj } from '@doggynote/core'
import { boardDisplayTitle } from '@doggynote/theme'
import * as doc from './doc.ts'
import { canManageBoard, canReadBoard } from './access.ts'
import { inTemplate } from './copies.ts'
import { rectOf } from '../canvas/layout.ts'
import { labelsOn, labelPlan } from './labels.ts'
import { boardId, endEdit, select, selection } from './ui.ts'
import { showToast } from './toast.ts'

const objects = () => Object.values(doc.objs)
export const moveFamily = (ids: Iterable<Id>) => boardMoveFamily(objects(), ids)
export function moveSelectionProblem(ids: Iterable<Id>): string | null {
  const family = moveFamily(ids)
  if (!family.roots.length) return 'Select an item to move.'
  // A temporary empty destination lets the same planner check containers, locks and management.
  const candidate: Board = { id: '__move_preflight__', kind: 'board', parentId: null, title: '', icon: 'paw', color: 'gold', createdAt: 0 }
  const plan = planBoardMove({ objects: [...objects(), candidate], ids: family.roots.map(o => o.id), destination: candidate.id, rect: rectOf, canWrite: o => o.id === candidate.id || doc.canWriteObject(o), canManage: canManageBoard })
  return plan.ok ? null : plan.reason
}
export function moveDestinationProblem(ids: Iterable<Id>, destination: Id): string | null {
  const target = doc.getBoard(destination)
  if (!target || !isAlive(target) || destination.startsWith('toybox:') || inTemplate(destination) || !canReadBoard(destination)) return 'This board is not available as a destination.'
  const plan = planBoardMove({ objects: objects(), ids, destination, rect: rectOf, canWrite: doc.canWriteObject, canManage: canManageBoard })
  return plan.ok ? null : plan.reason
}
export function moveDestinations(ids: readonly Id[], query: string) {
  const family = moveFamily(ids)
  const movedBoards = new Set(family.items.flatMap(o => o.kind === 'card' && o.type === 'board' ? [(o.content as { boardId: Id }).boardId] : []))
  const source = family.roots[0]?.boardId
  const eligible = doc.index().boards.filter(b => {
    if (b.id === source || b.id.startsWith('toybox:') || inTemplate(b.id) || !canReadBoard(b.id) || !doc.canWriteObject(b)) return false
    const seen = new Set<Id>()
    let ancestor: Board | undefined = b
    while (ancestor && !seen.has(ancestor.id)) {
      if (movedBoards.has(ancestor.id)) return false
      seen.add(ancestor.id); ancestor = doc.getBoard(ancestor.parentId)
    }
    return !ancestor
  })
  const localIds = new Set(doc.cardsOn(source ?? boardId()).flatMap(c => c.type === 'board' ? [(c.content as { boardId: Id }).boardId] : []))
  return rankMoveBoards(eligible, localIds, query)
}
export function moveBoardPath(board: Board): string {
  const parts: string[] = [], seen = new Set<Id>([board.id])
  let parent = doc.getBoard(board.parentId)
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id); parts.unshift(boardDisplayTitle(parent, 'Untitled board')); parent = doc.getBoard(parent.parentId)
  }
  return parts.join(' / ')
}
export type MoveResult = { ok: true; destination: Id; ids: Id[] } | { ok: false; reason: string }
export function moveItemsToBoard(ids: Iterable<Id>, destination: Id, opts: { placement?: BoardMovePlacement; allowInbox?: boolean; created?: Board; tile?: Card<'board'>; notify?: boolean } = {}): MoveResult {
  endEdit()
  const selected = [...ids], all = objects()
  if (opts.created) all.push(opts.created)
  if (!opts.created && !opts.allowInbox) {
    const problem = moveDestinationProblem(selected, destination)
    if (problem) return { ok: false, reason: problem }
  }
  const plan = planBoardMove({ objects: all, ids: selected, destination, rect: rectOf, placement: opts.placement, canWrite: o => o.id === opts.created?.id || doc.canWriteObject(o), canManage: canManageBoard })
  if (!plan.ok) return plan
  const movedCards = plan.ids.flatMap(id => { const c = doc.getCard(id); return c ? [c] : [] })
  const sourceLabels = labelsOn(plan.source), usedLabels = new Set(movedCards.flatMap(cardLabelIds))
  const { plan: labels, defs } = labelPlan(sourceLabels, movedCards, destination)
  if (sourceLabels.some(label => usedLabels.has(label.id) && !labels.map.has(label.id))) return { ok: false, reason: 'This board has no room for the items’ labels. Remove an unused label or choose another board.' }
  for (const c of movedCards) plan.patches[c.id] = { ...plan.patches[c.id], ...relabelPatch(c, labels) } as Partial<Obj>
  if (defs) plan.patches[destination] = { ...plan.patches[destination], ...defs } as Partial<Obj>
  const created = opts.created ? { ...opts.created, ...plan.patches[destination] } as Board : null
  if (created) delete plan.patches[destination]
  doc.commit([...(created ? [doc.createChange(created)] : []), ...(opts.tile ? [doc.createChange(opts.tile)] : []), ...doc.changesFor(plan.patches)])
  if (plan.ids.some(id => (doc.get(id) as Card | undefined)?.boardId !== destination)) return { ok: false, reason: 'The items could not be moved. Check permissions and position locks.' }
  select([...selection()].filter(id => !plan.ids.includes(id) && doc.get(id)?.kind !== 'connection'))
  if (opts.notify !== false) showToast(`Moved ${plan.roots.length} ${plan.roots.length === 1 ? 'item' : 'items'} to ${boardDisplayTitle(doc.getBoard(destination), 'Untitled board')}`, 5000, { label: 'Undo', run: () => doc.undo() })
  return { ok: true, destination, ids: plan.ids }
}
export function moveItemsToNewBoard(ids: readonly Id[], title: string): MoveResult {
  if (!title.trim()) return { ok: false, reason: 'Give the board a name.' }
  const family = moveFamily(ids), source = family.roots[0]?.boardId
  if (!source || !doc.canWriteObject(doc.getBoard(source))) return { ok: false, reason: 'You cannot create a board here.' }
  const bounds = family.roots.map(o => rectOf(o.id) ?? o)
  const now = Date.now(), id = newId()
  const created: Board = { id, kind: 'board', parentId: source, title: title.trim(), icon: 'paw', color: 'gold', createdAt: now }
  const tile: Card<'board'> = { id: newId(), kind: 'card', type: 'board', boardId: source, x: Math.min(...bounds.map(r => r.x)), y: Math.min(...bounds.map(r => r.y)), ...DEFAULT_SIZE.board, z: doc.maxZ(source) + 1, color: 'none', content: { boardId: id }, createdAt: now }
  return moveItemsToBoard(ids, id, { created, tile })
}
