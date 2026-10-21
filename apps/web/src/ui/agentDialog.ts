/** Keep modal keyboard actions inside the dialog and away from canvas commands. */
export function agentDialogKeys(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key !== 'Tab') return
  const scope = event.currentTarget as HTMLElement
  const items = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]')].filter((el) => el.offsetParent !== null && el.tabIndex >= 0 && !el.closest('[inert]'))
  const first = items[0], last = items.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
