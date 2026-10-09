import { Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import * as idb from '../state/idb.ts'
import * as doc from '../state/doc.ts'
import { API_BASE } from '../state/api.ts'
import { lastError, pendingCount, syncState } from '../state/sync.ts'
import { boardId } from '../state/ui.ts'
import { thumbsLoaded } from '../canvas/LodLayer.tsx'

// ⌃⌥D: what this device thinks is going on. For debugging sync and the desktop app.

const errors: string[] = []
window.addEventListener('error', (e) => errors.push(String(e.message)).toString())
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)).toString())

async function snapshot() {
  return {
    sync: syncState(),
    pending: pendingCount(),
    lastError: lastError(),
    cursor: await idb.get<number>('meta', 'cursor'),
    epoch: await idb.get<string>('meta', 'epoch'),
    objects: Object.keys(doc.objs).length,
    board: boardId(),
    cardsOnBoard: doc.cardsOn(boardId()).length,
    thumbs: thumbsLoaded(),
    lod: !!document.querySelector('.lod-layer'),
    imgs: [...document.querySelectorAll<HTMLImageElement>('.image-card img')].map((i) => `${i.complete && i.naturalWidth > 0 ? 'ok' : 'x'}:${i.src.slice(-50)}`).slice(0, 3),
    errors: errors.slice(-5),
  }
}

// Test builds (VITE_DIAG=1) push a snapshot to the local server every 3 s.
if (import.meta.env.VITE_DIAG === '1') {
  setInterval(async () => {
    try {
      await fetch(`${API_BASE}/api/diag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await snapshot()) })
    } catch {
      // diagnostics are best-effort
    }
  }, 3000)
}

export function Diagnostics() {
  const [open, setOpen] = createSignal(false)
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.ctrlKey && e.code === 'KeyD') {
        e.preventDefault()
        setOpen(!open())
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })
  const [meta] = createResource(open, async () => ({
    cursor: await idb.get<number>('meta', 'cursor'),
    epoch: await idb.get<string>('meta', 'epoch'),
  }))
  return (
    <Show when={open()}>
      <pre class="diagnostics" data-testid="diagnostics">
        {[
          `server     ${API_BASE || location.origin}`,
          `sync       ${syncState()} · ${pendingCount()} waiting${lastError() ? ` · ${lastError()}` : ''}`,
          `cursor     ${meta()?.cursor ?? '-'}   epoch ${meta()?.epoch ?? '-'}`,
          `objects    ${Object.keys(doc.objs).length} · cards on board ${doc.cardsOn(boardId()).length}`,
          `board      ${boardId()}`,
          `thumbs     ${thumbsLoaded()}`,
          `errors     ${errors.slice(-3).join(' | ') || 'none'}`,
        ].join('\n')}
      </pre>
    </Show>
  )
}
