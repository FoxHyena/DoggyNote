/** One person's shortcuts for one board. favoriteAt is when it was starred; null when it isn't. */
export type BoardPref = { favoriteAt: number | null; openedAt: number | null }
export type BoardPrefs = Record<string, BoardPref>
/** Changes made on this device that the server hasn't confirmed yet. */
export type PendingPrefs = Record<string, { favorite?: boolean; opened?: true }>

/** Favourites in the order they were starred. */
export function favouriteIds(prefs: BoardPrefs): string[] {
  return Object.entries(prefs).filter(([, p]) => p.favoriteAt != null).sort(([, a], [, b]) => a.favoriteAt! - b.favoriteAt!).map(([id]) => id)
}

/** Most recently opened first, on any device. Boards only this device's older list remembers come after. */
export function recentIds(prefs: BoardPrefs, deviceRecent: readonly string[]): string[] {
  const timed = Object.entries(prefs).filter(([, p]) => p.openedAt != null).sort(([, a], [, b]) => b.openedAt! - a.openedAt!).map(([id]) => id)
  return [...timed, ...deviceRecent.filter((id) => !(id in prefs && prefs[id].openedAt != null))]
}

/**
 * The server is the truth for favourites (an unstar on your phone reaches your Mac), except for
 * changes this device hasn't sent yet. Open times keep whichever is newer. A board the server
 * no longer returns (a revoked share) drops out unless this device still has news for it.
 */
export function mergePrefs(local: BoardPrefs, server: BoardPrefs, pending: PendingPrefs, now = Date.now()): BoardPrefs {
  const merged: BoardPrefs = {}
  for (const id of new Set([...Object.keys(server), ...Object.keys(pending)])) {
    const s = server[id], l = local[id], p = pending[id]
    const favoriteAt = p?.favorite === undefined ? s?.favoriteAt ?? null : p.favorite ? s?.favoriteAt ?? l?.favoriteAt ?? now : null
    const opened = [s?.openedAt, p?.opened ? l?.openedAt : null].filter((t): t is number => t != null)
    merged[id] = { favoriteAt, openedAt: opened.length ? Math.max(...opened) : null }
  }
  return merged
}
