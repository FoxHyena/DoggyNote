/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './App.tsx'
// After every component's CSS: phone and touch rules override desktop ones.
import './ui/mobile.css'
import { installThemeCss } from './theme.ts'

installThemeCss()
// The desktop window draws its traffic lights over our top bar.
if ('__TAURI_INTERNALS__' in window) document.documentElement.classList.add('tauri')
render(() => <App />, document.getElementById('root')!)
