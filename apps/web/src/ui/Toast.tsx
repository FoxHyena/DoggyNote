import { Show } from 'solid-js'
import { setToast, toast } from '../state/toast.ts'

export function Toast() {
  return (
    <Show when={toast()}>
      <div class="toast" role="status" data-testid="toast" onClick={() => setToast(null)}>
        {toast()}
      </div>
    </Show>
  )
}
