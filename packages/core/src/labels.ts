import { CARD_COLORS, type CardColor } from '@doggynote/theme'
import type { Board, Card } from './model.ts'
import { normalizeSwatchHex } from './swatch.ts'

// Labels belong to a board. Each one is a pair of scalar fields on the board
// (`labelName<id>`, `labelColor<id>`) and each card that carries it has
// `label<id>: true`. Sync is per field, so two people can label different cards,
// or rename one label while another person applies a different one, without
// overwriting each other. A label lives on its board's object, so a Toy box's
// labels are as private as the Toy box.

/** A preset key (a theme card colour, light and dark) or a custom `#RRGGBB`. */
export type LabelColor = CardColor | `#${string}`
export type Label = { id: string; name: string; color: LabelColor }

/** 12 hex characters keeps `labelColor<id>` within the server's 32-character field names. */
export const LABEL_ID = /^[a-f0-9]{12}$/
export const LABEL_FIELD = /^(labelName|labelColor|label)([a-f0-9]{12})$/
export const MAX_LABEL_NAME = 60
/** Per board. Keeps a board object's field count well inside the server's per-push limit. */
export const MAX_LABELS = 30
export const LABEL_PRESETS = CARD_COLORS.filter((c) => c !== 'none')
export const DEFAULT_LABEL_COLOR: LabelColor = 'sky'

export const labelToken = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12)
export const normalizeLabelName = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase('en-US')
export const nameKey = (id: string) => `labelName${id}`
export const colorKey = (id: string) => `labelColor${id}`
export const memberKey = (id: string) => `label${id}`

/**
 * A colour for a new label: a random preset the board isn't using yet, or any
 * preset once they're all taken.
 */
export function pickLabelColor(existing: readonly Pick<Label, 'color'>[], random: () => number = Math.random): LabelColor {
  const used = new Set(existing.map((l) => l.color))
  const free = LABEL_PRESETS.filter((c) => !used.has(c))
  const pool = free.length ? free : LABEL_PRESETS
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!
}

/** A synced colour if it's valid, else the default. Goes straight into CSS. */
export function labelColor(value: unknown): LabelColor {
  if ((CARD_COLORS as readonly unknown[]).includes(value)) return value as CardColor
  return (normalizeSwatchHex(typeof value === 'string' && value.startsWith('#') ? value : null) as LabelColor | null) ?? DEFAULT_LABEL_COLOR
}

/**
 * Whether a label field may be written. Definitions go on boards, memberships
 * on cards; null is a tombstone (removal, or Undo of a field that was absent).
 */
export function validLabelField(kind: unknown, key: string, value: unknown): boolean {
  const match = LABEL_FIELD.exec(key)
  if (!match) return false
  if (match[1] === 'label') return kind === 'card' && (value == null || typeof value === 'boolean')
  if (kind !== 'board') return false
  if (value == null) return true
  if (match[1] === 'labelName') return typeof value === 'string' && !!value.trim() && value.length <= MAX_LABEL_NAME
  return typeof value === 'string' && ((CARD_COLORS as readonly string[]).includes(value) || /^#[0-9A-F]{6}$/.test(value))
}

/** The board's live labels, sorted by name. */
export function boardLabels(board: Board | undefined): Label[] {
  if (!board || board.deletedAt || board.purged) return []
  const values = board as unknown as Record<string, unknown>
  const out: Label[] = []
  for (const [key, value] of Object.entries(values)) {
    const match = /^labelName([a-f0-9]{12})$/.exec(key)
    if (!match || value == null || !validLabelField('board', key, value)) continue
    out.push({ id: match[1], name: value as string, color: labelColor(values[colorKey(match[1])]) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** The labels on a card, from its own board's definitions only. */
export function cardLabels(card: Card, board: Board | undefined): Label[] {
  if (!board || card.boardId !== board.id) return []
  const values = card as unknown as Record<string, unknown>
  return boardLabels(board).filter((label) => values[memberKey(label.id)] === true)
}

/** A copy of an object without label fields that are off, so whole-object writes stay small. */
export function withoutLabelTombstones<T extends object>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => !(LABEL_FIELD.test(key) && (value == null || value === false)))) as T
}

// ---- copying labelled cards to another board ------------------------------------
// A card's `label<id>` flags point at its own board's definitions. On another
// board those ids mean nothing, so a copy (or a move) maps each label by name:
// an existing label with the same name is reused, otherwise one is created with
// the source's colour. Same-board copies keep their flags untouched.

const MEMBER = /^label([a-f0-9]{12})$/

/** Ids of the labels a card carries (flags that are on). */
export function cardLabelIds(card: object): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(card)) {
    const match = MEMBER.exec(key)
    if (match && value === true) out.push(match[1]!)
  }
  return out
}

export type LabelCopyPlan = {
  /** Source label id → target label id. Labels missing here are dropped. */
  map: Map<string, string>
  /** New labels the target board needs. */
  create: Label[]
}

/**
 * How the `used` labels from `source` land on a board that already has `target`.
 * Never goes past MAX_LABELS: labels that don't fit are dropped from the copy.
 */
export function planLabelCopy(source: readonly Label[], used: Iterable<string>, target: readonly Label[], token: () => string = labelToken): LabelCopyPlan {
  const wanted = new Set(used)
  const byName = new Map(target.map((l) => [normalizeLabelName(l.name), l.id]))
  const taken = new Set(target.map((l) => l.id))
  const map = new Map<string, string>()
  const create: Label[] = []
  for (const label of source) {
    if (!wanted.has(label.id) || map.has(label.id)) continue
    const key = normalizeLabelName(label.name)
    const existing = byName.get(key)
    if (existing) {
      map.set(label.id, existing)
      continue
    }
    if (target.length + create.length >= MAX_LABELS) continue
    let id = token()
    while (taken.has(id)) id = token()
    taken.add(id)
    create.push({ id, name: label.name, color: label.color })
    byName.set(key, id)
    map.set(label.id, id)
  }
  return { map, create }
}

/** Board fields that define `labels`. */
export function labelDefinitions(labels: readonly Label[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of labels) {
    out[nameKey(l.id)] = l.name
    out[colorKey(l.id)] = l.color
  }
  return out
}

/** A new copy of `card` whose flags follow the plan; unmapped flags are dropped. */
export function relabel<T extends object>(card: T, plan: LabelCopyPlan): T {
  const ids = cardLabelIds(card)
  const out = Object.fromEntries(Object.entries(card).filter(([key]) => !MEMBER.test(key))) as Record<string, unknown>
  for (const id of ids) {
    const to = plan.map.get(id)
    if (to) out[memberKey(to)] = true
  }
  return out as T
}

/** The flag changes for moving an existing card: old flags off (null), mapped flags on. */
export function relabelPatch(card: object, plan: LabelCopyPlan): Record<string, true | null> {
  const patch: Record<string, true | null> = {}
  const ids = cardLabelIds(card)
  for (const id of ids) patch[memberKey(id)] = null
  for (const id of ids) {
    const to = plan.map.get(id)
    if (to) patch[memberKey(to)] = true
  }
  return patch
}

/** Label definitions from untrusted input (a clipboard), cleaned for use. */
export function parseLabels(value: unknown): Label[] {
  if (!Array.isArray(value)) return []
  const out: Label[] = []
  for (const l of value.slice(0, MAX_LABELS)) {
    if (!l || typeof l.id !== 'string' || !LABEL_ID.test(l.id) || !validLabelField('board', nameKey(l.id), l.name)) continue
    out.push({ id: l.id, name: (l.name as string).trim(), color: labelColor(l.color) })
  }
  return out
}
