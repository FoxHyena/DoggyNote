import { tableFillVars } from '@doggynote/theme'

/** A tag's colours: the table's own tested fills, so a tag and a cell fill of one colour match (an unknown colour is 'none'). */
export function chipVars(color: unknown): Record<string, string> {
  const v = tableFillVars(color)
  return { '--chip-bg': v.bg, '--chip-text': v.text }
}
