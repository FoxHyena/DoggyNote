import { onCleanup, onMount } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { APP_VERSION } from '../state/updates.ts'
import { Icon, ToolIcons } from './icons.tsx'
import { agentDialogKeys } from './agentDialog.ts'
import tmdbLogo from '../assets/tmdb.svg'
import './agents.css'

// Version and credits, including the attribution TMDB and JustWatch ask for.

export function AboutDialog(props: { onClose: () => void }) {
  let close!: HTMLButtonElement
  onMount(() => {
    close.focus()
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } }
    window.addEventListener('keydown', escape, true)
    onCleanup(() => window.removeEventListener('keydown', escape, true))
  })
  return (
    <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <section class="dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" data-testid="about-dialog" onKeyDown={agentDialogKeys}>
        <div class="agents-heading">
          <h2 id="about-title">About {COPY.appName}</h2>
          <button ref={close} class="icon-btn" aria-label="Close" title="Close" onClick={props.onClose}><Icon>{ToolIcons.close()}</Icon></button>
        </div>
        <p class="about-version">Version {APP_VERSION}</p>
        <h3>Credits</h3>
        <div class="about-credit" data-testid="tmdb-credit">
          <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">
            <img src={tmdbLogo} alt="TMDB" width="137" height="18" />
          </a>
          <p>Movie and show details and posters come from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        </div>
        <p>Where to watch: data from JustWatch, through TMDB.</p>
      </section>
    </div>
  )
}
