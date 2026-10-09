import { Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import { COPY } from '@doggynote/theme'
import * as doc from './state/doc.ts'
import { createTheme } from './theme.ts'
import { ThemeToggle } from './ThemeToggle.tsx'
import { Canvas } from './canvas/Canvas.tsx'
import { Toolbar } from './ui/Toolbar.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { SelectionBar } from './ui/SelectionBar.tsx'
import { TrashPanel } from './ui/TrashPanel.tsx'
import { Loader } from './ui/Loader.tsx'
import { Login } from './ui/Login.tsx'
import { AccountMenu, SyncStatus } from './ui/AccountMenu.tsx'
import { ShareButton } from './ui/ShareDialog.tsx'
import { installShortcuts } from './ui/shortcuts.ts'
import { boardId, endEdit, openBoard } from './state/ui.ts'
import { HOME_BOARD_ID, noteMarkdown, type Card, type Id, type Obj } from '@doggynote/core'
import { checkSession } from './state/session.ts'
import { startSync } from './state/sync.ts'
import { installLinkHandler } from './state/platform.ts'
import { Viewer } from './Viewer.tsx'
import { Capture } from './Capture.tsx'
import { isTauri } from './state/platform.ts'
import { syncNow } from './state/sync.ts'
import { FetchPalette } from './ui/Fetch.tsx'
import { Diagnostics } from './ui/Diagnostics.tsx'
import { UpdateToast } from './ui/UpdateToast.tsx'
import { ToyboxButton, ToyboxPanel } from './ui/ToyboxPanel.tsx'
import { ensureToybox } from './state/toybox.ts'
import { snapToGrid, toggleSnap } from './state/grid.ts'
import { startUpdateChecks } from './state/updates.ts'
import { paletteOpen, setPaletteOpen } from './state/ui.ts'
import { Icon, ToolIcons } from './ui/icons.tsx'

export default function Root() {
  installLinkHandler()
  const share = location.pathname.match(/^\/s\/([^/]+)/)
  if (share) return <Viewer token={decodeURIComponent(share[1])} />
  if (location.hash.startsWith('#/capture')) return <Capture />
  return <EditorApp />
}

type Phase = 'checking' | 'login' | 'booting' | 'ready'

function EditorApp() {
  const theme = createTheme()
  const [phase, setPhase] = createSignal<Phase>('checking')
  const [signedOut, setSignedOut] = createSignal(false)
  let booted = false

  async function boot() {
    setPhase('booting')
    if (!booted) {
      booted = true
      // Warm the editor so the first note opens instantly, and so notes stay
      // editable offline (the chunk can't be fetched then). Viewers never load it.
      void import('./editor/codemirror.ts')
      await doc.load({ persist: true, readOnly: false })
      const { first, fresh } = await startSync({ onSignedOut: () => setSignedOut(true) })
      // Quick captures land on the server; pull them in right away.
      if (isTauri) void import('@tauri-apps/api/event').then(({ listen }) => listen('toybox-captured', () => void syncNow()))
      // A new device pulls before creating the home board, so it doesn't clobber the real one.
      if (fresh) await first
      doc.ensureHome(COPY.home)
      // The remembered board may have been deleted. Only decide once the first
      // sync has had its say, or a slow pull would bounce us home.
      void first.then(() => {
        if (!doc.getBoard(boardId())) openBoard(HOME_BOARD_ID)
        migrateNotesToMarkdown()
        ensureToybox()
      })
    }
    setSignedOut(false)
    setPhase('ready')
    startUpdateChecks()
  }

  onMount(async () => {
    const s = await checkSession()
    if (s === 'anon') setPhase('login')
    else await boot()
  })

  onMount(() => {
    const off = installShortcuts({ readOnly: false })
    // Don't lose an in-progress edit when the window goes away.
    const save = () => {
      endEdit()
      void doc.flush()
    }
    const onVis = () => document.visibilityState === 'hidden' && save()
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onVis)
    onCleanup(() => {
      off()
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onVis)
    })
  })

  return (
    <Switch>
      <Match when={phase() === 'checking' || phase() === 'booting'}>
        <Loader />
      </Match>
      <Match when={phase() === 'login'}>
        <Login onLogin={() => void boot()} />
      </Match>
      <Match when={phase() === 'ready'}>
        <div class="app">
          <TopBar
            readOnly={false}
            right={
              <>
                <button class="icon-btn" data-testid="open-fetch" title={`${COPY.search} (⌘K)`} onClick={() => setPaletteOpen(true)}>
                  <Icon>{ToolIcons.search()}</Icon>
                  <span class="icon-btn-label">{COPY.search}</span>
                </button>
                <button
                  class="icon-btn"
                  classList={{ on: snapToGrid() }}
                  data-testid="snap-toggle"
                  aria-pressed={snapToGrid()}
                  title={`Snap to grid: ${snapToGrid() ? 'on' : 'off'} (⌘')`}
                  onClick={toggleSnap}
                >
                  <Icon>{ToolIcons.grid()}</Icon>
                </button>
                <ToyboxButton />
                <SyncStatus />
                <ShareButton boardId={boardId()} />
                <ThemeToggle mode={theme.mode()} onCycle={theme.cycle} />
                <AccountMenu />
              </>
            }
          />
          <Toolbar />
          <main class="stage">
            <Canvas readOnly={false} />
            <SelectionBar />
            <TrashPanel />
            <ToyboxPanel />
          </main>
        </div>
        <Show when={paletteOpen()}>
          <FetchPalette />
        </Show>
        <Diagnostics />
        <UpdateToast />
        <Show when={signedOut()}>
          <div class="dialog-backdrop">
            <Login onLogin={() => void boot()} />
          </div>
        </Show>
      </Match>
    </Switch>
  )
}

/**
 * One-time move from the old ProseMirror note format to markdown. Runs after
 * the first sync on every device; once one device has converted a note, the
 * others just receive the markdown. Not an undo step.
 */
function migrateNotesToMarkdown() {
  const patches: Record<Id, Partial<Obj>> = {}
  for (const o of Object.values(doc.objs)) {
    if (o.kind !== 'card' || o.type !== 'note' || o.purged) continue
    const c = o as Card<'note'>
    if (typeof (c.content as { md?: unknown }).md !== 'string') patches[c.id] = { content: { md: noteMarkdown(c) } } as Partial<Card>
  }
  if (Object.keys(patches).length) doc.silent(patches)
}
