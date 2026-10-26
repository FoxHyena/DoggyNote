import { DEFAULT_SIZE, cardLabel, isAlive, mdToText, findFreeSpot, newId, union, type Card, type Change, type Connection, type Rect } from '@doggynote/core'
import type { ChatTurn } from '@doggynote/core/chat'
import * as doc from '../state/doc.ts'
import { attachContext, contextLinks, openChat, syncChatChanges } from '../state/chats.ts'
import { createCard } from '../state/actions.ts'
import { API_BASE, api } from '../state/api.ts'
import { centrePlacement } from './Toolbar.tsx'
import { boardId } from '../state/ui.ts'
import { rectOf } from '../canvas/layout.ts'

function beside(rect: Rect) {
  const size = DEFAULT_SIZE.chat
  const spot = findFreeSpot({ x: rect.x + rect.w + 48, y: rect.y, ...size }, doc.cardsOn(boardId()).filter((c) => !c.columnId))
  return { at: { x: spot.x + size.w / 2, y: spot.y + 20 } }
}

export function askSelection(ids: string[]) {
  const sources = union(ids.map(rectOf).filter((rect): rect is Rect => !!rect))
  const chatId = createCard('chat', sources ? beside(sources) : centrePlacement('chat'), { edit: false })
  attachContext(chatId, ids)
  openChat(chatId)
}
const pendingBranches = new Map<string, string>()
export async function branchChat(chat: Card<'chat'>, turn?: ChatTurn) {
  const key = `${chat.id}:${turn?.id ?? 'clean'}`
  const pendingId = pendingBranches.get(key)
  const id = pendingId && isAlive(doc.getCard(pendingId)) ? pendingId : createCard('chat', beside(rectOf(chat.id) ?? chat), { edit: false, content: { title: turn ? `Alternative · ${chat.content.title}` : 'Clean conversation', provider: chat.content.provider } })
  if (!turn) {
    attachContext(id, contextLinks(chat.id).map((l) => l.from))
    openChat(id)
    return
  }
  pendingBranches.set(key, id)
  await syncChatChanges()
  await api(`/api/chats/${encodeURIComponent(chat.id)}/branch`, { method: 'POST', json: { targetId: id, messageId: turn.id } })
  // The inherited snapshot stays exact; current source links control only the next send.
  attachContext(id, turn.context.sources.map((s) => s.id))
  const provenance: Connection = { id: `branch-${id}`, kind: 'connection', boardId: chat.boardId, from: chat.id, to: id, arrow: 'end', createdAt: Date.now() }
  if (!doc.get(provenance.id)) doc.commit([doc.createChange(provenance)])
  pendingBranches.delete(key)
  openChat(id)
}
export async function saveChatAnswer(chat: Card<'chat'>, turn: ChatTurn, text: string) {
  if (!text.trim() || !turn.answer.includes(text) && !mdToText(turn.answer).includes(text)) throw new Error('Choose text from this answer to save.')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([chat.id, turn.id, text])))
  const id = `answer-${[...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2,'0')).join('').slice(0,48)}`
  const existing = doc.getCard(id)
  if (existing && !existing.purged && !existing.deletedAt) return id
  if (existing) { doc.update({ [id]: { purged: false, deletedAt: null } }); return id }
  if (!doc.canWriteObject(chat)) throw new Error('You need edit access to save this answer.')
  const size = DEFAULT_SIZE.note
  const at = findFreeSpot({ x: chat.x + chat.w + 40, y: chat.y, ...size }, doc.cardsOn(chat.boardId).filter((c) => !c.columnId))
  const note: Card<'note'> = { id, kind: 'card', type: 'note', boardId: chat.boardId, x: at.x, y: at.y, ...size, z: doc.maxZ(chat.boardId) + 1, color: 'none', createdAt: Date.now(), content: { md: `${text}\n\n---\n[From conversation](${API_BASE || location.origin}/#/b/${encodeURIComponent(chat.boardId)}?chat=${encodeURIComponent(chat.id)}&message=${encodeURIComponent(turn.id)}) · ${turn.provider === 'claude' ? 'Claude' : 'Codex'}` } }
  const conn: Connection = { id: newId(), kind: 'connection', boardId: chat.boardId, from: chat.id, to: id, arrow: 'end', createdAt: Date.now() }
  const tx: Change[] = [doc.createChange(note), doc.createChange(conn)]
  doc.commit(tx)
  return id
}
export const sourceLabel = (card: Card) => cardLabel(card, (id) => doc.getBoard(id)?.title || 'Board')
export const chatOnCurrentBoard = (card: Card) => card.boardId === boardId()
