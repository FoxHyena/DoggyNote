import { createSignal } from 'solid-js'
import * as doc from '../state/doc.ts'
import { endEdit } from '../state/ui.ts'
import { MAX_INK_COORD } from '@doggynote/core'
import { showToast } from '../state/toast.ts'

export const [annotationId, setAnnotationId] = createSignal<string | null>(null)
export function openAnnotations(id: string) {
  const card = doc.getCard(id)
  if (card?.type !== 'image' || !doc.canWriteObject(card)) return
  const { width, height } = card.content as { width: number; height: number }
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= MAX_INK_COORD)) {
    showToast('This image has invalid dimensions and cannot be annotated.')
    return
  }
  endEdit()
  setAnnotationId(id)
}
