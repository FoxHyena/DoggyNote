import { Match, Switch, createSignal, onMount } from 'solid-js'
import { DEFAULT_SIZE, newId, safeHref, type Board, type Card } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { api } from './state/api.ts'
import { checkSession, user } from './state/session.ts'
import { SIZES, importImage, localBlob, markUploaded, type AssetSize } from './state/assets.ts'
import { isTauri } from './state/platform.ts'
import { createTheme } from './theme.ts'
import { IMAGE_TYPES } from './canvas/paste.ts'

// Quick capture (#/capture): a tiny window that drops a note, link or image
// into your Toy box. The Mac app opens it with ⌃⌥Space from anywhere. It
// writes straight to the server (no local board state), then tells the main
// window to sync.

async function hideWindow() {
  if (!isTauri) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}

async function notifyMain() {
  if (!isTauri) return
  const { emit } = await import('@tauri-apps/api/event')
  await emit('toybox-captured')
}

function baseCard(type: Card['type'], toybox: string, content: unknown, extra: Partial<Card> = {}): Card {
  return {
    id: newId(),
    kind: 'card',
    type,
    boardId: toybox,
    x: 0,
    y: 0,
    w: DEFAULT_SIZE[type].w,
    h: DEFAULT_SIZE[type].h,
    z: 1,
    color: 'none',
    columnId: null,
    order: 0,
    content,
    createdAt: Date.now(),
    ...extra,
  } as Card
}

export function Capture() {
  createTheme()
  const [state, setState] = createSignal<'checking' | 'anon' | 'ready' | 'saving' | 'saved' | 'error'>('checking')
  const [message, setMessage] = createSignal('')
  const [text, setText] = createSignal('')
  let input!: HTMLTextAreaElement

  // The window lives as long as the app, so you may sign in after it first
  // loaded: check again each time it's shown.
  async function refresh() {
    if (state() === 'anon' || state() === 'checking') setState((await checkSession()) === 'anon' ? 'anon' : 'ready')
    queueMicrotask(() => input?.focus())
  }

  onMount(() => {
    void refresh()
    window.addEventListener('focus', () => void refresh())
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state() !== 'ready') void hideWindow()
    })
  })

  async function save(cards: Card[]) {
    const u = user()
    if (!u) return
    const toybox = `toybox:${u.id}`
    const board: Board = { id: toybox, kind: 'board', parentId: null, title: COPY.unsorted, icon: 'ball', color: 'gold', createdAt: Date.now() }
    setState('saving')
    try {
      await api('/api/sync', {
        method: 'POST',
        json: { changes: [{ id: toybox, patch: board }, ...cards.map((c) => ({ id: c.id, patch: c }))] },
      })
      await notifyMain()
      setText('')
      setState('saved')
      setTimeout(() => {
        setState('ready')
        void hideWindow()
      }, 700)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save')
      setState('error')
    }
  }

  function saveText() {
    const t = text().trim()
    const u = user()
    if (!t || !u) return
    const href = safeHref(t)
    const card =
      href && !/\s/.test(t)
        ? baseCard('link', `toybox:${u.id}`, { url: href, status: 'pending' })
        : baseCard('note', `toybox:${u.id}`, { md: t })
    void save([card])
  }

  async function onPaste(e: ClipboardEvent) {
    const u = user()
    const images = [...(e.clipboardData?.files ?? [])].filter((f) => IMAGE_TYPES.test(f.type))
    if (!images.length || !u) return
    e.preventDefault()
    setState('saving')
    const cards: Card[] = []
    for (const f of images) {
      const img = await importImage(f)
      for (const size of Object.keys(SIZES) as AssetSize[]) {
        const blob = await localBlob(img.assetId, size)
        if (blob) await api(`/api/assets/${img.assetId}/${size}`, { method: 'PUT', body: blob, headers: { 'content-type': blob.type } })
      }
      await markUploaded(img.assetId)
      const w = Math.min(DEFAULT_SIZE.image.w, img.width)
      cards.push(
        baseCard('image', `toybox:${u.id}`, { assetId: img.assetId, width: img.width, height: img.height, sizes: img.sizes }, { w, h: Math.round((w * img.height) / img.width) }),
      )
    }
    await save(cards)
  }

  return (
    <div class="capture" data-testid="capture">
      <Switch>
        <Match when={state() === 'checking'}>
          <p class="capture-hint">{COPY.loading}</p>
        </Match>
        <Match when={state() === 'anon'}>
          <p class="capture-hint">Sign in to {COPY.appName} first, then try again.</p>
        </Match>
        <Match when={true}>
          <textarea
            ref={input}
            class="capture-input"
            data-testid="capture-input"
            placeholder={`Drop it in your ${COPY.unsorted}: a thought, a link, or paste an image`}
            value={text()}
            disabled={state() === 'saving'}
            onInput={(e) => setText(e.currentTarget.value)}
            onPaste={(e) => void onPaste(e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                saveText()
              } else if (e.key === 'Escape') {
                setText('')
                void hideWindow()
              }
            }}
          />
          <div class="capture-status" data-testid="capture-status" data-state={state()}>
            {state() === 'saved' ? `🐾 Saved to your ${COPY.unsorted}` : state() === 'error' ? message() : 'Enter to save · Esc to close'}
          </div>
        </Match>
      </Switch>
    </div>
  )
}
