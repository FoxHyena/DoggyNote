// Runs before first paint (render-blocking in <head>) so there's no flash of
// the wrong theme. A file rather than an inline script so the CSP can forbid
// inline scripts.
;(function () {
  var m = 'dark'
  try {
    m = localStorage.getItem('doggynote.theme') || 'dark'
  } catch (e) {}
  if (m === 'system') m = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = m === 'light' ? 'light' : 'dark'
})()
