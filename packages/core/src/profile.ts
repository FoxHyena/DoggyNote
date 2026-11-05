/** Public identity; usernames remain the stable sign-in and invitation handle. */
export type Profile = { id: string; username: string; displayName?: string | null }
export const DISPLAY_NAME_MAX = 64
export const profileName = (profile: { username: string; displayName?: string | null }) => profile.displayName?.trim() || profile.username

/** null clears the name; undefined indicates invalid input. */
export function normalizeDisplayName(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) return undefined
  const name = value.trim()
  return name.length <= DISPLAY_NAME_MAX ? name || null : undefined
}
