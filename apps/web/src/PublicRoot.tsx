import { lazy, Show, Suspense, createSignal, onCleanup, type Component } from 'solid-js'
import { docsRoute } from './docs/schema.ts'
import { Loader } from './ui/Loader.tsx'

const Docs = lazy(() => import('./docs/Docs.tsx'))

/** Gate only the initial module import, never resources owned by the app. */
function AppBootstrap() {
  const [app, setApp] = createSignal<Component>()
  const [failed, setFailed] = createSignal(false)
  let disposed = false
  onCleanup(() => { disposed = true })
  void import('./App.tsx').then(module => {
    if (!disposed) setApp(() => module.default)
  }).catch(() => { if (!disposed) setFailed(true) })

  // An App-wide Suspense would also hide mounted boards when a local dialog or
  // editor suspends, changing focus and allowing hidden content to be measured.
  return <Show when={app()} keyed fallback={
    <Show when={failed()} fallback={<Loader />}>
      <div class="gone" role="alert"><h1>Could not load the app</h1><p>Reload to try again.</p><button class="primary-btn" onClick={() => location.reload()}>Reload</button></div>
    </Show>
  }>{ReadyApp => <ReadyApp />}</Show>
}

export default function PublicRoot() {
  // Select public docs before importing App or initializing private board state.
  // Loader itself only imports theme copy and presentation icons.
  if (docsRoute(location.pathname).isDocs) {
    return <Suspense fallback={<p role="status">Loading documentation…</p>}><Docs /></Suspense>
  }
  return <AppBootstrap />
}
