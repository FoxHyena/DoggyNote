import { cardColorVars } from '@doggynote/theme'

/** A tag's colours: the tested card pairs, through cardColorVars (an unknown colour is 'none'). */
export function chipVars(color: unknown): Record<string, string> {
  const v = cardColorVars(color)
  return { '--chip-bg': v.bg, '--chip-text': v.text }
}
