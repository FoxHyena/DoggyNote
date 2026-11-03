import { HOME_BOARD_ID, type Id } from '@doggynote/core'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import * as doc from './doc.ts'
import { canReadBoard } from './access.ts'
import { boardId, recentBoards } from './ui.ts'
import { boardPrefs, isFavourite } from './boardPrefs.ts'
import { favouriteIds, recentIds } from './boardLists.ts'
import { inTemplate } from './copies.ts'

// The boards you jump between: Favourites, Recent and a title search. Shared by
// the Boards menu and Fetch (⌘K), so both list the same boards the same way.

/** A board you can open right now: synced, not buried, not your Inbox. */
export const reachable = (id: Id) => !id.startsWith('toybox:') && !!doc.getBoard(id) && !doc.getBoard(id)!.deletedAt && canReadBoard(id)
export const boardTitle = (id: Id) => id === HOME_BOARD_ID ? COPY.home : boardDisplayTitle(doc.getBoard(id), id.startsWith('home') ? `My ${COPY.home}` : 'Untitled board')

/** Starred boards, in the order you starred them. */
export const favouriteBoards = () => favouriteIds(boardPrefs()).filter(reachable)
/** The last few boards you opened on any device, without the one you're on or your favourites. */
export const recentBoardIds = (limit = 5) => recentIds(boardPrefs(), recentBoards()).filter((id) => id !== boardId() && reachable(id) && !isFavourite(id)).slice(0, limit)

export type BoardMatch = { id: Id; title: string; parent: string; score: number }
/** Boards whose title contains the query; a title that starts with it ranks first. Templates stay in the template picker. */
export function searchBoards(query: string, limit = 30): BoardMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: BoardMatch[] = []
  for (const b of doc.index().boards) {
    if (b.id.startsWith('toybox:') || inTemplate(b.id)) continue
    const title = boardTitle(b.id)
    const at = title.toLowerCase().indexOf(q)
    if (at >= 0) out.push({ id: b.id, title, parent: b.parentId && doc.getBoard(b.parentId) ? boardTitle(b.parentId) : '', score: at === 0 ? 3 : 2 })
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}
