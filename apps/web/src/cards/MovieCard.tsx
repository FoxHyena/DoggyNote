import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { doneLabel, movieSubtitle, tmdbPage, type Card } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { ApiError } from '../state/api.ts'
import { acquireUrl, releaseUrl, type AssetSize } from '../state/assets.ts'
import { beginEdit, camera, editIsNewCard, endEdit, onEndEdit } from '../state/ui.ts'
import { exportScale, exporting } from '../state/export.ts'
import { clock } from '../state/todos.ts'
import { resolveMovie, searchMovies, type SearchHit } from '../state/movies.ts'
import { Icon } from '../ui/icons.tsx'
import type { CardProps } from '../canvas/CardView.tsx'
import { revealCard } from '../canvas/Canvas.tsx'

// A film or show: poster, title, year and kind, a Watched toggle, and (per card)
// the details: genres, a summary and where to watch. On the board the poster
// leads, with the title under it; in a column the card is a compact row (like
// board cards). A new card starts as a search box; picking a title fetches its
// details and poster.

/** The poster's width in a column; on the board it fills the card. */
const ROW_POSTER_W = 72
const PAD = 10

onEndEdit((id) => {
  const c = doc.getCard(id) as Card<'movie'> | undefined
  if (c?.type !== 'movie') return
  if (!c.content.tmdbId && !c.content.imdbId) {
    if (editIsNewCard()) doc.discardNew(id)
    return
  }
  if (c.content.status === 'pending') queueMicrotask(() => void resolveMovie(id).then(() => afterLayout(() => revealCard(id))))
})

/** Once the card has re-rendered and been measured. */
const afterLayout = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn))

/** The stored poster, at the smallest size that stays sharp. */
function Poster(props: { assetId: string; title: string; width: number }) {
  const size = createMemo<AssetSize>(() => {
    const onScreen = exporting() ? props.width * exportScale() : props.width * camera().zoom * (window.devicePixelRatio || 1)
    return onScreen <= 185 ? 'thumb' : 'small'
  })
  const [src, setSrc] = createSignal<string>()
  createEffect(() => {
    const id = props.assetId
    const s = size()
    let url: string | null = null
    let cancelled = false
    void acquireUrl(id, s).then((u) => {
      if (cancelled) return releaseUrl(u)
      url = u
      setSrc(u)
    })
    onCleanup(() => {
      cancelled = true
      if (url) setTimeout(() => releaseUrl(url!), 1000)
    })
  })
  return <img class="movie-poster-img" src={src()} alt={`${props.title} poster`} draggable={false} decoding="async" data-testid="movie-poster-img" data-size={size()} />
}

function MovieSearch(props: { card: Card<'movie'> }) {
  const [query, setQuery] = createSignal(props.card.content.title ?? '')
  const [hits, setHits] = createSignal<SearchHit[]>([])
  const [state, setState] = createSignal<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = createSignal('')
  const [active, setActive] = createSignal(0)
  const listId = `movie-results-${props.card.id}`
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: AbortController | undefined

  createEffect(() => {
    const q = query().trim()
    clearTimeout(timer)
    abort?.abort()
    if (q.length < 2) {
      setHits([])
      setState('idle')
      return
    }
    setState('loading')
    timer = setTimeout(() => {
      const ctl = (abort = new AbortController())
      searchMovies(q, ctl.signal)
        .then((r) => {
          if (ctl.signal.aborted) return
          setHits(r)
          setActive(0)
          setState('done')
        })
        .catch((e) => {
          if (ctl.signal.aborted) return
          setError(e instanceof ApiError ? e.message : 'Couldn’t search right now. Check your connection.')
          setState('error')
        })
    }, 250)
  })
  onCleanup(() => {
    clearTimeout(timer)
    abort?.abort()
  })

  // A row picks on release over the same row it was pressed on: some touch WebKit
  // builds never turn the tap into a click. Click stays for screen readers.
  let pressed: number | null = null
  let picked = false
  const pick = (h: SearchHit) => {
    if (picked) return
    picked = true
    doc.transient(props.card.id, { content: { kind: h.kind, tmdbId: h.tmdbId, title: h.title, year: h.year, status: 'pending' } } as Partial<Card>)
    endEdit()
  }

  return (
    <div class="movie-search" data-nodrag>
      <input
        ref={(el) => onMount(() => el.focus())}
        class="movie-search-input"
        data-testid="movie-search"
        role="combobox"
        aria-expanded={hits().length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={hits().length ? `${listId}-${active()}` : undefined}
        aria-label="Movie or show title"
        placeholder={COPY.movieSearch}
        autocomplete="off"
        enterkeyhint="search"
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          const n = hits().length
          if (e.key === 'ArrowDown' && n) {
            e.preventDefault()
            setActive((i) => (i + 1) % n)
          } else if (e.key === 'ArrowUp' && n) {
            e.preventDefault()
            setActive((i) => (i - 1 + n) % n)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const h = hits()[active()]
            if (h) pick(h)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            endEdit()
          }
        }}
      />
      <Show when={state() === 'loading' && !hits().length}>
        <p class="movie-search-note" role="status">{COPY.loading}</p>
      </Show>
      <Show when={state() === 'done' && !hits().length}>
        <p class="movie-search-note" role="status">{COPY.movieNoMatch}</p>
      </Show>
      <Show when={state() === 'error'}>
        <p class="movie-search-note" role="alert">{error()}</p>
      </Show>
      <Show when={hits().length}>
        <ul class="movie-results" id={listId} role="listbox" aria-label="Matches" data-testid="movie-results">
          <For each={hits()}>
            {(h, i) => (
              <li
                id={`${listId}-${i()}`}
                role="option"
                aria-selected={active() === i()}
                class="movie-result"
                data-testid="movie-result"
                // Keep focus in the input; pick on release. (On pointerdown this would
                // cancel the click in touch WebKit.)
                onMouseDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(i())}
                onPointerDown={() => (pressed = i())}
                onPointerCancel={() => (pressed = null)}
                onPointerUp={() => pressed === i() && pick(h)}
                onClick={() => pick(h)}
              >
                <span class="movie-result-thumb">
                  <Show when={h.thumb} fallback={<Icon name="film" />}>
                    <img src={h.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" draggable={false} />
                  </Show>
                </span>
                <span class="movie-result-text">
                  <strong>{h.title}</strong>
                  <small>{[h.year, h.kind === 'tv' ? 'Show' : 'Movie'].filter(Boolean).join(' · ')}</small>
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export function MovieCard(props: CardProps<'movie'>) {
  const c = () => props.card.content
  const id = props.card.id
  onMount(() => {
    if (!props.readOnly && c().status === 'pending') void resolveMovie(id)
  })
  const toggleWatched = () => {
    const watched = !c().watched
    doc.update({ [id]: { content: { ...c(), watched, watchedAt: watched ? Date.now() : null } } as Partial<Card> })
  }
  const toggleDetails = () => {
    const details = !c().details
    doc.update({ [id]: { content: { ...c(), details } } as Partial<Card> })
    // Bring the details into view, even when the whole card can't fit.
    if (details) afterLayout(() => {
      const card = detailsEl?.closest<HTMLElement>('.card')
      revealCard(id, card && detailsEl ? (detailsEl.getBoundingClientRect().top - card.getBoundingClientRect().top) / camera().zoom : 0)
    })
  }
  let detailsEl: HTMLDivElement | undefined
  const page = () => tmdbPage(c())
  // A title TMDB couldn't find still says what it was.
  const name = () => c().title || (c().status === 'error' ? (c().imdbId ? `IMDb ${c().imdbId}` : 'Unknown title') : COPY.loading)
  const [refreshing, setRefreshing] = createSignal(false)
  const refresh = () => {
    setRefreshing(true)
    void resolveMovie(id).finally(() => setRefreshing(false))
  }
  const inColumn = () => !!props.card.columnId
  const providers = () => c().info?.providers
  const anyProvider = () => !!(providers()?.stream?.length || providers()?.rent?.length || providers()?.buy?.length)

  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <Show
        when={!props.editing && (c().tmdbId || c().imdbId)}
        fallback={
          <Show
            when={props.editing}
            // Left without a pick (a reload mid-search): a quiet placeholder, not a search box that grabs focus.
            fallback={
              <div class="movie-empty" data-testid="movie-empty">
                <Icon name="film" />
                <Show when={!props.readOnly} fallback={<span>No title picked</span>}>
                  <button class="link-btn" data-nodrag onClick={() => beginEdit(id, { isNew: true })}>Pick a movie or show</button>
                </Show>
              </div>
            }
          >
            <MovieSearch card={props.card} />
          </Show>
        }
      >
        <div class="movie-card" classList={{ watched: !!c().watched, 'movie-row': inColumn(), 'movie-tall': !inColumn() }} data-status={c().status} data-testid="movie-card">
          <div class="movie-poster" data-testid="movie-poster">
            <Show when={c().assetId} fallback={<span class="movie-poster-empty"><Icon name="film" /></span>}>
              <Poster assetId={c().assetId!} title={c().title} width={inColumn() ? ROW_POSTER_W : props.card.w - PAD * 2} />
            </Show>
            {/* Where there's no Watched button to show it (share links, view-only boards). */}
            <Show when={c().watched && props.readOnly}>
              <span class="movie-watched-badge" aria-hidden="true"><Icon name="check" /></span>
            </Show>
          </div>
          <div class="movie-body">
            <div class="movie-head">
              <div class="movie-head-text">
                <Show when={page()} fallback={<span class="movie-title" data-testid="movie-title">{name()}</span>}>
                  <a class="movie-title" href={page()!} target="_blank" rel="noopener noreferrer" data-nodrag data-testid="movie-title">
                    {name()}
                  </a>
                </Show>
              </div>
              <Show when={!props.readOnly}>
                <div class="movie-icons">
                  <button
                    class="movie-icon-btn"
                    classList={{ on: !!c().watched }}
                    aria-label="Watched"
                    aria-pressed={!!c().watched}
                    title={c().watched ? 'Watched' : 'Mark watched'}
                    data-nodrag
                    data-testid="movie-watched"
                    onClick={toggleWatched}
                  >
                    <Icon name="check" />
                  </button>
                  <Show when={c().info}>
                    <button
                      class="movie-icon-btn"
                      aria-label="Details"
                      aria-expanded={!!c().details}
                      title={c().details ? 'Hide details' : 'Details: genres, summary, where to watch'}
                      data-nodrag
                      data-testid="movie-details-toggle"
                      onClick={toggleDetails}
                    >
                      <Icon name="info" />
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
            <div class="movie-sub" data-testid="movie-sub">{movieSubtitle(c())}</div>
            <Show when={c().status === 'pending'}>
              <div class="movie-note" role="status">{COPY.loading}</div>
            </Show>
            <Show when={c().status === 'error'}>
              <div class="movie-note">
                Couldn’t fetch the details.
                <Show when={!props.readOnly}>
                  {' '}
                  <button class="link-btn" data-nodrag onClick={() => void resolveMovie(id)}>Try again</button>
                </Show>
              </div>
            </Show>
            <Show when={c().watched && c().watchedAt}>
              <div class="movie-watched-at" data-testid="movie-watched-at">Watched {doneLabel(c().watchedAt!, clock())}</div>
            </Show>
          </div>
          <Show when={c().details && c().info}>
            {(info) => (
              <div ref={detailsEl} class="movie-details" data-testid="movie-details">
                <Show when={info().genres?.length}>
                  <div class="movie-chips" aria-label="Genres">
                    <For each={info().genres}>{(g) => <span class="movie-chip">{g}</span>}</For>
                  </div>
                </Show>
                <Show when={info().overview}>
                  <p class="movie-overview">{info().overview}</p>
                </Show>
                <Show when={anyProvider()} fallback={<p class="movie-where">Not streaming in {providers()?.region ?? 'your region'} right now.</p>}>
                  <For each={[['Stream', providers()!.stream], ['Rent', providers()!.rent], ['Buy', providers()!.buy]] as const}>
                    {([label, list]) => (
                      <Show when={list?.length}>
                        <div class="movie-where" data-testid={`movie-${label.toLowerCase()}`}>
                          <span class="movie-where-label">{label}</span>
                          <For each={list}>{(p) => <span class="movie-chip">{p}</span>}</For>
                        </div>
                      </Show>
                    )}
                  </For>
                </Show>
                <div class="movie-credit">
                  <Show when={providers()?.link} fallback={<span>Streaming data from JustWatch</span>}>
                    <a href={providers()!.link} target="_blank" rel="noopener noreferrer" data-nodrag>Streaming data from JustWatch</a>
                  </Show>
                  <Show when={!props.readOnly}>
                    <button class="link-btn" data-nodrag data-testid="movie-refresh" title="Fetch the latest details" disabled={refreshing()} onClick={refresh}>
                      {refreshing() ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </Show>
  )
}
