import { Show, onMount } from 'solid-js'
import { safeHref, type Card } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { editIsNewCard, endEdit, onEndEdit } from '../state/ui.ts'
import { unfurl } from '../state/unfurl.ts'
import type { CardProps } from '../canvas/CardView.tsx'

onEndEdit((id) => {
  const c = doc.getCard(id) as Card<'link'> | undefined
  if (c?.type !== 'link') return
  const raw = c.content.url.trim()
  const href = safeHref(raw) ?? safeHref(`https://${raw}`)
  if (!href) {
    if (editIsNewCard()) doc.discardNew(id)
    return
  }
  if (href !== c.content.url || c.content.status !== 'ok') {
    doc.transient(id, { content: { url: href, status: 'pending' } } as Partial<Card>)
    queueMicrotask(() => void unfurl(id))
  }
})

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function LinkCard(props: CardProps<'link'>) {
  const c = () => props.card.content
  onMount(() => {
    if (!props.readOnly && c().url && c().status === 'pending') void unfurl(props.card.id)
  })

  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <Show
        when={!props.editing}
        fallback={
          <input
            ref={(el) => queueMicrotask(() => el.focus())}
            class="link-input"
            data-testid="link-input"
            placeholder="Paste a link…"
            value={c().url}
            onInput={(e) => doc.transient(props.card.id, { content: { ...c(), url: e.currentTarget.value } } as Partial<Card>)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                endEdit()
              }
            }}
          />
        }
      >
        <div class="link-card" data-status={c().status}>
          <Show when={c().image && safeHref(c().image)}>
            <img class="link-image" src={safeHref(c().image)!} alt="" draggable={false} loading="lazy" referrerpolicy="no-referrer" />
          </Show>
          <div class="link-body">
            <a class="link-title" href={safeHref(c().url) ?? '#'} target="_blank" rel="noopener noreferrer" data-nodrag data-testid="link-title">
              {c().status === 'pending' && !c().title ? COPY.loading : c().title || host(c().url)}
            </a>
            <Show when={c().description}>
              <p class="link-desc">{c().description}</p>
            </Show>
            <div class="link-host">{c().siteName || host(c().url)}</div>
          </div>
        </div>
      </Show>
    </Show>
  )
}
