import type { CardContent, Id } from './model.ts'

/** Public development identity. The matching manifest key ships in the extension. */
export const CLIPPER_EXTENSION_ID = 'alhopgfihkeokgjmmplgjamgolaancnf'
export const CLIPPER_REDIRECT = `https://${CLIPPER_EXTENSION_ID}.chromiumapp.org/clipper`
export type ImageSource = { pageUrl: string; pageTitle: string; imageUrl: string }
export type ClipperBoard = { id: Id; title: string; path: string }
export type BoardInboxItem = {
  id: Id
  boardId: Id
  image: CardContent['image']
  source: ImageSource
  createdBy: string
  createdAt: number
  state: 'pending' | 'placed' | 'discarded'
  placedCardId?: Id
}
