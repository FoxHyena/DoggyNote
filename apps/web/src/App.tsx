import { Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import { COPY } from '@doggynote/theme'
import * as doc from './state/doc.ts'
import { createTheme } from './theme.ts'
import { Canvas } from './canvas/Canvas.tsx'
import { Toolbar } from './ui/Toolbar.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { ConnectBanner, SelectionBar } from './ui/SelectionBar.tsx'
import { TrashPanel } from './ui/TrashPanel.tsx'
import { Loader } from './ui/Loader.tsx'
import { Login } from './ui/Login.tsx'
import { AccountMenu, SyncStatus } from './ui/AccountMenu.tsx'
import { ShareButton } from './ui/ShareDialog.tsx'
import { BoardActions } from './ui/BoardActions.tsx'
import { CanvasControls } from './ui/CanvasControls.tsx'
import { installShortcuts } from './ui/shortcuts.ts'
import { boardId, endEdit, openBoard } from './state/ui.ts'
import { noteMarkdown, type Card, type Id, type Obj } from '@doggynote/core'
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
import { CommentsPanel } from './ui/CommentsPanel.tsx'
import { Toast } from './ui/Toast.tsx'
import { ensureToybox } from './state/toybox.ts'
import { startUpdateChecks } from './state/updates.ts'
import { paletteOpen, setPaletteOpen } from './state/ui.ts'
import { Icon, ToolIcons } from './ui/icons.tsx'
import { Signup } from './ui/Signup.tsx'
import { EditInvite } from './ui/EditInvite.tsx'
import { BoardNavigation } from './ui/BoardNavigation.tsx'
import { canEditBoard, canManageBoard, canReadBoard, homeBoardId } from './state/access.ts'
import { installNativeSave } from './state/lifecycle.ts'
import { ExitSaveDialog } from './ui/ExitSaveDialog.tsx'
import { EditDock } from './ui/EditDock.tsx'
import { MobileDock } from './ui/MobileDock.tsx'
import { installSheetDrag } from './ui/sheet.ts'
import { phone } from './state/device.ts'

export default function Root() {
  installLinkHandler()
  const invitation = location.pathname.match(/^\/(signup|reset)\/([^/]+)/)
  if (invitation) return <Signup token={decodeURIComponent(invitation[2])} mode={invitation[1] === 'reset' ? 'reset' : 'signup'} />
  const join = location.pathname.match(/^\/join\/([^/]+)/)
  if (join) return <EditInvite token={decodeURIComponent(join[1])} />
  const joinQuery = new URLSearchParams(location.search).get('join')
  if (joinQuery) return <EditInvite token={joinQuery} />
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
      const { first } = await startSync({ onSignedOut: () => setSignedOut(true) })
      // Quick captures land on the server; pull them in right away.
      if (isTauri) void import('@tauri-apps/api/event').then(({ listen }) => listen('toybox-captured', () => void syncNow()))
      // Permissions and the personal home are established before showing cached content.
      await first
      doc.setWriteGuard((object) => canEditBoard(object.kind === 'board' ? object.id : object.boardId))
      if (!location.hash && boardId() === 'home' && !localStorage.getItem('doggynote.lastBoard')) openBoard(homeBoardId())
      // The remembered board may have been deleted. Only decide once the first
      // sync has had its say, or a slow pull would bounce us home.
      void first.then(() => {
        if (!doc.getBoard(boardId()) || !canReadBoard(boardId())) openBoard(homeBoardId())
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

  onMount(() => onCleanup(installSheetDrag()))

  onMount(() => {
    const off = installShortcuts({ get readOnly() { return !canEditBoard(boardId()) } })
    let nativeOff: (() => void) | undefined
    let disposed = false
    void installNativeSave().then((cleanup) => { if (disposed) cleanup(); else nativeOff = cleanup }).catch(console.warn)
    // Don't lose an in-progress edit when the window goes away.
    const save = () => {
      endEdit()
      void doc.flush().catch(() => {})
    }
    const onVis = () => document.visibilityState === 'hidden' && save()
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onVis)
    onCleanup(() => {
      disposed = true
      nativeOff?.()
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
        <div class="app" classList={{ 'read-only': !canEditBoard(boardId()), phone: phone() }}>
          <TopBar
            readOnly={!canEditBoard(boardId())}
            left={<Show when={!phone()}><BoardNavigation /></Show>}
            status={<SyncStatus />}
            permission={<Show when={!canManageBoard(boardId())}><span class="share-permission" data-testid="board-permission">{canEditBoard(boardId()) ? 'Can edit' : 'View only'}</span></Show>}
            right={
              <>
                <Show when={!phone()}>
                  <button class="icon-btn" data-testid="open-fetch" aria-label={`${COPY.search} (⌘K)`} data-tooltip={`${COPY.search} (⌘K)`} onClick={() => setPaletteOpen(true)}><Icon>{ToolIcons.search()}</Icon></button>
                  <ToyboxButton />
                </Show>
                <BoardActions boardId={boardId()} primary={<ShareButton boardId={boardId()} />} />
                <AccountMenu mode={theme.mode()} onThemeChange={theme.setMode} />
              </>
            }
          />
          <Show when={canEditBoard(boardId()) && !phone()}><Toolbar /></Show>
          <main class="stage">
            <Show when={canReadBoard(boardId()) && doc.getBoard(boardId())} fallback={<div class="gone"><h1>This board is unavailable</h1><p>Your access may have changed. Your other boards are still available.</p><button class="primary-btn" onClick={() => openBoard(homeBoardId())}>My Doghouse</button></div>}>
              <Canvas readOnly={!canEditBoard(boardId())} />
            </Show>
            <Show when={canEditBoard(boardId())}><SelectionBar /><ConnectBanner /><TrashPanel /></Show>
            <CanvasControls readOnly={!canEditBoard(boardId())} />
            <ToyboxPanel />
            <CommentsPanel readOnly={!canEditBoard(boardId())} />
            <Toast />
          </main>
          <Show when={phone()}><MobileDock readOnly={!canEditBoard(boardId())} /></Show>
        </div>
        <Show when={paletteOpen()}>
          <FetchPalette />
        </Show>
        <EditDock />
        <ExitSaveDialog />
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
