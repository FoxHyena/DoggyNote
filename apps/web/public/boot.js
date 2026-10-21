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
  // iOS zooms the page into any focused field with text under 16px (card text is
  // 14px and sized to sync across devices). Pinch zoom stays available.
  if (/iP(hone|ad|od)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    var vp = document.querySelector('meta[name=viewport]')
    if (vp) vp.setAttribute('content', vp.getAttribute('content') + ', maximum-scale=1')
    if (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) {
      document.documentElement.classList.add('ios-standalone')
      document.documentElement.style.setProperty('--app-height', innerHeight + 'px')
      // The OS token is frozen at 18.x; Version/ identifies the Safari release.
      var safariVersion = /Version\/(\d+)/.exec(navigator.userAgent)
      if (safariVersion && Number(safariVersion[1]) === 27) document.documentElement.classList.add('ios-status-bar-blur')
    }
  }
  var m = 'dark'
  try {
    m = localStorage.getItem('doggynote.theme') || 'dark'
  } catch (e) {}
  if (m === 'system') m = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = m === 'light' ? 'light' : 'dark'
})()
