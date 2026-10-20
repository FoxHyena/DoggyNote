import { Show } from 'solid-js'
import { setToast, setToastAction, toast, toastAction } from '../state/toast.ts'

export function Toast() {
  const dismiss = () => {
    setToast(null)
    setToastAction(null)
  }
  return (
    <Show when={toast()}>
      <div class="toast" role="status" data-testid="toast" onClick={dismiss}>
        <span>{toast()}</span>
        <Show when={toastAction()}>
          <button
            class="toast-action"
            data-testid="toast-action"
            onClick={(e) => {
              e.stopPropagation()
              toastAction()!.run()
              dismiss()
            }}
          >
            {toastAction()!.label}
          </button>
        </Show>
      </div>
    </Show>
  )
}
