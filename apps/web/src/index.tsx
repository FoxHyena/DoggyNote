/* @refresh reload */
import { lazy } from 'solid-js'
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
// After every component's CSS: phone and touch rules override desktop ones.
import './ui/mobile.css'
import { installThemeCss } from './theme.ts'
import { installTooltips } from './ui/tooltip.ts'
import { docsRoute } from './docs/schema.ts'

// The public guides at /docs are their own small page: no sign-in, no board, no /api.
const Docs = lazy(() => import('./docs/Docs.tsx'))

installThemeCss()
// The desktop window draws its traffic lights over our top bar.
if ('__TAURI_INTERNALS__' in window) document.documentElement.classList.add('tauri')
installTooltips()
render(() => (docsRoute(location.pathname).isDocs ? <Docs /> : <App />), document.getElementById('root')!)
