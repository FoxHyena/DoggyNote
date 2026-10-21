import { Hono } from 'hono'
import type { Obj } from '@doggynote/core'
import { isAlive } from '@doggynote/core'
import type { AppEnv } from './env.ts'
import { loadAccess } from './access.ts'

export const copies = new Hono<AppEnv>()

/**
 * A complete canonical snapshot, rather than the possibly partial local cache.
 * No comments, grants or public links. An inaccessible child fails the entire
 * operation without disclosing its identity; shortcuts are never traversed.
 */
copies.get('/boards/:id/copy-source', async (c) => {
  c.header('cache-control', 'no-store')
  const rootId = c.req.param('id')
  const access = await loadAccess(c.env.DB, c.get('user'))
  if (!access.canRead(rootId)) return c.json({ error: 'This board is unavailable.' }, 403)
  const { results } = await c.env.DB.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM objects WHERE id=?1 AND kind='board'
        AND COALESCE(json_extract(data,'$.deletedAt'),0)=0 AND COALESCE(json_extract(data,'$.purged'),0)=0
      UNION
      SELECT o.id FROM objects o JOIN tree t ON json_extract(o.data,'$.parentId')=t.id
        WHERE o.kind='board' AND COALESCE(json_extract(o.data,'$.deletedAt'),0)=0 AND COALESCE(json_extract(o.data,'$.purged'),0)=0
    )
    SELECT data,owner_id FROM objects WHERE kind!='comment' AND
      ((kind='board' AND id IN (SELECT id FROM tree)) OR board_id IN (SELECT id FROM tree))
  `).bind(rootId).all<{ data: string; owner_id: string | null }>()
  const objects: Obj[] = []
  for (const row of results) {
    const object = JSON.parse(row.data) as Obj
    if (!isAlive(object)) continue
    if ((row.owner_id && row.owner_id !== c.get('user').id) || !access.canRead(object.kind === 'board' ? object.id : object.boardId)) {
      return c.json({ error: 'The complete board tree is not available to copy. No copy was created.' }, 403)
    }
    if (object.kind === 'card' && object.type === 'board') {
      const target = (object.content as { boardId: string }).boardId
      if (!access.canRead(target)) return c.json({ error: 'A linked board is unavailable. No copy was created.' }, 403)
    }
    objects.push(object)
  }
  if (!objects.some((o) => o.id === rootId && o.kind === 'board')) return c.json({ error: 'This board is unavailable.' }, 404)
  const revision = await c.env.DB.prepare("SELECT value FROM counters WHERE name='access_revision'").first<{ value: number }>()
  if (String(revision?.value ?? 1) !== access.revision) return c.json({ error: 'Access changed. Try copying again.' }, 409)
  return c.json({ objects })
})
