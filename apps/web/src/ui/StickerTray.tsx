import './stickers.css'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { normalizeStickerPack, type StickerAsset } from '@doggynote/core'
import { ApiError, api } from '../state/api.ts'
import { phone } from '../state/device.ts'
import { showToast } from '../state/toast.ts'
import { openPack, packLoad, preparePack, readyCount } from '../state/packLoading.ts'
import { playbackPaused, togglePlayback } from '../state/stickerPlayback.ts'
import { armedSticker, armSticker, canvasStickerPoint, collectionLoaded, favoriteSticker, openStickers, packs, placeSticker, preferences, refreshStickers, refreshTelegram, selectedPack, setSelectedPack, setStickerGhost, setStickerTrayOpen, setStickerTrayPinned, stickerTrayOpen, stickerTrayPinned, STICKER_TOUCH_OFFSET, suggestions, trayScroll, trayHorizontalScroll, telegramStatus, type PackSticker, type TelegramStatus } from '../state/stickers.ts'
import { StickerImage } from './StickerImage.tsx'
import { StickerGrid } from './StickerGrid.tsx'
import { stickerAt, stickerRingAt } from '../canvas/StickerLayer.tsx'
import { BoardIconSvg, Icon, ToolIcons } from './icons.tsx'

export const [requestedStickerPack, setRequestedStickerPack] = createSignal<string | null>(null)
export function viewStickerPack(name: string) { setRequestedStickerPack(name); openStickers() }

export function StickerTray() {
  const [mode, setMode] = createSignal<'collection' | 'add' | 'pack' | 'bot'>('collection')
  const [packReturnMode, setPackReturnMode] = createSignal<'collection' | 'add' | 'bot'>('add')
  const [query, setQuery] = createSignal(''), [link, setLink] = createSignal('')
  const [previewName, setPreviewName] = createSignal<string | null>(null), [large, setLarge] = createSignal<PackSticker | null>(null)
  // The previewed pack lives in the shared loader, so it keeps preparing after you leave and is never locked.
  const previewLoad = () => packLoad(previewName()), preview = () => previewLoad()?.pack ?? null
  const preparingPreview = () => !!previewLoad()?.preparing
  const [retryAt, setRetryAt] = createSignal(0), [clock, setClock] = createSignal(Date.now())
  const clockTimer = setInterval(() => setClock(Date.now()), 1000)
  onCleanup(() => clearInterval(clockTimer))
  const retrySeconds = () => Math.max(0, Math.ceil((Math.max(retryAt(), mode() === 'pack' ? previewLoad()?.retryAt ?? 0 : 0) - clock()) / 1000))
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal('')
  const shownError = () => error() || (mode() === 'pack' ? previewLoad()?.error ?? '' : '')
  let root: HTMLElement | undefined, scroll: HTMLDivElement | undefined, restoreFocus: HTMLElement | null = null
  let previewFocus: HTMLElement | null = null
  let previewAsset: string | null = null
  let focusGridSticker: ((assetId: string) => void) | undefined
  let clearPreviewRelease = () => {}
  const guardPreviewRelease = () => {
    clearPreviewRelease()
    const target = root
    if (!target) return
    const clear = () => {
      target.removeEventListener('click', click, true)
      target.removeEventListener('pointerdown', clear, true)
      target.removeEventListener('keydown', clear, true)
    }
    const click = (e: MouseEvent) => {
      // The held tile unmounts. Browsers can retarget its release click to a
      // preview action now under the finger; only a new press may activate it.
      if (e.detail > 0) { e.preventDefault(); e.stopImmediatePropagation() }
      clear()
    }
    target.addEventListener('click', click, true)
    target.addEventListener('pointerdown', clear, true)
    target.addEventListener('keydown', clear, true)
    clearPreviewRelease = clear
  }
  onCleanup(() => clearPreviewRelease())
  const focusPreviewOrigin = () => {
    if (previewAsset && focusGridSticker) { focusGridSticker(previewAsset); return }
    const target = previewFocus?.isConnected ? previewFocus : root?.querySelector<HTMLElement>(`[data-sticker-asset="${previewAsset}"]`)
    target?.focus({ preventScroll: true })
  }
  let request = 0
  const saveScroll = () => { if (scroll && mode() === 'collection') { trayScroll.set(selectedPack(), scroll.scrollTop); trayHorizontalScroll.set(selectedPack(), scroll.scrollLeft) } }
  const restoreScroll = (name: string) => { if (scroll) { scroll.scrollTop = trayScroll.get(name) ?? 0; scroll.scrollLeft = trayHorizontalScroll.get(name) ?? 0 } }
  const close = () => { saveScroll(); request++; setStickerGhost(null); setStickerTrayOpen(false) }
  const changeMode = (m: typeof mode extends () => infer T ? T : never) => { saveScroll(); setLarge(null); setError(''); setMode(m) }
  const action = async (fn: () => Promise<void>, upstream = false) => {
    if (busy() || (upstream && retrySeconds())) return
    setBusy(true); setError('')
    try { await fn() } catch (e) {
      setError(e instanceof Error ? e.message : 'Try again.')
      if (e instanceof ApiError && e.status === 429) setRetryAt(Date.now() + Math.min(3600, Math.max(1, Number(e.details.retryAfter) || 30)) * 1000)
    }
    finally { setBusy(false) }
  }
  const resolvePack = async (value: string) => {
    if (!normalizeStickerPack(value)) { setError('Use a Telegram addstickers link or a pack short name.'); return }
    const current = ++request, origin = mode()
    const returnMode = origin === 'pack' ? packReturnMode() : origin
    const show = (name: string) => { saveScroll(); setPackReturnMode(returnMode); setPreviewName(name); setMode('pack'); setLarge(null); setError('') }
    // A pack this session already opened (Telegram packs open in the background) shows at once;
    // a typed link always checks with the server.
    const known = origin === 'add' ? undefined : packLoad(value)
    if (known) { show(known.pack.name); void preparePack(known.pack.name); return }
    // From a row or a placed sticker, the pack view opens now and fills in; a typed link waits on its button.
    if (origin !== 'add') show(value)
    await action(async () => {
      const pack = await openPack(value, true)
      if (request !== current) return
      show(pack.name)
      // Stickers prepare in the background; the preview fills in as they arrive.
      void preparePack(pack.name)
    }, true)
  }
  const all = () => packs().flatMap((p) => p.stickers)
  const shown = createMemo(() => {
    const q = query().trim().toLocaleLowerCase()
    let list = all()
    if (q) return list.filter((s) => [s.packName, s.emoji, packs().find((p) => p.name === s.packName)?.title ?? '', ...(s.keywords ?? [])].join(' ').toLocaleLowerCase().includes(q))
    const pref = new Map(preferences().map((p) => [p.assetId, p]))
    if (selectedPack() === 'favorites') return list.filter((s) => pref.get(s.assetId)?.favorite)
    if (selectedPack() === 'recent') return list.filter((s) => pref.get(s.assetId)?.recentAt).sort((a, b) => (pref.get(b.assetId)?.recentAt ?? 0) - (pref.get(a.assetId)?.recentAt ?? 0)).slice(0, 48)
    return list.filter((s) => s.packName === selectedPack())
  })
  const shelf = () => phone() && mode() === 'collection' && !large() && !error() && !busy() && shown().length > 0 && !suggestions.length
  const added = () => !!packs().find((p) => p.name.toLowerCase() === preview()?.name.toLowerCase())
  const backMode = () => mode() === 'pack' ? packReturnMode() : mode() === 'bot' ? 'add' : 'collection'
  const backLabel = () => ({ collection: 'Back to your collection', add: 'Back to add a pack', bot: 'Back to Telegram' })[backMode()]
  const currentPack = () => packs().find((p) => p.name === selectedPack())
  const favorite = (s: StickerAsset) => !!preferences().find((p) => p.assetId === s.assetId)?.favorite
  const previewPackTitle = () => packs().find((p) => p.name === large()?.packName)?.title
    ?? (preview()?.name === large()?.packName ? preview()?.title : undefined)
    ?? large()?.packName ?? ''
  const doFavorite = (s: StickerAsset) => void action(() => favoriteSticker(s))
  const choosePack = (name: string) => {
    saveScroll(); setSelectedPack(name); setQuery(''); setLarge(null)
    queueMicrotask(() => { restoreScroll(name) })
  }
  const addPack = () => void action(async () => {
    const p = preview()!
    await api(`/api/stickers/packs/${encodeURIComponent(p.name)}`, { method: 'POST', json: {} })
    await refreshStickers(); void refreshTelegram().catch(() => {}); setSelectedPack(p.name); setQuery(''); changeMode('collection')
    queueMicrotask(() => root?.querySelector<HTMLElement>('[data-testid="sticker-pick"]')?.focus())
  })
  const remove = () => void action(async () => {
    const p = currentPack()!
    await api(`/api/stickers/packs/${encodeURIComponent(p.name)}`, { method: 'DELETE' })
    await refreshStickers(); choosePack('recent')
    showToast('Pack removed. Stickers on your boards stay put.', 8000, { label: 'Restore pack', run: () => { void resolvePack(p.name) } })
  })
  createEffect(() => {
    if (!stickerTrayOpen()) return
    restoreFocus = document.activeElement as HTMLElement | null
    void refreshStickers().catch((e) => setError(e instanceof Error ? e.message : 'Could not load your collection.'))
    void refreshTelegram().catch(() => {})
    queueMicrotask(() => {
      root?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
      restoreScroll(selectedPack())
    })
    const key = (e: KeyboardEvent) => {
      // While a pinned tray is open, Escape first cancels the sticker being placed (the canvas handles it).
      if (e.key !== 'Escape' || armedSticker()) return
      e.preventDefault(); e.stopImmediatePropagation()
      if (large()) { setLarge(null); queueMicrotask(focusPreviewOrigin) }
      else if (mode() !== 'collection') changeMode('collection')
      else close()
    }
    window.addEventListener('keydown', key, true)
    // Unpinned, a click on empty board puts the tray away. Placing a sticker, or grabbing
    // a sticker, card or handle, keeps it open. A pinned tray stays until closed.
    const outside = (e: PointerEvent) => {
      const target = e.target as Element | null, point = canvasStickerPoint({ x: e.clientX, y: e.clientY })
      if (stickerTrayPinned() || armedSticker() || e.button > 0 || !target?.closest('.viewport') || root?.contains(target)) return
      if (target.closest('[data-card-id], [data-sticker-handle], button, a, input, [role="toolbar"], [role="menu"]') || (point && (stickerAt(point, e.pointerType === 'touch') || stickerRingAt(point, e.pointerType === 'touch')))) return
      restoreFocus = null; close()
    }
    document.addEventListener('pointerdown', outside, true)
    const focus = () => { void refreshStickers().catch(() => {}) }
    window.addEventListener('focus', focus)
    onCleanup(() => {
      clearPreviewRelease()
      window.removeEventListener('keydown', key, true); window.removeEventListener('focus', focus); document.removeEventListener('pointerdown', outside, true)
      queueMicrotask(() => { if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true }) })
    })
  })
  createEffect(() => {
    const pack = selectedPack()
    if (stickerTrayOpen() && mode() === 'collection' && !large()) queueMicrotask(() => { restoreScroll(pack) })
  })
  createEffect(() => {
    const name = requestedStickerPack()
    if (name && stickerTrayOpen()) { setRequestedStickerPack(null); void resolvePack(name) }
  })
  onCleanup(() => { request++ })

  function Tile(props: { sticker: PackSticker }) {
    let pick: HTMLButtonElement | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let longPreview = false, dragged = false, touchMoved = false, pressed = false, start = { x: 0, y: 0 }
    const cancel = () => { clearTimeout(timer); timer = undefined }
    onCleanup(() => { cancel(); if (dragged) setStickerGhost(null) })
    const choose = () => { if (!packs().some((p) => p.name === props.sticker.packName)) return showPreview(); saveScroll(); armSticker(props.sticker) }
    const showPreview = () => { saveScroll(); previewFocus = pick ?? null; previewAsset = props.sticker.assetId; setLarge(props.sticker); queueMicrotask(() => root?.querySelector<HTMLElement>('[data-testid="sticker-preview-back"]')?.focus()) }
    return <div class="sticker-tile">
      <button ref={pick} class="sticker-pick" data-testid="sticker-pick" data-sticker-asset={props.sticker.assetId} disabled={!props.sticker.available} aria-label={`Choose ${props.sticker.emoji || 'sticker'} from ${props.sticker.packName}`} aria-description="Press Space to preview, or Enter to place." aria-keyshortcuts="Space Shift+F10" title={props.sticker.error ?? 'Click to place. Hold or right-click to preview.'}
        onContextMenu={(e) => { e.preventDefault(); cancel(); longPreview = true; showPreview() }}
        onKeyDown={(e) => {
          if (e.key !== ' ' && e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
          e.preventDefault(); cancel()
          if (!e.repeat) showPreview()
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (e.pointerType === 'touch' && !e.isPrimary) { pressed = false; cancel(); dragged = true; setStickerGhost(null); return }
          longPreview = false; dragged = false; touchMoved = false; pressed = true; start = { x: e.clientX, y: e.clientY }
          timer = setTimeout(() => { longPreview = true; guardPreviewRelease(); showPreview() }, 450)
          if (e.pointerType === 'mouse' || e.pointerType === 'pen') e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!pressed) return
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 8) return
          cancel()
          const touch = e.pointerType === 'touch'
          if (touch) {
            touchMoved = true
            // The mobile shelf scrolls sideways; a deliberate upward pull lifts artwork.
            if (!root?.classList.contains('sticker-shelf') || (!dragged && (e.clientY - start.y >= -12 || Math.abs(e.clientY - start.y) < Math.abs(e.clientX - start.x) * 1.3))) return
          }
          if (longPreview || !e.buttons || !packs().some((p) => p.name === props.sticker.packName)) return
          dragged = true; setStickerGhost({ sticker: props.sticker, at: { x: e.clientX, y: e.clientY }, touch })
        }}
        onPointerUp={(e) => {
          pressed = false; cancel()
          if (dragged) {
            const point = canvasStickerPoint({ x: e.clientX, y: e.clientY - (e.pointerType === 'touch' ? STICKER_TOUCH_OFFSET : 0) })
            const target = document.elementFromPoint(e.clientX, e.clientY)
            if (point && target?.closest('.viewport')) { saveScroll(); placeSticker(props.sticker, point); if (!stickerTrayPinned()) setStickerTrayOpen(false) }
            setStickerGhost(null)
          }
        }}
        onPointerCancel={() => { pressed = false; cancel(); dragged = true; setStickerGhost(null) }}
        onClick={() => { cancel(); if (!longPreview && !dragged && !touchMoved) choose() }}>
        <Show when={props.sticker.available} fallback={<span class="sticker-load" aria-label={props.sticker.error || !packLoad(props.sticker.packName)?.preparing ? 'Unavailable; retry loading pack' : 'Loading sticker'}>{props.sticker.emoji || '…'}<small>{props.sticker.error || !packLoad(props.sticker.packName)?.preparing ? 'Retry' : '…'}</small></span>}><StickerImage sticker={props.sticker} /></Show>
      </button>
      <Show when={favorite(props.sticker)}><span class="sticker-favorite-mark" aria-hidden="true">★</span></Show>
    </div>
  }
  return <Show when={stickerTrayOpen()}>
    <aside ref={root} id="sticker-tray" class="sticker-tray" classList={{ 'sticker-shelf': shelf(), 'sticker-browsing': mode() === 'collection' && !large() && !error() && !busy() }} aria-label="Stickers" data-testid="sticker-tray" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}>
      <header class="sticker-head">
        <Show when={large()} fallback={<Show when={mode() !== 'collection'} fallback={<h2>Stickers</h2>}><div class="sticker-preview-heading"><button class="icon-btn" aria-label={backLabel()} onClick={() => changeMode(backMode())}><Icon class="sticker-back-icon">{ToolIcons.open()}</Icon></button><h2>{mode() === 'add' ? 'Add pack' : mode() === 'bot' ? 'Telegram' : 'Pack preview'}</h2></div></Show>}>
          <div class="sticker-preview-heading">
            <button class="icon-btn" aria-label="Back to stickers" data-testid="sticker-preview-back" onClick={() => { setLarge(null); queueMicrotask(focusPreviewOrigin) }}><Icon class="sticker-back-icon">{ToolIcons.open()}</Icon></button>
            <h2>Preview</h2>
          </div>
        </Show>
        <div class="sticker-head-actions">
          <Show when={!phone()}><button class="icon-btn sticker-pin" aria-label="Keep stickers open" aria-pressed={stickerTrayPinned()} title={stickerTrayPinned() ? 'Unpin: close after placing a sticker' : 'Pin: stay open while placing stickers'} onClick={() => setStickerTrayPinned(!stickerTrayPinned())}><Icon>{ToolIcons.pin()}</Icon></button></Show>
          <button class="icon-btn" aria-label="Close stickers" onClick={close}><Icon>{ToolIcons.close()}</Icon></button>
        </div>
      </header>
      <Show when={shownError()}><div class="sticker-error" role="alert">{shownError()}<button class="bar-btn" disabled={busy() || preparingPreview() || !!retrySeconds()} onClick={() => { if (mode() === 'collection') void action(refreshStickers); else if (mode() === 'pack' && preview()) { setError(''); void preparePack(preview()!.name) } else if (mode() === 'pack' && previewName()) { void resolvePack(previewName()!) } else if (mode() === 'add') void resolvePack(link()) }}>{retrySeconds() ? `Retry in ${retrySeconds()}s` : 'Retry'}</button></div></Show>
      <Show when={!large()} fallback={<div class="sticker-detail">
        <div class="sticker-detail-content">
          <div class="sticker-large"><StickerImage sticker={large()!} animate={!playbackPaused(`preview:${large()!.assetId}`)} priority /></div>
          <button class="sticker-source" data-testid="sticker-source-pack" aria-label={`View pack ${previewPackTitle()}`} onClick={() => void resolvePack(large()!.packName)}>
            <span class="sticker-source-copy"><span>From sticker pack</span><strong>{previewPackTitle()}</strong></span>
            <Icon>{ToolIcons.open()}</Icon>
          </button>
          <Show when={!packs().some((p) => p.name === large()!.packName)}><p class="sticker-detail-notice">Add this pack to place stickers or save favorites.</p></Show>
        </div>
        <div class="sticker-actions">
          <button class="primary-btn sticker-place-button" disabled={!large()!.available || !packs().some((p) => p.name === large()!.packName)} onClick={() => { saveScroll(); armSticker(large()!); setLarge(null) }}>Place sticker</button>
          <button class="icon-btn sticker-favorite-button" disabled={!packs().some((p) => p.name === large()!.packName)} aria-label={favorite(large()!) ? 'Unfavorite' : 'Favorite'} title={favorite(large()!) ? 'Unfavorite' : 'Favorite'} aria-pressed={favorite(large()!)} onClick={() => doFavorite(large()!)}><BoardIconSvg icon="star" /></button>
          <Show when={large()!.format !== 'static'}>{(_) => { const key = () => `preview:${large()!.assetId}`, paused = () => playbackPaused(key())
            return <button class="icon-btn sticker-favorite-button" data-testid="sticker-preview-play" aria-label={paused() ? 'Play animation' : 'Pause animation'} title={paused() ? 'Play animation' : 'Pause animation'} onClick={() => togglePlayback(key())}><Icon>{paused() ? ToolIcons.play() : ToolIcons.pause()}</Icon></button> }}</Show>
        </div>
      </div>}>
        <Show when={mode() === 'collection'}>
          <div class="sticker-search"><input aria-label="Search your stickers" placeholder="Search your packs or emoji…" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} /><button class="bar-btn" onClick={() => changeMode('add')}>Add pack</button></div>
          <Suggestions onPreview={(name) => void resolvePack(name)} onAdded={(name) => choosePack(name)} />
          <div class="sticker-pack-strip" aria-label="Your sticker packs"><button classList={{ active: selectedPack() === 'recent' }} aria-pressed={selectedPack() === 'recent'} onClick={() => choosePack('recent')}>Recent</button><button classList={{ active: selectedPack() === 'favorites' }} aria-pressed={selectedPack() === 'favorites'} onClick={() => choosePack('favorites')}>★ Favorites</button><For each={packs()}>{(p) => <button classList={{ active: selectedPack() === p.name }} aria-pressed={selectedPack() === p.name} aria-label={p.title} title={p.title} onClick={() => choosePack(p.name)}><Show when={p.stickers.find((s) => s.available)} keyed>{(s) => <StickerImage sticker={s} />}</Show></button>}</For></div>
          <Show when={currentPack()}><div class="sticker-pack-title"><strong>{currentPack()!.title}</strong><button class="bar-btn" aria-label={`Remove ${currentPack()!.title}`} onClick={remove}>Remove</button></div></Show>
          <Show when={currentPack()?.stickers.some((s) => !s.available)}><div class="sticker-availability"><span>{currentPack()!.stickers.filter((s) => s.available).length} of {currentPack()!.stickers.length} stickers ready.</span><button class="bar-btn" disabled={busy() || !!retrySeconds()} onClick={() => void resolvePack(currentPack()!.name)}>Retry unavailable stickers</button></div></Show>
          <Show when={shown().length} fallback={<div class="sticker-scroll"><Show when={collectionLoaded() || packs().length} fallback={<p class="sticker-loading-collection" role="status">Loading your stickers…</p>}><div class="sticker-empty"><span aria-hidden="true">✦</span><h3>{query() ? 'No stickers found' : packs().length ? selectedPack() === 'favorites' ? 'Keep your favorites here' : 'Make your first mark' : 'Make room for a little fun'}</h3><p>{query() ? 'Try a pack name or an emoji from your collection.' : packs().length ? 'Choose a pack above. Stickers you place appear in Recent.' : 'Bring in a Telegram pack, then decorate your board.'}</p><Show when={!packs().length}><button class="primary-btn" onClick={() => changeMode('add')}>Add pack</button><small>Try t.me/addstickers/Animals</small></Show></div></Show></div>}>
            <StickerGrid stickers={shown()} horizontal={shelf()} ref={(el) => { scroll = el }} focusRef={(focus) => { focusGridSticker = focus }} onScroll={saveScroll}
              initialScroll={{ x: trayHorizontalScroll.get(selectedPack()) ?? 0, y: trayScroll.get(selectedPack()) ?? 0 }}>{(s) => <Tile sticker={s} />}</StickerGrid>
          </Show>
        </Show>
        <Show when={mode() === 'add'}><div class="sticker-add">
          <div class="sticker-flow-intro"><h3>Add a sticker pack</h3><p>Preview a pack, then save it to your collection.</p></div>
          <Suggestions onPreview={(name) => void resolvePack(name)} />
          <form onSubmit={(e) => { e.preventDefault(); void resolvePack(link()) }}>
            <label for="sticker-link">Pack link or short name</label>
            <input id="sticker-link" placeholder="https://t.me/addstickers/Animals" value={link()} onInput={(e) => setLink(e.currentTarget.value)} />
            <button class="primary-btn sticker-primary-action" disabled={busy() || !!retrySeconds()}>{busy() ? 'Opening pack…' : 'Preview pack'}</button>
          </form>
          <div class="sticker-import-alternative">
            <span class="sticker-eyebrow">Have a sticker, but no link?</span>
            <button class="sticker-telegram-option" aria-label="Send a sticker in Telegram ↗" onClick={() => changeMode('bot')}>
              <span><strong>Send a sticker in Telegram</strong><small>Connect your account to find its pack.</small></span><Icon>{ToolIcons.open()}</Icon>
            </button>
          </div>
        </div></Show>
        <Show when={mode() === 'pack' && !preview() && !shownError()}><div class="sticker-pack-opening" role="status"><span class="sticker-spinner" aria-hidden="true" />Opening pack…</div></Show>
        <Show when={mode() === 'pack' && preview()}><div class="sticker-preview-pack">
          <div class="sticker-pack-summary">
            <h3>{preview()!.title}</h3>
            <span>{preview()!.stickers.length} stickers · {preview()!.stickers.filter((s) => s.available).length} ready</span>
            <div class="sticker-pack-attribution"><a href={`https://t.me/addstickers/${encodeURIComponent(preview()!.name)}`} target="_blank" rel="noopener noreferrer">From Telegram ↗</a><Show when={added()}><span class="sticker-added-label"><Icon>{ToolIcons.check()}</Icon>Added</span></Show></div>
            <Show when={preview()!.stickers.some((s) => !!s.animationError)}><p>Some animations use a transparent still. Every available sticker can be placed.</p></Show>
            <Show when={preview()!.stickers.some((s) => !s.available) && !preparingPreview()}><div class="sticker-pack-recovery"><p>Some stickers are unavailable. Your boards keep every sticker already placed.</p><button class="bar-btn" disabled={!!retrySeconds()} onClick={() => { setError(''); void preparePack(preview()!.name) }}>Retry unavailable stickers</button></div></Show>
          </div>
          <StickerGrid stickers={preview()!.stickers} focusRef={(focus) => { focusGridSticker = focus }}>{(s) => <Tile sticker={s} />}</StickerGrid>
          <div class="sticker-pack-actions">
            <Show when={busy() || preparingPreview()}><p role="status">{busy() ? 'Saving pack…' : `Preparing stickers · ${readyCount(preview()!)} of ${preview()!.stickers.length} ready…`}</p></Show>
            <Show when={added()} fallback={<button class="primary-btn sticker-primary-action" disabled={busy() || !preview()!.stickers.some((s) => s.available)} onClick={addPack}>Add pack</button>}><button class="primary-btn sticker-primary-action" onClick={() => { choosePack(preview()!.name); changeMode('collection') }}>Open pack</button></Show>
          </div>
        </div></Show>
        <Show when={mode() === 'bot'}><BotPairing onBack={() => changeMode('add')} onPack={(name) => void resolvePack(name)} /></Show>
      </Show>
      <Show when={!large() && (mode() === 'collection' || mode() === 'pack')}><footer class="sticker-footer">{phone() ? mode() === 'collection' && shown().length ? 'Swipe to browse · drag up to place · hold to preview' : 'Tap to place · hold to preview' : 'Hold, right-click or Space to preview'}</footer></Show>
    </aside>
  </Show>
}

function BotPairing(props: { onBack: () => void; onPack: (name: string) => void }) {
  const [status, setStatus] = createSignal<TelegramStatus | null>(telegramStatus()), [url, setUrl] = createSignal(''), [error, setError] = createSignal(''), [busy, setBusy] = createSignal(false), [now, setNow] = createSignal(Date.now())
  const refresh = async () => setStatus(await refreshTelegram())
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Try again.') } finally { setBusy(false) } }
  void action(refresh)
  const poll = setInterval(() => { setNow(Date.now()); void refresh().catch(() => {}) }, 2000)
  onCleanup(() => clearInterval(poll))
  const start = () => void action(async () => { const result = await api<{ url: string }>('/api/stickers/telegram/challenge', { method: 'POST', json: {} }); setUrl(result.url) })
  const expired = () => !!status()?.challenge && status()!.challenge!.expiresAt <= now()
  return <div class="sticker-bot">
    <div class="sticker-flow-intro"><h3>Send a sticker in Telegram</h3><Show when={!suggestions.length}><p>Find a pack from one sticker. You choose what gets added.</p></Show></div>
    <Show when={error()}><p role="alert" class="sticker-error">{error()}</p></Show>
    <Show when={status()} fallback={<p role="status">Checking your connection…</p>}>
      <Show when={status()?.configured} fallback={<section class="sticker-connection"><h4>Telegram isn’t available yet</h4><p>The server owner hasn’t configured a Telegram bot. You can use a pack link instead.</p><button class="primary-btn sticker-primary-action" onClick={props.onBack}>Paste a pack link</button></section>}>
        <Show when={status()?.pair} fallback={<>
          <section class="sticker-connection">
            <Show when={status()?.challenge && !expired()} fallback={<>
              <h4>{expired() ? 'Connection link expired' : 'Connect your account'}</h4>
              <Show when={expired()} fallback={<ol class="sticker-connection-steps"><li>Open the bot and press Start.</li><li>Return here to confirm your account.</li></ol>}><p>Start again to get a fresh, five-minute connection link.</p></Show>
              <button class="primary-btn sticker-primary-action" disabled={busy()} onClick={start}>{expired() ? 'Pairing expired · Start again' : 'Connect Telegram bot'}</button>
            </>}>
              <Show when={status()?.challenge?.telegramId} fallback={<>
                <h4>Open the bot</h4><p>Press Start in Telegram, then return here to confirm your account.</p>
                <Show when={url()} fallback={<button class="primary-btn sticker-primary-action" disabled={busy()} onClick={start}>Get a new pairing link</button>}>
                  <a class="primary-btn sticker-primary-action" href={url()} target="_blank" rel="noopener noreferrer">Open bot in Telegram ↗</a>
                  <details class="sticker-pairing-link"><summary>Use the connection link</summary><input readOnly aria-label="Telegram bot pairing link" value={url()} onFocus={(e) => e.currentTarget.select()} /></details>
                </Show>
                <p class="sticker-connection-wait" role="status">Waiting for Start · Link expires in five minutes</p>
              </>}>
                <h4>Confirm your account</h4><p>Only connect if this is your Telegram account.</p>
                <strong class="sticker-account-name">{status()?.challenge?.label}</strong>
                <button class="primary-btn sticker-primary-action" disabled={busy()} onClick={() => void action(() => api('/api/stickers/telegram/confirm', { method: 'POST', json: { telegramId: status()?.challenge?.telegramId } }))}>Confirm this account</button>
                <button class="bar-btn sticker-secondary-action" disabled={busy()} onClick={start}>Wrong account · Start again</button>
              </Show>
            </Show>
          </section>
          <Show when={status()?.challenge && !expired()}><button class="bar-btn sticker-quiet-action" disabled={busy()} onClick={() => void action(async () => { await api('/api/stickers/telegram/challenge', { method: 'DELETE' }); setUrl('') })}>Cancel connection</button></Show>
        </>}>
          <section class="sticker-connection sticker-connected">
            <div class="sticker-connection-heading"><Icon>{ToolIcons.check()}</Icon><strong>Connected: {status()?.pair?.label}</strong>
              <button class="bar-btn sticker-disconnect" aria-label="Disconnect Telegram" title="Your packs and placed stickers stay." aria-description="Your packs and placed stickers stay." disabled={busy()} onClick={() => void action(async () => { await api('/api/stickers/telegram', { method: 'DELETE' }); showToast('Telegram disconnected. Your packs and placed stickers stay.') })}>Disconnect</button>
            </div>
            <Show when={!suggestions.length && !status()?.pending?.notice}><p>Send the bot one sticker from the pack you want.</p></Show>
          </section>
        </Show>
      </Show>
      <Show when={status()?.pair}><Suggestions onPreview={props.onPack} /></Show>
      <Show when={status()?.pending?.notice && !status()?.pending?.packName}><section class="sticker-pending">
        <h4>No pack information</h4><p>{status()?.pending?.notice}</p><button class="primary-btn sticker-primary-action" onClick={props.onBack}>Paste a pack link</button>
        <button class="bar-btn sticker-quiet-action" disabled={busy()} onClick={() => void action(() => api('/api/stickers/telegram/pending', { method: 'DELETE' }))}>Dismiss</button>
      </section></Show>
    </Show>
  </div>
}

/** Packs sent to the bot: one compact row each, preparing in the background with a progress ring. */
function Suggestions(props: { onPreview: (name: string) => void; onAdded?: (name: string) => void }) {
  const add = async (name: string, title: string, setAdding: (on: boolean) => void) => {
    setAdding(true)
    try {
      await openPack(name)
      await api(`/api/stickers/packs/${encodeURIComponent(name)}`, { method: 'POST', json: {} })
      await refreshStickers(); void refreshTelegram().catch(() => {})
      // Anything still preparing keeps going; the collection refreshes when it finishes.
      void preparePack(name)
      props.onAdded?.(name)
      showToast(`${title} added to your stickers.`)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Could not add this pack. Try again.') }
    finally { setAdding(false) }
  }
  const dismiss = (name: string) => void api(`/api/stickers/telegram/suggestions/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(refreshTelegram).catch(() => showToast('Could not dismiss. Try again.'))
  return <Show when={suggestions.length}>
    <ul class="sticker-suggestions" aria-label="Packs from Telegram">
      <For each={suggestions}>{(s) => {
        const pack = () => packLoad(s.name)?.pack, total = () => pack()?.stickers.length ?? 0, ready = () => pack() ? readyCount(pack()!) : 0
        const done = () => total() > 0 && ready() === total(), cover = () => pack()?.stickers.find((x) => x.available)
        const [adding, setAdding] = createSignal(false)
        const status = () => !pack() ? 'From Telegram' : packLoad(s.name)?.error && !done() ? 'From Telegram · paused' : done() ? 'From Telegram' : `From Telegram · ${ready()} of ${total()}`
        return <li class="sticker-suggestion">
          <span class="sticker-suggestion-icon" role="img" aria-label={done() ? `${s.title} cover` : `${ready()} of ${total()} stickers ready`}>
            <Show when={!done()}><svg class="sticker-ring-progress" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20" /><circle class="sticker-ring-fill" cx="22" cy="22" r="20" pathLength="100" style={{ 'stroke-dasharray': `${total() ? ready() / total() * 100 : 0} 100` }} /></svg></Show>
            <Show when={cover()} keyed fallback={<span class="sticker-suggestion-placeholder" aria-hidden="true" />}>{(c) => <StickerImage sticker={c} />}</Show>
          </span>
          <span class="sticker-suggestion-copy"><strong>{s.title}</strong><small>{status()}</small></span>
          <span class="sticker-suggestion-actions">
            <button class="icon-btn" aria-label={`Preview ${s.title}`} title="Preview" onClick={() => props.onPreview(s.name)}><Icon size={18}>{ToolIcons.eye()}</Icon></button>
            <button class="icon-btn sticker-suggestion-add" aria-label={`Add ${s.title}`} title={ready() ? 'Add to your stickers' : 'Preparing stickers…'} disabled={!ready() || adding()} onClick={() => void add(s.name, s.title, setAdding)}><Icon size={18}>{ToolIcons.plus()}</Icon></button>
            <button class="icon-btn sticker-suggestion-dismiss" aria-label={`Dismiss ${s.title}`} title="Dismiss" onClick={() => dismiss(s.name)}><Icon size={16}>{ToolIcons.close()}</Icon></button>
          </span>
        </li>
      }}</For>
    </ul>
  </Show>
}
