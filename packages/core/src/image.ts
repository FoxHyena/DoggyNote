import type { Card } from './model.ts'

export const IMAGE_CAPTION_MAX = 10_000
export const IMAGE_SOURCE_MAX = 4096

/** Attribution is a web address, never a filesystem path, credential or executable URL. */
export function imageSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > IMAGE_SOURCE_MAX) return null
  const raw = value.trim()
  if (!/^https?:\/\//i.test(raw) || /[\s\\\u0000-\u001f\u007f]/.test(raw)) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.href
  } catch { return null }
}

/** Empty explicitly clears a legacy caption; malformed synced fields render safely. */
export function imageCaption(card: Card<'image'>): string {
  const value = card.imageCaption ?? card.content.caption
  return typeof value === 'string' ? value.slice(0, IMAGE_CAPTION_MAX) : ''
}

export function imageSourceHost(value: unknown): string {
  const url = imageSourceUrl(value)
  return url ? new URL(url).hostname.replace(/^www\./, '') : ''
}
