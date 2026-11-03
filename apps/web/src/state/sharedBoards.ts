type Shared = { id: string; parentId: string | null; ownerId: string | null; legacy: boolean; sharedAt?: number }

/**
 * The boards to list under "Shared with me": the topmost board of each shared
 * tree. A board is owned by whoever made it, so a friend's board inside one of
 * yours (or inside Shared space) is someone else's, yet already one tap away.
 * Only boards whose parent you can't open are entry points. Newest share first.
 */
export function sharedRoots<T extends Shared>(boards: readonly T[], userId: string | undefined, title: (b: T) => string): T[] {
  const readable = new Set(boards.map((b) => b.id))
  return boards
    .filter((b) => b.ownerId !== userId && !b.legacy && !b.id.startsWith('toybox:') && !b.id.startsWith('home:') && !(b.parentId && readable.has(b.parentId)))
    .sort((a, b) => (b.sharedAt ?? 0) - (a.sharedAt ?? 0) || title(a).localeCompare(title(b)))
}
