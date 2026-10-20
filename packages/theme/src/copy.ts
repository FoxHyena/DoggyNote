// Dog-themed names for app concepts. One place, so the UI and tests agree.
export const COPY = {
  appName: 'DoggyNote',
  home: 'Doghouse',
  trash: 'Buried bones',
  /** Where there's only room for a word (the phone dock). */
  trashShort: 'Bones',
  /** "Buried 3 cards" (toast after moving cards to the trash). */
  buried: 'Buried',
  unsorted: 'Inbox',
  search: 'Fetch',
  loading: 'Fetching…',
  allDone: 'Good dog!',
  /** Touch hints and moments. */
  connectHint: 'Tap another card to tie them together.',
  emptyTouch: 'Double-tap anywhere for a note, or tap + below.',
  emptyTouchTablet: 'Double-tap anywhere for a note, or tap a tool on the left.',
  emptyHintTouch: 'Pinch to zoom, drag to look around. Tap a card to pick it up.',
  fetchedToInbox: "Fetched! It's in your Inbox.",
  inboxEmpty: 'Nothing to chew on yet. Jot something down, or share a link here from another app.',
  buriedEmpty: 'No bones buried. Good dog.',
  installTitle: 'Keep DoggyNote on your phone',
  /** A card made by a newer DoggyNote than this one. */
  unknownCard: 'This card needs a newer DoggyNote. Update to see it.',
  fetchHint: 'Sniff out any board, note, to-do or link by a word in it.',
} as const

/** Reserved personal inboxes keep their IDs and legacy stored titles across upgrades. */
export function boardDisplayTitle(board: { id: string; title?: string | null } | null | undefined, fallback = 'Untitled board'): string {
  if (board?.id.startsWith('toybox:')) return COPY.unsorted
  // Titles are synced from other people's devices; anything but text is ignored.
  return typeof board?.title === 'string' && board.title ? board.title : fallback
}
