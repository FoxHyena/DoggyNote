// Dog-themed names for app concepts. One place, so the UI and tests agree.
export const COPY = {
  appName: 'DoggyNote',
  home: 'Doghouse',
  trash: 'Buried bones',
  unsorted: 'Inbox',
  search: 'Fetch',
  loading: 'Fetching…',
  allDone: 'Good dog!',
} as const

/** Reserved personal inboxes keep their IDs and legacy stored titles across upgrades. */
export function boardDisplayTitle(board: { id: string; title?: string | null } | null | undefined, fallback = 'Untitled board'): string {
  return board?.id.startsWith('toybox:') ? COPY.unsorted : board?.title || fallback
}
