// Dog-themed names for app concepts. One place, so the UI and tests agree.
export const COPY = {
  lookHere: 'Look here',
  appName: 'DoggyNote',
  home: 'Doghouse',
  trash: 'Buried bones',
  /** Where there's only room for a word (the phone dock). */
  trashShort: 'Bones',
  /** "Buried 3 cards" (toast after moving cards to the trash). */
  buried: 'Buried',
  /** The action that moves cards to the trash (a button label). */
  bury: 'Bury',
  unsorted: 'Inbox',
  search: 'Fetch',
  loading: 'Fetching…',
  allDone: 'Good dog!',
  /** The server didn't take a sync. Lead with what matters: nothing is lost. */
  syncSafe: "Your changes are safe on this device. We'll keep fetching until the server answers.",
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
  fetchHint: 'Sniff out any board, note, to-do or link by a word in it or a label on it.',
  telegramBot: {
    connect: [
      'Woof! 🐾 To connect, open DoggyNote → Stickers → Add pack → Send a sticker in Telegram, then use its connection link.',
      'Follow your nose! 🐶 To connect, open DoggyNote → Stickers → Add pack → Send a sticker in Telegram, then use its connection link.',
      'Ready for a sticker fetch? 🦴 To connect, open DoggyNote → Stickers → Add pack → Send a sticker in Telegram, then use its connection link.',
    ],
    confirm: [
      'Almost in the pack! 🐾 Return to DoggyNote and confirm your Telegram account. Then send one sticker here.',
      'One last pawprint! 🐶 Return to DoggyNote and confirm your Telegram account. Then send one sticker here.',
      'Found your trail! 🦴 Return to DoggyNote and confirm your Telegram account. Then send one sticker here.',
    ],
    connected: [
      'Welcome to the pack! 🐾 Connected to DoggyNote. Send one sticker from the pack you want to add.',
      'Leash clipped, ready to fetch! 🐶 Connected to DoggyNote. Send one sticker from the pack you want to add.',
      'Tail wags all round! 🦴 Connected to DoggyNote. Send one sticker from the pack you want to add.',
    ],
    expired: [
      'That trail went cold. 🐾 This connection link is unavailable or expired. In DoggyNote, cancel the connection and start again.',
      'This link wandered off. 🐶 This connection link is unavailable or expired. In DoggyNote, cancel the connection and start again.',
      'Time for a fresh sniff. 🦴 This connection link is unavailable or expired. In DoggyNote, cancel the connection and start again.',
    ],
    received: [
      'Fetched your sticker! 🐾 Return to DoggyNote to preview its pack and choose Add pack.',
      'A fresh find for the pack! 🦴 Return to DoggyNote to preview its pack and choose Add pack.',
      'Tail-wagging delivery! 🐶 Return to DoggyNote to preview its pack and choose Add pack.',
    ],
    missing: [
      'This sticker lost its pack tag. 🐾 It has no pack information. In DoggyNote, choose Add pack and paste a Telegram pack link instead.',
      'My nose needs another clue. 🐶 This sticker has no pack information. In DoggyNote, choose Add pack and paste a Telegram pack link instead.',
      'A loose sticker! 🦴 This sticker has no pack information. In DoggyNote, choose Add pack and paste a Telegram pack link instead.',
    ],
  },
  /** Board templates (the board "…" menu). */
  templates: 'Templates',
  templatesEmpty: 'No templates yet. Save a board as a template to teach it the trick.',
  templateSaved: 'Saved as a template. Good trick!',
  templateRemoved: 'Template removed.',
  /** Placeholder while typing an image's caption. */
  captionPlaceholder: 'Add a caption…',
  /** Placeholder for a colour card's name. */
  swatchNamePlaceholder: 'Name this shade…',
  /** Movie cards. */
  movieSearch: 'Sniff out a movie or show…',
  movieNoMatch: 'No scent of that one. Try another title?',
} as const

/** Reserved personal inboxes keep their IDs and legacy stored titles across upgrades. */
export function boardDisplayTitle(board: { id: string; title?: string | null } | null | undefined, fallback = 'Untitled board'): string {
  if (board?.id.startsWith('toybox:')) return COPY.unsorted
  // Titles are synced from other people's devices; anything but text is ignored.
  return typeof board?.title === 'string' && board.title ? board.title : fallback
}
