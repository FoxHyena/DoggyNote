// Dog-themed names for app concepts. One place, so the UI and tests agree.
export const COPY = {
  appName: 'DoggyNote',
  home: 'Doghouse',
  trash: 'Buried bones',
  unsorted: 'Inbox',
  search: 'Fetch',
  loading: 'Fetching…',
  allDone: 'Good dog!',
  /** Touch hints and moments. */
  connectHint: 'Tap another card to tie them together.',
  emptyTouch: 'Double-tap anywhere for a note, or tap + below.',
  emptyHintTouch: 'Pinch to zoom, drag to look around. Tap a card to pick it up.',
  fetchedToInbox: "Fetched! It's in your Inbox.",
  inboxEmpty: 'Nothing to chew on yet. Jot something down, or share a link here from another app.',
  buriedEmpty: 'No bones buried. Good dog.',
  installTitle: 'Keep DoggyNote on your phone',
} as const

/** Reserved personal inboxes keep their IDs and legacy stored titles across upgrades. */
export function boardDisplayTitle(board: { id: string; title?: string | null } | null | undefined, fallback = 'Untitled board'): string {
  return board?.id.startsWith('toybox:') ? COPY.unsorted : board?.title || fallback
}
