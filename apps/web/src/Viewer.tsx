import { Match, Switch, createResource, onCleanup, onMount } from 'solid-js'
import { installShortcuts } from './ui/shortcuts.ts'
import type { Obj } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { ApiError, api, setShareToken } from './state/api.ts'
import * as doc from './state/doc.ts'
import { boardId, setRootBoard } from './state/ui.ts'
import { createTheme } from './theme.ts'
import { ThemeToggle } from './ThemeToggle.tsx'
import { CanvasControls } from './ui/CanvasControls.tsx'
import { Canvas } from './canvas/Canvas.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { Loader } from './ui/Loader.tsx'
import { CommentsPanel } from './ui/CommentsPanel.tsx'
import { BoardIconSvg, DogMark } from './ui/icons.tsx'

type Shared = { rootBoardId: string; sharedBoards: string[]; objects: Obj[] }

/** Read-only viewer for /s/<token>. Nothing is stored on the viewer's device. */
export function Viewer(props: { token: string }) {
  const theme = createTheme()
  onCleanup(installShortcuts({ readOnly: true }))
  const [data, { refetch }] = createResource(async () => {
    let res: Shared
    try { res = await api<Shared>(`/api/share/${encodeURIComponent(props.token)}`) }
    catch (error) {
      if (error instanceof ApiError && [403, 404, 410].includes(error.status)) { doc.loadSnapshot([]); setShareToken(null) }
      throw error
    }
    setShareToken(props.token)
    await doc.load({ persist: false, readOnly: true })
    doc.loadSnapshot(res.objects)
    setRootBoard(res.rootBoardId)
    return res
  })
  onMount(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void refetch() }
    const timer = setInterval(refresh, 10_000)
    window.addEventListener('focus', refresh)
    onCleanup(() => { clearInterval(timer); window.removeEventListener('focus', refresh); setShareToken(null) })
  })

  const notFoundMsg = () => (data.error instanceof ApiError ? data.error.message : "Couldn't load this board.")

  return (
    <Switch>
      <Match when={data.loading && !data.latest}>
        <Loader />
      </Match>
      <Match when={data.error}>
        <div class="gone" data-testid="share-gone">
          <div class="gone-emoji" aria-hidden="true">
            <DogMark size={112} />
          </div>
          <h1>This link has gone walkies</h1>
          <p>{notFoundMsg()}</p>
        </div>
      </Match>
      <Match when={data.latest}>
        <div class="app viewer" data-testid="viewer">
          <TopBar readOnly root={data.latest!.rootBoardId} right={<ThemeToggle mode={theme.mode()} onThemeChange={theme.setMode} />} />
          <main class="stage">
            <Switch>
              <Match when={data.latest!.sharedBoards.includes(boardId()) && doc.getBoard(boardId())}>
                <Canvas readOnly />
              </Match>
              <Match when={true}>
                <div class="gone">
                  <h1>Not shared</h1>
                  <p>This board isn't part of the link.</p>
                </div>
              </Match>
            </Switch>
            <CanvasControls readOnly />
            <CommentsPanel readOnly />
            <a class="made-with" href="/" target="_blank" rel="noopener">
              <BoardIconSvg icon="paw" size={16} /> {COPY.appName}
            </a>
          </main>
        </div>
      </Match>
    </Switch>
  )
}
