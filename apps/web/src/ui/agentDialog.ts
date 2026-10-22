/** Keep modal keyboard actions inside the dialog and away from canvas commands. */
export function agentDialogKeys(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key !== 'Tab') return
  const scope = event.currentTarget as HTMLElement
  const items = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]')].filter((el) => el.offsetParent !== null && !el.closest('[inert]'))
  const first = items[0], last = items.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

/** Modal ownership independent of the browser's platform-specific Tab order. */
export function installModalKeys(scope: HTMLElement, close: () => void, initialFocus: HTMLElement) {
  const items = () => [...scope.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert], [hidden]') && el.getClientRects().length > 0)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' && event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') return close()
    const controls = items()
    const index = controls.indexOf(document.activeElement as HTMLElement)
    const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    const target = controls[next] ?? initialFocus
    target.focus({ preventScroll: true })
  }
  const focus = (event: FocusEvent) => {
    if (!scope.contains(event.target as Node)) initialFocus.focus({ preventScroll: true })
  }
  document.addEventListener('keydown', key, true)
  document.addEventListener('focusin', focus, true)
  return () => {
    document.removeEventListener('keydown', key, true)
    document.removeEventListener('focusin', focus, true)
  }
}
