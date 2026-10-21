import { Show, Suspense, createEffect, createSignal, lazy, on } from 'solid-js'
import { isCanvasInkSize, type Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { boardId, endEdit, select } from '../state/ui.ts'
import { endCanvasDrawing } from '../state/canvasDrawing.ts'
const StrokeEditor = lazy(() => import('./StrokeEditor.tsx').then((m) => ({ default: m.StrokeEditor })))

const [inkEditingId, setInkEditingId] = createSignal<string | null>(null)
export function editCanvasInk(id: string) {
  const card = doc.getCard(id)
  if (card?.type !== 'ink' || !isCanvasInkSize(card.content) || !doc.canWriteObject(card)) return
  endEdit(); endCanvasDrawing(); select([id]); setInkEditingId(id)
}

/** Mounted once outside the transformed world, so its modal stays at screen scale. */
export function CanvasInkEditor() {
  const card = () => {
    const c = doc.getCard(inkEditingId())
    return c?.type === 'ink' && !c.deletedAt && !c.purged && c.boardId === boardId() && isCanvasInkSize(c.content) ? c as Card<'ink'> : undefined
  }
  createEffect(on(boardId, () => setInkEditingId(null), { defer: true }))
  createEffect(() => { if (inkEditingId() && !card()) setInkEditingId(null) })
  return <Show when={card()}>{(c) => <Suspense fallback={<div class="dialog-backdrop" role="status">Opening drawing tools…</div>}><StrokeEditor cardId={c().id} width={c().content.width} height={c().content.height} background="transparent" title="Edit canvas drawing" onDone={() => setInkEditingId(null)} /></Suspense>}</Show>
}
