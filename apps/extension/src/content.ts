import { themeVars, COPY } from '@doggynote/theme'

// One delegated hover listener supports lazy/infinite feeds without scanning the DOM.
if (location.origin !== __API_BASE__ && !['notepad.dog', 'www.notepad.dog', 'doggynote.oreothehyena.workers.dev'].includes(location.hostname)) {
  const host = document.createElement('div')
  host.dataset.doggynoteClipper = ''
  const shadow = host.attachShadow({ mode: 'closed' }), style = document.createElement('style')
  style.textContent = `:host{all:initial;position:fixed;z-index:2147483647;display:none;${themeVars('dark')}}@media(prefers-color-scheme:light){:host{${themeVars('light')}}}button{all:unset;display:flex;align-items:center;gap:6px;box-sizing:border-box;cursor:pointer;padding:7px 10px;font:600 13px/20px system-ui;background:var(--dn-panel);color:var(--dn-text);border:1px solid var(--dn-border);border-radius:8px;box-shadow:0 4px 12px var(--dn-scrim)}button:hover{background:var(--dn-card-hover)}button:focus-visible{outline:2px solid var(--dn-selection);outline-offset:2px}img{width:18px;height:18px;pointer-events:none}`
  const button = document.createElement('button'), icon = document.createElement('img')
  icon.src = chrome.runtime.getURL('paw.svg'); icon.alt = ''
  button.type = 'button'; button.setAttribute('aria-label', `Save image to ${COPY.appName}`)
  button.append(icon, document.createTextNode('Save')); shadow.append(style, button); document.documentElement.append(host)
  let image: HTMLImageElement | undefined, frame = 0
  function eligible(candidate: HTMLImageElement, x: number, y: number) {
    const r = candidate.getBoundingClientRect()
    return candidate.complete && candidate.naturalWidth > 0 && /^https?:/.test(candidate.currentSrc || candidate.src) && r.width >= 96 && r.height >= 96 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  function position() {
    frame = 0
    if (!image?.isConnected) { host.style.display = 'none'; return }
    const r = image.getBoundingClientRect()
    if (r.width < 96 || r.height < 96 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) { host.style.display = 'none'; return }
    host.style.display = 'block'; host.style.left = `${Math.min(innerWidth - 90, Math.max(8, r.left + 8))}px`; host.style.top = `${Math.min(innerHeight - 44, Math.max(8, r.top + 8))}px`
  }
  document.addEventListener('pointerover', (e) => {
    if (e.target === host) return
    let candidate = e.target instanceof HTMLImageElement && eligible(e.target, e.clientX, e.clientY) ? e.target : undefined
    // Some image links place a transparent hit target above their <img>.
    for (const parent of e.composedPath().slice(0, 3)) {
      if (candidate || !(parent instanceof HTMLElement) || parent === document.body || parent === document.documentElement) break
      candidate = [...parent.querySelectorAll('img')].slice(0, 8).find((img) => eligible(img, e.clientX, e.clientY))
    }
    if (candidate) { image = candidate; button.replaceChildren(icon, document.createTextNode('Save')); button.removeAttribute('title'); position() }
    else { image = undefined; host.style.display = 'none' }
  }, true)
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.matches(':hover') && e.target.naturalWidth && /^https?:/.test(e.target.currentSrc || e.target.src)) { image = e.target; position() }
  }, true)
  const schedule = () => { if (!frame && image) frame = requestAnimationFrame(position) }
  document.addEventListener('scroll', schedule, { capture: true, passive: true }); window.addEventListener('resize', schedule)
  button.addEventListener('click', (event) => {
    if (!event.isTrusted || !image) return
    event.preventDefault(); event.stopPropagation()
    void chrome.runtime.sendMessage({ type: 'capture', source: { imageUrl: image.currentSrc || image.src, pageUrl: location.href, pageTitle: document.title.slice(0, 1000) } }).then((result: { ok: boolean; error?: string }) => { if (!result.ok) { button.textContent = 'Try again'; button.title = result.error || 'Could not capture this image' } }).catch(() => { button.textContent = 'Reopen Chrome' })
  })
}
