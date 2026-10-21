import { DEFAULT_SIZE, collectClip, findFreeSpot, materialise, newId, withoutLabelTombstones, type Board, type Card, type Id, type Obj, type Vec } from '@doggynote/core'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import { unwrap } from 'solid-js/store'
import * as doc from './doc.ts'
import { boardPermissions, canEditBoard, canReadBoard, homeBoardId } from './access.ts'
import { user } from './session.ts'
import { boardId, openBoard } from './ui.ts'
import { showToast } from './toast.ts'

// Whole-board copies: Duplicate board, Save as template, New board from a
// template. All three reuse the clipboard's deep copy (packages/core/src/clip.ts):
// every board inside comes along, comments stay behind, and the board objects
// carry their label definitions, so labels survive without remapping.
//
// A template is a private board of your own: `template: true`, no parent and no
// board card, so it shows up nowhere but the template picker. The server's
// access rules keep it yours (a new parentless board belongs to its creator),
// which is what keeps a Toy box saved as a template private (rule 10).

/** Bigger than the clipboard's limit: a board copy never leaves the app. */
const BOARD_COPY_LIMIT = 3000
const TOO_BIG = 'That board is too big to copy in one go.'

type Template = Board & { template?: boolean }
const isTemplate = (b: Board | undefined): b is Template => !!b && (b as Template).template === true && !b.parentId && !b.deletedAt && !b.purged

/** Whether a board is a template or inside one, so search and lists can skip it. */
export function inTemplate(id: Id | null | undefined): boolean {
  const seen = new Set<Id>()
  let b = doc.getBoard(id)
  while (b && !seen.has(b.id)) {
    if (isTemplate(b)) return true
    seen.add(b.id)
    b = doc.getBoard(b.parentId)
  }
  return false
}

/** Your templates, newest first. Only boards you own: a template shared with you isn't yours to reuse. */
export function templates(): Template[] {
  const me = user()?.id
  const owned = new Set(boardPermissions().filter((p) => p.ownerId === me).map((p) => p.id))
  return doc.index().boards.filter((b): b is Template => isTemplate(b) && (owned.has(b.id) || doc.localBoardCreations.has(b.id))).sort((a, b) => b.createdAt - a.createdAt)
}

/** Copy board `rootId` and everything inside it, with a board card for it on `onBoard` centred at `at`. */
function copyTree(rootId: Id, onBoard: Id, at: Vec, like?: Card) {
  const root = doc.getBoard(rootId)
  if (!root) return null
  const size = like ? { w: like.w, h: like.h } : DEFAULT_SIZE.board
  const fake = { id: '__board-copy__', kind: 'card', type: 'board', boardId: onBoard, x: 0, y: 0, ...size, z: 0, color: like?.color ?? 'none', content: { boardId: rootId }, createdAt: 0 } as Card<'board'>
  const all = () => Object.values(unwrap(doc.objs))
  const clip = collectClip([fake.id], { get: (id) => (id === fake.id ? fake : unwrap(doc.get(id))), all, rect: () => null }, { limit: BOARD_COPY_LIMIT })
  if (!clip) return null
  if (clip === 'too-big') {
    showToast(TOO_BIG)
    return null
  }
  const made = materialise(clip, { at, boardId: onBoard, maxZ: doc.maxZ(onBoard), now: Date.now(), newId })
  const objects = made.objects.map((o) => withoutLabelTombstones(o) as Obj)
  const card = objects.find((o) => o.id === made.roots[0]) as Card<'board'>
  // The caller names and places the new board through this same object.
  const board = objects.find((o) => o.id === card.content.boardId) as Template
  delete board.template
  return { objects, card, board }
}

/** A free spot on `on` for a board card, near `near` (or the board's top left). */
function spotOn(on: Id, near?: Card): Vec {
  const size = near ? { w: near.w, h: near.h || DEFAULT_SIZE.board.h } : DEFAULT_SIZE.board
  const taken = doc.cardsOn(on).filter((k) => !k.columnId).map((k) => ({ x: k.x, y: k.y, w: k.w, h: k.h || 80 }))
  const want = near ? { x: near.x + near.w + 24, y: near.y } : { x: 0, y: 0 }
  const spot = findFreeSpot({ ...want, ...size }, taken)
  return { x: spot.x + size.w / 2, y: spot.y + size.h / 2 }
}

// Undo of a copy you're standing in takes you back where you came from.
const origins = new Map<Id, Id>()
doc.onOutbox(() => {
  const here = doc.getBoard(boardId())
  const back = here?.purged ? origins.get(here.id) : undefined
  if (back) openBoard(canReadBoard(back) && !doc.getBoard(back)?.purged ? back : homeBoardId())
})

function land(created: { objects: Obj[]; board: Board }, from: Id, message: string) {
  doc.commit(created.objects.map((o) => doc.createChange(o)))
  if (!doc.getBoard(created.board.id)) {
    showToast('Couldn’t make the copy here.')
    return
  }
  origins.set(created.board.id, from)
  openBoard(created.board.id)
  showToast(message, 6000, { label: 'Undo', run: () => doc.undo() })
}

/** The board card that opens `id` on its parent, if there is one. */
const cardFor = (id: Id, parent: Id | null | undefined) => (parent ? doc.cardsOn(parent).find((c) => c.type === 'board' && (c as Card<'board'>).content.boardId === id) : undefined)

/** Personal home boards and Toy boxes are one of a kind. */
export const canDuplicate = (id: Id) => !id.startsWith('home:') && !id.startsWith('toybox:') && canReadBoard(id) && !!doc.getBoard(id)?.parentId

/**
 * A copy next to the original, on the same parent board (or your home if you
 * can't add to that one), then opens it.
 */
export function duplicateBoard(id: Id) {
  const source = doc.getBoard(id)
  if (!source || !canDuplicate(id)) return
  const parent = source.parentId && canEditBoard(source.parentId) ? source.parentId : homeBoardId()
  const like = cardFor(id, parent)
  const created = copyTree(id, parent, spotOn(parent, like), like)
  if (!created) return
  created.board.title = `${boardDisplayTitle(source, 'Untitled board')} copy`
  land(created, id, `Duplicated ${boardDisplayTitle(source, 'the board')}.`)
}

/** A private template of this board, named after it. Stays where you are. */
export function saveAsTemplate(id: Id) {
  const source = doc.getBoard(id)
  if (!source || !canReadBoard(id)) return
  const created = copyTree(id, homeBoardId(), { x: 0, y: 0 })
  if (!created) return
  // No parent and no card: it lives only in the template picker.
  const objects = created.objects.filter((o) => o.id !== created.card.id)
  const board = created.board as Template
  board.parentId = null
  board.template = true
  board.title = boardDisplayTitle(source, 'Untitled board')
  doc.commit(objects.map((o) => doc.createChange(o)))
  if (!doc.getBoard(board.id)) return showToast('Couldn’t save the template.')
  showToast(COPY.templateSaved, 5000, { label: 'Undo', run: () => doc.undo() })
}

/** A new board from a template, as a board card on `onBoard` (or your home if you can't add there), then opens it. */
export function boardFromTemplate(templateId: Id, onBoard: Id, at?: Vec) {
  const template = doc.getBoard(templateId)
  if (!isTemplate(template)) return
  const target = canEditBoard(onBoard) && !inTemplate(onBoard) ? onBoard : homeBoardId()
  const created = copyTree(templateId, target, at && target === onBoard ? at : spotOn(target))
  if (!created) return
  created.board.title = boardDisplayTitle(template, 'Untitled board')
  land(created, boardId(), `New board from ${created.board.title}.`)
}

/** Removes a template from the picker; Undo brings it back. */
export function removeTemplate(id: Id) {
  if (!isTemplate(doc.getBoard(id))) return
  doc.update({ [id]: { deletedAt: Date.now() } })
  showToast(COPY.templateRemoved, 5000, { label: 'Undo', run: () => doc.undo() })
}
