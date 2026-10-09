// Runs before first paint (render-blocking in <head>) so there's no flash of
// the wrong theme. A file rather than an inline script so the CSP can forbid
// inline scripts.
;(function () {
  // www.notepad.dog → notepad.dog. Pages are served without running the Worker,
  // so the redirect for them happens here (the Worker does it for /api).
  if (location.hostname === 'www.notepad.dog') {
    location.replace('https://notepad.dog' + location.pathname + location.search + location.hash)
    return
  }
  var m = 'dark'
  try {
    m = localStorage.getItem('doggynote.theme') || 'dark'
  } catch (e) {}
  if (m === 'system') m = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = m === 'light' ? 'light' : 'dark'
})()
