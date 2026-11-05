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
  /** Card colours by name, as people (and screen readers) say them. */
  colorNames: { none: 'No colour', gold: 'Gold', collar: 'Collar red', ball: 'Ball green', sky: 'Sky blue', lilac: 'Lilac', peach: 'Peach' } as Record<string, string>,
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
  /** The sketch editor's title field while the sketch has no name. */
  sketchTitlePlaceholder: 'Name this doodle',
  /** A mark drawn on the board grew past its size limit. */
  inkTooLong: 'That line ran out of leash. Lift, then keep drawing.',
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
  /** Synced copies of a note: one text on several cards. */
  synced: {
    /** Right-click and phone More menu action, next to Duplicate. */
    make: 'Make a synced copy',
    made: 'Synced copy made. To move it to another board, cut and paste it.',
    /** The marker on a synced card, and its dropdown's heading. */
    marker: 'Synced copies',
    markerHint: 'Synced note: edits update every copy. See where the copies are.',
    sameBoard: 'this board',
    close: 'Close synced copies',
    here: 'This copy',
    goTo: 'Go to',
    independent: 'Make an independent copy',
    independentHint: 'This card keeps its text and stops following the others.',
    madeIndependent: 'This copy goes its own way now. The others stay in sync.',
    gone: 'That copy has wandered off.',
    /** The server unsynced your copy: you can't edit every copy. */
    detached: "This note stopped syncing: you can't edit every copy. Your edit is kept here.",
  },
  /** The Boards menu: your Doghouse, recent boards and boards shared with you. */
  boards: {
    trigger: 'Boards',
    triggerHint: 'My boards and shared boards',
    heading: 'Your spaces',
    close: 'Close boards',
    rename: 'Rename current board',
    recent: 'Recent',
    favourites: 'Favourites',
    /** Beside a starred board in Fetch's suggestions. */
    favouriteTag: 'Favourite',
    find: 'Find a board',
    findPlaceholder: 'Sniff out a board…',
    findResults: 'Matching boards',
    /** "in Van Camper Conversion": the board a search result lives in. */
    inParent: 'in',
    noMatch: 'No board by that name.',
    favourite: 'Add to Favourites',
    unfavourite: 'Remove from Favourites',
    legacy: 'Shared space',
    legacyHint: 'Boards everyone from the original group can open and edit.',
    shared: 'Shared with me',
    sharedEmpty: 'Boards shared with your account will appear here.',
    /** A shared board's fallback title before its title has synced. */
    sharedUntitled: 'Shared board',
    viewOnly: 'View only',
    /** "Shared by luna": the avatar on a shared board's row. */
    sharedBy: 'Shared by',
    /** "Show all (12)": expands the shared list past its first few boards. */
    showAll: 'Show all',
  },
  /** Table cards: starter names, hints and the screen reader's words. */
  table: {
    label: 'Table',
    starterColumns: ['Name', 'Treats', 'Notes'],
    titlePlaceholder: 'Name this table',
    columnFallback: 'Column',
    /** Grid: aria-label for the editable grid. */
    gridLabel: 'Table',
    cellLabel: (row: number, column: string) => `Row ${row}, ${column}`,
    headerLabel: (column: number) => `Column ${column}`,
    addRow: 'Add row',
    addColumn: 'Add column',
    insertRowAbove: 'Insert row above',
    insertRowBelow: 'Insert row below',
    insertColumnLeft: 'Insert column left',
    insertColumnRight: 'Insert column right',
    deleteRows: (n: number) => (n === 1 ? 'Delete row' : `Delete ${n} rows`),
    deleteColumns: (n: number) => (n === 1 ? 'Delete column' : `Delete ${n} columns`),
    clear: 'Clear cells',
    cells: 'Table cells',
    previousCell: 'Previous cell',
    nextCell: 'Next cell',
    moreActions: 'More table actions',
    /** Shown at the row cap. */
    rowsFull: "This table's kennel is full: 100 rows is the most it can hold.",
    columnsFull: "This table's kennel is full: 26 columns is the most it can hold.",
    /** Live region text. */
    announceCell: (row: number, rows: number, column: string, value: string) => `Row ${row} of ${rows}, ${column}${value ? `: ${value}` : ', empty'}`,
    announceHeader: (column: string) => `Column header, ${column}`,
    announceRowAdded: 'Row added',
    announceColumnAdded: 'Column added',
    announceRowsDeleted: (n: number) => (n === 1 ? 'Row deleted' : `${n} rows deleted`),
    announceColumnsDeleted: (n: number) => (n === 1 ? 'Column deleted' : `${n} columns deleted`),
    announceCleared: 'Cells cleared',
    /** Row and column grips and their menus. */
    rowGrip: (row: number) => `Row ${row}: select, drag to move`,
    columnGrip: (name: string) => `${name || 'Column'}: select, drag to move`,
    columnMenu: (name: string) => `${name || 'Column'}: column actions`,
    columnActions: 'Column actions',
    rowActions: 'Row actions',
    resizeColumn: 'Resize column',
    /** Keyboard resize: the grip's tooltip says it, the live region reports the result. */
    columnGripTip: (name: string) => `${name || 'Column'}: select, drag to move · Alt+Shift+< > to resize`,
    announceResized: (name: string, percent: number) => `${name || 'Column'} is ${percent}% of the table`,
    announceResizeLimit: (wider: boolean) => (wider ? 'This column is already as wide as it can go' : 'This column is already as narrow as it goes'),
    renameColumn: 'Rename column',
    moveRowUp: 'Move up',
    moveRowDown: 'Move down',
    moveColumnLeft: 'Move left',
    moveColumnRight: 'Move right',
    duplicateRows: (n: number) => (n === 1 ? 'Duplicate row' : `Duplicate ${n} rows`),
    announceRowsSelected: (n: number) => (n === 1 ? 'Row selected' : `${n} rows selected`),
    announceColumnsSelected: (n: number) => (n === 1 ? 'Column selected' : `${n} columns selected`),
    announceMoved: 'Moved',
    announceDuplicated: 'Duplicated',
    announcePasted: (n: number) => (n === 1 ? 'Pasted 1 cell' : `Pasted ${n} cells`),
    announceCopied: 'Copied',
    announceCut: 'Cut',
    /** A paste that didn't all fit. */
    pasteClipped: "That didn't all fit: this table's kennel holds 100 rows and 26 columns, so the rest stayed in the bag.",
    /** A table with nothing in it to look at. */
    empty: 'An empty bowl. Add a column to start.',
    /** Column types. The select type is a tag; ratings are paws. */
    types: { text: 'Text', number: 'Number', checkbox: 'Checkbox', date: 'Date', select: 'Tag', rating: 'Paws' },
    columnType: 'Column type',
    /** Sorting a column, worded for what it holds. */
    sort: 'Sort',
    sortLabel: (type: string, dir: 'asc' | 'desc') => {
      if (type === 'number' || type === 'rating') return dir === 'asc' ? 'Sort 1 to 9' : 'Sort 9 to 1'
      if (type === 'date') return dir === 'asc' ? 'Oldest first' : 'Newest first'
      if (type === 'checkbox') return dir === 'asc' ? 'Unticked first' : 'Ticked first'
      return dir === 'asc' ? 'Sort A to Z' : 'Sort Z to A'
    },
    announceSorted: 'Sorted',
    /** The arrow a sorted column keeps in its header. Its name is the header's aria-sort; this is the tooltip. */
    sortedBy: (dir: 'asc' | 'desc') => (dir === 'asc' ? 'Sorted A to Z. Editing does not re-sort.' : 'Sorted Z to A. Editing does not re-sort.'),
    /** A quiet line outside a brand-new table, until a first cell is filled (or it has been seen three times). */
    firstRunHint: 'Type to fill · Tab for the next cell · drag ⋮⋮ to reorder',
    firstRunHintTouch: 'Tap to fill · ‹ › below for the next cell',
    announceType: (name: string) => `Column is now ${name}`,
    /** Formatting. */
    bold: 'Bold',
    align: 'Align',
    alignLeft: 'Align left',
    alignCentre: 'Align centre',
    alignRight: 'Align right',
    alignCellDefault: 'Column default',
    alignColumnDefault: 'Automatic',
    fill: 'Fill',
    fillRows: 'Row fill',
    announceFilled: 'Fill changed',
    announceAligned: 'Alignment changed',
    announceBold: (on: boolean) => (on ? 'Bold' : 'Not bold'),
    /** Tags. */
    findOption: 'Sniff out an option…',
    createOption: (name: string) => `Create "${name}"`,
    noOptions: 'No options yet. Type a name to bury the first.',
    clearValue: 'Clear',
    optionsFull: "This column's kennel of options is full: 50 is the most it can hold.",
    editOptions: 'Edit options',
    optionName: 'Option name',
    optionColour: (name: string) => `Colour for ${name || 'this option'}`,
    moveOptionUp: 'Move option up',
    moveOptionDown: 'Move option down',
    deleteOption: 'Delete option',
    addOption: 'Add an option',
    optionDeleted: (name: string) => `Removed “${name}”`,
    optionTaken: 'Another option already answers to that name.',
    announceOptionAdded: (name: string) => `Added ${name}`,
    /** Ticks, paws and dates. */
    ticked: 'Ticked',
    unticked: 'Not ticked',
    /** A tick box's name: its column, then the row's first cell. Its state is the box's own to say. */
    checkLabel: (column: string, who: string) => `${column}, ${who}`,
    pawsLabel: (n: number) => (n === 0 ? 'No paws' : n === 1 ? '1 of 5 paws' : `${n} of 5 paws`),
    pawLabel: (n: number) => (n === 1 ? '1 paw' : `${n} paws`),
    pickDate: 'Pick a date',
    done: 'Done',
  },
  /** The public guides at /docs. */
  guides: {
    /** Account menu and sign-in link. */
    open: 'Guides',
    signIn: 'New here? Read the guides',
    heading: 'Learn a few new tricks.',
    search: 'Sniff out a guide',
    noMatch: 'No scent of that one.',
    notFound: 'This guide has gone walkies.',
  },
} as const

/** Reserved personal inboxes keep their IDs and legacy stored titles across upgrades. */
export function boardDisplayTitle(board: { id: string; title?: string | null } | null | undefined, fallback = 'Untitled board'): string {
  if (board?.id.startsWith('toybox:')) return COPY.unsorted
  // Titles are synced from other people's devices; anything but text is ignored.
  return typeof board?.title === 'string' && board.title ? board.title : fallback
}
