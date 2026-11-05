import type { ClipperBoard, ImageSource } from '@doggynote/core'
export type Connection = { token: string; expiresAt: number; user: { id: string; username: string } }
export type Capture = { id: string; source: ImageSource; accountId?: string; assetId: string; boardId?: string; error?: string; status: 'selected' | 'ready' | 'saving' | 'saved' | 'error'; width?: number; height?: number }
export type PanelState = { connected: boolean; username?: string; capture?: Capture; lastBoardId?: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export async function command<T>(type: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type, ...args }) as Result<T>
  if (!result?.ok) throw new Error(result?.error || 'The clipper did not answer. Close and reopen the panel.')
  return result.value
}
export type BoardsResult = { boards: ClipperBoard[] }
