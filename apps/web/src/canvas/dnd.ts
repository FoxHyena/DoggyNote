import { createSignal } from 'solid-js'
import type { Id, Vec } from '@doggynote/core'

/** Column insertion point while dragging cards over a column. */
export const [dropTarget, setDropTarget] = createSignal<{ columnId: Id; index: number } | null>(null)
/** Line being drawn from a card's connect handle. */
export const [connectPreview, setConnectPreview] = createSignal<{ from: Id; to: Vec } | null>(null)
export const [draggingIds, setDraggingIds] = createSignal<ReadonlySet<Id>>(new Set())
