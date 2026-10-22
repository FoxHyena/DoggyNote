import { Show, createSignal, onMount } from 'solid-js'
import { safeHref, type Card } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { editIsNewCard, endEdit, onEndEdit } from '../state/ui.ts'
import { proxiedImage, retryEmptyPreview, unfurl } from '../state/unfurl.ts'
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

/**
 * The preview image, whole. Hot-linked first; if the site won't serve it to us,
 * fetched through the Worker. If that fails too, there's no image at all
 * (never a broken-image box).
 */
function LinkImage(props: { url: string }) {
  const [src, setSrc] = createSignal<string | null>(props.url)
  const [via, setVia] = createSignal<'direct' | 'proxy'>('direct')
  // Its shape, once known: in a column the thumbnail takes it, so it fills without bars.
  const [ratio, setRatio] = createSignal(1)
  const onError = async () => {
    setSrc(null)
    if (via() === 'proxy') return
    setVia('proxy')
    setSrc(await proxiedImage(props.url))
  }
  return (
    <Show when={src()}>
      {(s) => (
        <img
          class="link-image"
          data-testid="link-image"
          data-via={via()}
          src={s()}
          alt=""
          draggable={false}
          loading="lazy"
          referrerpolicy="no-referrer"
          style={{ '--ar': String(ratio()) }}
          onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setRatio(i.naturalWidth / i.naturalHeight) }}
          onError={() => void onError()}
        />
      )}
    </Show>
  )
}

// On the board the picture leads, whole, with the text under it. In a column the
// card is a compact row, like a movie: a small thumbnail beside the title.
export function LinkCard(props: CardProps<'link'>) {
  const c = () => props.card.content
  onMount(() => {
    if (props.readOnly || !c().url) return
    if (c().status === 'pending') void unfurl(props.card.id)
    else if (c().status === 'ok' && !c().title && !c().image) retryEmptyPreview(props.card.id)
  })

  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <Show
        when={!props.editing}
        fallback={
          <input
            ref={(el) => onMount(() => el.focus())}
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
        <div class="link-card" classList={{ 'link-row': !!props.card.columnId }} data-status={c().status} data-testid="link-card">
          <Show when={c().image && safeHref(c().image)} keyed>
            {(url) => <LinkImage url={url} />}
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
