import type { Profile } from '@doggynote/core'
import type { Access } from './access.ts'

export async function commentProfiles(db: D1Database, comments: { kind?: string; authorId?: unknown; purged?: unknown }[]): Promise<Profile[]> {
  const ids = [...new Set(comments.filter(o => o.kind === 'comment' && !o.purged && typeof o.authorId === 'string').map(o => o.authorId as string))]
  const profiles: Profile[] = []
  for (let at = 0; at < ids.length; at += 90) {
    const chunk = ids.slice(at, at + 90)
    const { results } = await db.prepare(`SELECT id,username,display_name FROM users WHERE id IN (${chunk.map((_, i) => `?${i + 1}`).join(',')})`)
      .bind(...chunk).all<{ id: string; username: string; display_name: string | null }>()
    profiles.push(...results.map(r => ({ id: r.id, username: r.username, displayName: r.display_name })))
  }
  return profiles
}

/** Include unchanged authors on every pull, so renaming does not rewrite comments. */
export async function readableCommentProfiles(db: D1Database, access: Access, userId: string): Promise<Profile[]> {
  const { results } = await db.prepare("SELECT board_id,owner_id,json_extract(data,'$.authorId') AS author_id FROM objects WHERE kind='comment' AND COALESCE(json_extract(data,'$.purged'),0)=0").all<{ board_id: string; owner_id: string | null; author_id: string }>()
  return commentProfiles(db, results.filter(r => (!r.owner_id || r.owner_id === userId) && access.canRead(r.board_id)).map(r => ({ kind: 'comment', authorId: r.author_id })))
}
