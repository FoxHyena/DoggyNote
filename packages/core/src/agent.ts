import { z } from 'zod'
import { CARD_COLORS } from '@doggynote/theme'

const id = z.string().regex(/^[a-zA-Z0-9_:-]{1,64}$/)
const stamp = z.number().int().nonnegative()
const text = z.string().max(200_000)
const color = z.enum(CARD_COLORS)
const common = { id, createdAt: stamp, deletedAt: stamp.nullable().optional(), purged: z.boolean().optional() }
const card = {
  ...common, kind: z.literal('card'), boardId: id,
  x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000),
  w: z.number().finite().positive().max(10_000), h: z.number().finite().positive().max(100_000),
  z: z.number().finite(), color, columnId: id.nullable().optional(), order: z.number().finite().optional(),
}
const safeUrl = z.string().max(4096).refine((v) => { try { return ['https:', 'http:'].includes(new URL(v).protocol) } catch { return false } }, 'Use an http or https URL')
const rendition = z.enum(['thumb', 'small', 'medium', 'full'])
export const agentObjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('board'), parentId: id.nullable(), title: z.string().max(200), icon: z.enum(['paw', 'bone', 'ball', 'collar', 'kennel', 'bowl', 'star', 'heart']), color }),
  z.discriminatedUnion('type', [
    z.strictObject({ ...card, type: z.literal('note'), content: z.strictObject({ md: text }) }),
    z.strictObject({ ...card, type: z.literal('todo'), content: z.strictObject({ title: z.string().max(1000), items: z.array(z.strictObject({ id, text: z.string().max(10_000), done: z.boolean() })).max(1000) }) }),
    z.strictObject({ ...card, type: z.literal('board'), content: z.strictObject({ boardId: id }) }),
    z.strictObject({ ...card, columnId: z.null().optional(), type: z.literal('column'), content: z.strictObject({ title: z.string().max(1000) }) }),
    z.strictObject({ ...card, type: z.literal('link'), content: z.strictObject({ url: safeUrl, title: z.string().max(1000).optional(), description: z.string().max(10_000).optional(), image: safeUrl.optional(), siteName: z.string().max(1000).optional(), status: z.enum(['pending', 'ok', 'error']).optional() }) }),
    z.strictObject({ ...card, type: z.literal('image'), content: z.strictObject({ assetId: id, width: z.number().positive().finite(), height: z.number().positive().finite(), caption: z.string().max(10_000).optional(), sizes: z.array(rendition).max(4).optional() }) }),
    z.strictObject({ ...card, type: z.literal('file'), content: z.strictObject({ assetId: id, name: z.string().min(1).max(200), size: stamp.max(50 * 1024 * 1024), mime: z.string().max(200), status: z.enum(['ok']).optional(), thumb: z.strictObject({ width: z.number().positive().finite(), height: z.number().positive().finite() }).optional() }) }),
  ]),
  z.strictObject({ ...common, kind: z.literal('connection'), boardId: id, from: id, to: id, fromSide: z.enum(['top', 'right', 'bottom', 'left']).nullable().optional(), toSide: z.enum(['top', 'right', 'bottom', 'left']).nullable().optional(), arrow: z.enum(['end', 'none']) }),
  z.strictObject({ ...common, kind: z.literal('comment'), boardId: id, cardId: id, authorId: id, author: z.string().max(32), text: z.string().max(20_000), editedAt: stamp.nullable().optional(), resolvedAt: stamp.nullable().optional() }),
])

/** Full replacement shapes deliberately reject arbitrary sync metadata and unknown fields. */
export const agentOperationSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), object: agentObjectSchema }),
  z.strictObject({ action: z.literal('replace'), expectedRevision: stamp, object: agentObjectSchema }),
  z.strictObject({ action: z.literal('trash'), id, expectedRevision: stamp }),
  z.strictObject({ action: z.literal('restore'), id, expectedRevision: stamp }),
])
export const agentProposalSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().trim().min(1).max(160),
  operations: z.array(agentOperationSchema).min(1).max(200),
})
export type AgentObject = z.infer<typeof agentObjectSchema>
export type AgentOperation = z.infer<typeof agentOperationSchema>
export type AgentProposalInput = z.infer<typeof agentProposalSchema>
export type AgentChange = { id: string; before: AgentObject | null; after: AgentObject; expectedRevision: number | null }
