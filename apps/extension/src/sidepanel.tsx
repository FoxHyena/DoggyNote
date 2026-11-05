import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { render } from 'solid-js/web'
import { COPY, themeCss, parseMode, resolveTheme, nextMode, type ThemeMode } from '@doggynote/theme'
import type { ClipperBoard } from '@doggynote/core'
import { command, type BoardsResult, type PanelState } from './protocol.ts'
import { getDraft } from './storage.ts'
import './style.css'

const theme = document.createElement('style'); theme.textContent = themeCss(); document.head.prepend(theme)
function Panel() {
  const [state, setState] = createSignal<PanelState>({ connected: false })
  const [boards, setBoards] = createSignal<ClipperBoard[]>([]), [board, setBoard] = createSignal(''), [query, setQuery] = createSignal('')
  const [busy, setBusy] = createSignal(false), [error, setError] = createSignal(''), [preview, setPreview] = createSignal('')
  const [boardsError, setBoardsError] = createSignal(''), [boardsLoading, setBoardsLoading] = createSignal(false)
  const [mode, setMode] = createSignal<ThemeMode>(parseMode(localStorage.getItem('theme')))
  let currentPreview = '', loading = false, refreshAgain = false, prepared = ''
  const media = matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = () => { document.documentElement.dataset.theme = resolveTheme(mode(), media.matches) }
  applyTheme()
  const caption = () => mode() === 'system' ? 'System' : mode() === 'dark' ? 'Dark' : 'Light'
  async function refresh() {
    if (loading) { refreshAgain = true; return }
    loading = true
    try {
      const result = await command<PanelState>('state')
      if (result.username !== state().username) { setBoards([]); setBoard('') }
      setState(result)
      // Local image bytes must remain usable even when the board API is unreachable.
      const draft = await getDraft(), blob = draft?.renditions?.find((r) => r.size === 'medium')?.blob
      if (currentPreview) { URL.revokeObjectURL(currentPreview); currentPreview = '' }
      if (blob) currentPreview = URL.createObjectURL(blob)
      setPreview(currentPreview)
      if (result.connected) {
        setBoardsLoading(true)
        try {
          const list = await command<BoardsResult>('boards')
          setBoards((current) => list.boards.map((b) => current.find((old) => old.id === b.id && old.path === b.path) ?? b))
          const selected = result.capture?.boardId || board() || result.lastBoardId || ''
          setBoard(list.boards.some((b) => b.id === selected) ? selected : '')
          setBoardsError('')
        } catch (e) { setBoardsError(e instanceof Error ? e.message : 'Could not load your boards. Please retry.') }
        finally { setBoardsLoading(false) }
      } else { setBoards([]); setBoardsError('') }
      if (result.capture?.status === 'selected' && prepared !== result.capture.id) {
        prepared = result.capture.id
        await command('prepare')
        refreshAgain = true
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the clipper.') }
    finally { loading = false; if (refreshAgain) { refreshAgain = false; void refresh() } }
  }
  onMount(() => {
    void refresh()
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => { if (changes.revision) void refresh() }
    chrome.storage.onChanged.addListener(changed)
    const recover = () => { void refresh() }
    window.addEventListener('online', recover)
    window.addEventListener('focus', recover)
    media.addEventListener('change', applyTheme)
    onCleanup(() => { chrome.storage.onChanged.removeListener(changed); media.removeEventListener('change', applyTheme); window.removeEventListener('online', recover); window.removeEventListener('focus', recover); if (currentPreview) URL.revokeObjectURL(currentPreview) })
  })
  async function action(run: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await run() } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Please retry.') }
    finally { setBusy(false); await refresh() }
  }
  const saving = () => busy() || state().capture?.status === 'saving'
  const saved = () => state().capture?.status === 'saved'
  const selected = () => boards().find((b) => b.id === board())
  const openBoard = () => `${__API_BASE__}/?boardInbox=${encodeURIComponent(state().capture?.boardId || '')}`
  return <main>
    <header><img src="paw.svg" width="28" height="28" alt="" /><h1>{COPY.appName}</h1><button class="quiet" onClick={() => { const m = nextMode(mode()); setMode(m); localStorage.setItem('theme', m); applyTheme() }} aria-label={`Appearance: ${caption()}`}>{caption()}</button></header>
    <Show when={state().connected} fallback={<section class="connect"><h2>Collect images for your boards</h2><p>Connect your account, then hover an image on a website and choose Save.</p><p class="muted">Site access lets the clipper show its Save button and download the image you select. Images are sent to DoggyNote when you confirm Save.</p><button class="primary" disabled={busy()} onClick={() => void action(() => command('connect'))}>{busy() ? 'Connecting…' : `Connect ${COPY.appName}`}</button></section>}>
      <Show when={state().capture} fallback={<section><h2>Find something worth keeping</h2><p>Hover an image and choose Save, or right-click an image and choose Save image to DoggyNote.</p></section>}>
        <section class="capture">
          <Show when={preview()} fallback={<div class="preview-placeholder" role="status">{state().capture?.error ? 'Image preview unavailable' : 'Preparing image…'}</div>}><img class="preview" src={preview()} alt={state().capture?.source.pageTitle || 'Image to save'} /></Show>
          <p class="source">From <a href={state().capture?.source.pageUrl} target="_blank" rel="noopener noreferrer">{new URL(state().capture!.source.pageUrl).hostname}</a></p>
          <Show when={!saved()}>
            <label for="board-search">Find a board</label><input id="board-search" type="search" placeholder="Search boards…" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} disabled={saving()} />
            <label for="board-picker">Save to board</label><select id="board-picker" value={board()} disabled={saving()} onChange={(e) => setBoard(e.currentTarget.value)}><option value="" selected={!board()}>Choose a board…</option><For each={boards().filter((b) => b.path.toLowerCase().includes(query().toLowerCase()) || b.id === board())}>{(b) => <option value={b.id} selected={board() === b.id}>{b.path}</option>}</For></select>
            <Show when={boardsError()}><p class="muted">Your image stays on this device while your boards are unavailable.</p><button class="quiet" disabled={boardsLoading()} onClick={() => void refresh()}>Retry boards</button></Show>
            <Show when={!boardsError() && !boardsLoading() && !boards().length}><p>No editable boards found. Create a board in DoggyNote, then reopen this panel.</p></Show>
            <button class="primary save" disabled={saving() || !!boardsError() || !selected() || !preview()} onClick={() => void action(() => command('save', { boardId: board() }))}>{saving() ? 'Saving…' : `Save to ${selected()?.title || 'board'}`}</button>
            <Show when={state().capture?.status === 'error' && !preview()}><button class="quiet" disabled={busy()} onClick={() => void action(() => command('prepare'))}>Retry image download</button></Show>
            <Show when={state().capture?.status === 'saving' && !busy()}><button class="quiet" disabled={!!boardsError() || !selected()} onClick={() => void action(() => command('save', { boardId: board() }))}>Resume interrupted save</button></Show>
          </Show>
          <Show when={saved()}><div class="saved" role="status"><strong>Saved to {selected()?.title || 'your board'}’s Inbox</strong><a class="primary" href={openBoard()} target="_blank" rel="noopener noreferrer">Open board</a><p class="muted">Keep browsing. Choose another image whenever you’re ready.</p></div></Show>
        </section>
      </Show>
      <footer><span>Connected as {state().username}</span><button class="quiet" disabled={busy()} onClick={() => void action(() => command('disconnect'))}>Disconnect</button></footer>
    </Show>
    <Show when={error() || state().capture?.error || boardsError()}><p class="error" role="alert">{error() || state().capture?.error || boardsError()}</p></Show>
  </main>
}
render(() => <Panel />, document.getElementById('root')!)
