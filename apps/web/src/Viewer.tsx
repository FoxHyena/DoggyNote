import { Match, Switch, createResource, onCleanup } from 'solid-js'
import { installShortcuts } from './ui/shortcuts.ts'
import type { Obj } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import { ApiError, api, setShareToken } from './state/api.ts'
import * as doc from './state/doc.ts'
import { boardId, setRootBoard } from './state/ui.ts'
import { createTheme } from './theme.ts'
import { ThemeToggle } from './ThemeToggle.tsx'
import { Canvas } from './canvas/Canvas.tsx'
import { TopBar } from './ui/TopBar.tsx'
import { Loader } from './ui/Loader.tsx'

type Shared = { rootBoardId: string; sharedBoards: string[]; objects: Obj[] }

/** Read-only viewer for /s/<token>. Nothing is stored on the viewer's device. */
export function Viewer(props: { token: string }) {
  const theme = createTheme()
  onCleanup(installShortcuts({ readOnly: true }))
  const [data] = createResource(async () => {
    const res = await api<Shared>(`/api/share/${encodeURIComponent(props.token)}`)
    setShareToken(props.token)
    await doc.load({ persist: false, readOnly: true })
    doc.loadSnapshot(res.objects)
    setRootBoard(res.rootBoardId)
    return res
  })

  const notFoundMsg = () => (data.error instanceof ApiError ? data.error.message : "Couldn't load this board.")

  return (
    <Switch>
      <Match when={data.loading}>
        <Loader />
      </Match>
      <Match when={data.error}>
        <div class="gone" data-testid="share-gone">
          <div class="gone-emoji" aria-hidden="true">
            🐕‍🦺
          </div>
          <h1>This link has gone walkies</h1>
          <p>{notFoundMsg()}</p>
        </div>
      </Match>
      <Match when={data()}>
        <div class="app viewer" data-testid="viewer">
          <TopBar readOnly root={data()!.rootBoardId} right={<ThemeToggle mode={theme.mode()} onCycle={theme.cycle} />} />
          <main class="stage">
            <Switch>
              <Match when={data()!.sharedBoards.includes(boardId()) && doc.getBoard(boardId())}>
                <Canvas readOnly />
              </Match>
              <Match when={true}>
                <div class="gone">
                  <h1>Not shared</h1>
                  <p>This board isn't part of the link.</p>
                </div>
              </Match>
            </Switch>
            <a class="made-with" href="/" target="_blank" rel="noopener">
              🐾 {COPY.appName}
            </a>
          </main>
        </div>
      </Match>
    </Switch>
  )
}
