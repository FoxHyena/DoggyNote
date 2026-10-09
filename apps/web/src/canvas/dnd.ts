import { createSignal } from 'solid-js'
import type { Id, Side, Vec } from '@doggynote/core'

/** Column insertion point while dragging cards over a column. */
export const [dropTarget, setDropTarget] = createSignal<{ columnId: Id; index: number } | null>(null)
/** Line being drawn from a card's connect handle; `target` is the card + side it has snapped to. */
export type ConnectPreview = { from: Id; fromSide: Side; to: Vec; target: { id: Id; side: Side } | null }
export const [connectPreview, setConnectPreview] = createSignal<ConnectPreview | null>(null)
export const [draggingIds, setDraggingIds] = createSignal<ReadonlySet<Id>>(new Set())
