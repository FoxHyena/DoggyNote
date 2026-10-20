import { Show } from 'solid-js'
import { cancelExitSave, exitSaveProblem, retryExitSave } from '../state/lifecycle.ts'

export function ExitSaveDialog() {
  return <Show when={exitSaveProblem()}><div class="dialog-backdrop">
    <section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="exit-save-title">
      <h2 id="exit-save-title">Your latest changes need saving</h2>
      <p>Local storage could not save your changes. Keep DoggyNote open while you retry.</p>
      <button class="primary-btn" autofocus onClick={() => void retryExitSave()}>Retry saving and quit</button>
      <button class="bar-btn" onClick={() => void cancelExitSave()}>Keep working</button>
    </section>
  </div></Show>
}
