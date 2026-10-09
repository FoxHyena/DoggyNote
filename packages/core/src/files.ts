// File cards: size limit, what kind of file it is, and human-readable sizes.

/** Largest upload. The server enforces it too. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

export type FileKind = 'pdf' | 'doc' | 'sheet' | 'slides' | 'zip' | 'audio' | 'video' | 'image' | 'text' | 'other'

const BY_EXT: Record<string, FileKind> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', pages: 'doc', rtf: 'doc', odt: 'doc',
  xls: 'sheet', xlsx: 'sheet', numbers: 'sheet', csv: 'sheet', ods: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides', odp: 'slides',
  zip: 'zip', rar: 'zip', '7z': 'zip', gz: 'zip', tar: 'zip', dmg: 'zip',
  txt: 'text', md: 'text', json: 'text',
}

export function fileKind(mime: string, name: string): FileKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (BY_EXT[ext]) return BY_EXT[ext]
  if (mime === 'application/pdf') return 'pdf'
  const top = mime.split('/')[0]
  if (top === 'audio' || top === 'video' || top === 'image') return top
  if (top === 'text') return 'text'
  return 'other'
}

/** 950 B, 12 KB, 3.4 MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  const mb = n / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}
