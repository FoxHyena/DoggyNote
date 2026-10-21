import { createSignal } from 'solid-js'
import { unwrap } from 'solid-js/store'
import { builtinTemplate, duplicateObjects, findFreeSpot, isAlive, newId, type Board, type BuiltinTemplate, type Card, type DuplicateResult, type Id, type Obj } from '@doggynote/core'
import * as doc from './doc.ts'
import { api } from './api.ts'
import { canEditBoard, canReadBoard, homeBoardId } from './access.ts'
import { boardId, endEdit, openBoard, select, selection } from './ui.ts'
import { syncNow, syncState } from './sync.ts'
import { rectOf } from '../canvas/layout.ts'
import { showToast } from './toast.ts'

export const [duplicating, setDuplicating] = createSignal(false)
const origins = new Map<Id, Id>()
// Keyboard Undo has the same forgiving navigation as the toast action.
doc.onOutbox(() => {
  let current = doc.getBoard(boardId())
  const seen = new Set<Id>()
  // A tree copy can be undone while one of its nested boards is open. Follow
  // only purged canonical parents; a live ancestor or a cycle ends the search.
  while (current?.purged && !seen.has(current.id)) {
    seen.add(current.id)
    const origin = origins.get(current.id)
    if (origin) {
      openBoard(isAlive(doc.getBoard(origin)) ? origin : homeBoardId())
      return
    }
    current = doc.getBoard(current.parentId)
  }
})

async function completeSource(id: Id, signal?: AbortSignal): Promise<Obj[]> {
  endEdit()
  await syncNow()
  signal?.throwIfAborted()
  if (syncState() !== 'idle' || doc.outboxSize()) throw new Error('Connect and finish syncing before copying a board tree. Your original is safe.')
  const source = await api<{ objects: Obj[] }>(`/api/boards/${encodeURIComponent(id)}/copy-source`, { signal })
  signal?.throwIfAborted()
  return source.objects
}

/** Create the graph with one undo boundary; fresh objects never overwrite source fields. */
function install(result: DuplicateResult, extra: Obj[] = []) {
  const objects = [...result.objects, ...extra]
  if (!objects.length) throw new Error('Select a card to duplicate.')
  doc.commit(objects.map(doc.createChange))
  if (!objects.every((o) => isAlive(doc.get(o.id)))) throw new Error('Your access changed. No copy was created.')
}

function homeShortcut(root: Board): Card<'board'> {
  const home = homeBoardId()
  const spot = findFreeSpot({ x: 0, y: 0, w: 120, h: 120 }, doc.cardsOn(home))
  return { id: newId(), kind: 'card', type: 'board', boardId: home, x: spot.x, y: spot.y, w: 120, h: 120, z: doc.maxZ(home) + 1, color: root.color, content: { boardId: root.id }, createdAt: Date.now() }
}

/** Cards stay on the current board; canonical board cards carry their own tree. */
export async function duplicateSelection() {
  if (duplicating() || !selection().size) return
  const sourceBoard = boardId()
  if (!canEditBoard(sourceBoard)) return
  endEdit()
  const ids = [...selection()]
  setDuplicating(true)
  try {
    let source = structuredClone(unwrap(Object.values(doc.objs)))
    const selectedCards = doc.cardsOn(sourceBoard).filter((c) => ids.includes(c.id) || (c.columnId && ids.includes(c.columnId)))
    if (selectedCards.some((c) => c.type === 'board')) source = await completeSource(sourceBoard)
    if (!canEditBoard(sourceBoard)) throw new Error('Your access changed. No copy was created.')
    const positions: Record<Id, { x: number; y: number }> = {}
    for (const c of selectedCards) { const rect = rectOf(c.id); if (rect) positions[c.id] = { x: rect.x, y: rect.y } }
    const result = duplicateObjects(source, { selectionIds: ids, targetBoardId: sourceBoard, positions })
    let z = doc.maxZ(sourceBoard)
    for (const object of result.objects) if (object.kind === 'card' && object.boardId === sourceBoard) object.z = ++z
    install(result)
    if (boardId() === sourceBoard) select(result.selectedIds)
    showToast('Independent copy created. Discussion stays on the original.', 5000, { label: 'Undo', run: () => doc.undo() })
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not create the copy.', 6000)
  } finally { setDuplicating(false) }
}

export async function copyBoard(sourceId: Id, title: string, options: { template?: boolean; signal?: AbortSignal } = {}): Promise<Id> {
  if (!canReadBoard(sourceId)) throw new Error('This board is unavailable.')
  const source = await completeSource(sourceId, options.signal)
  return createPrivate(source, sourceId, title, options)
}

export function useBuiltin(id: BuiltinTemplate, title: string): Id {
  const source = builtinTemplate(id)
  return createPrivate(source.objects, source.rootId, title)
}

function createPrivate(source: Obj[], rootId: Id, title: string, options: { template?: boolean; signal?: AbortSignal } = {}): Id {
  options.signal?.throwIfAborted()
  const name = title.trim()
  if (!name) throw new Error('Give the new board a name.')
  if (!canEditBoard(homeBoardId())) throw new Error('Your personal home is unavailable. Try again after syncing.')
  const result = duplicateObjects(source, { rootBoardId: rootId, title: name })
  const root = result.objects.find((o): o is Board => o.id === result.rootId && o.kind === 'board')!
  if (options.template) root.templateName = name
  install(result, options.template ? [] : [homeShortcut(root)])
  return root.id
}

export function openCreatedBoard(id: Id, original: Id) {
  origins.set(id, original)
  openBoard(id)
  showToast('Private independent board created. Find it in your personal home.', 6000, { label: 'Undo', run: () => doc.undo() })
}
