// Ways into the app from a phone: something shared from another app arrives
// at /share?title&text&url (Android share target), and the home-screen
// shortcut opens /?inbox=1. Both are remembered across sign-in and handled
// once the Inbox exists.

const KEY = 'doggynote.launch'

type Launch = { share?: string; inbox?: boolean }

/** What to drop in the Inbox from a share: the link if there is one, else the words. */
export function sharedText(title: string, text: string, url: string): string {
  const link = url || text.match(/https?:\/\/\S+/)?.[0] || ''
  if (link) return link
  return [title, text].map((s) => s.trim()).filter(Boolean).join('\n')
}

/** Before routing: note the intent and tidy the address bar. */
export function captureLaunch() {
  const u = new URL(location.href)
  let launch: Launch | null = null
  if (u.pathname === '/share') {
    const p = (k: string) => u.searchParams.get(k) ?? ''
    launch = { share: sharedText(p('title'), p('text'), p('url')), inbox: true }
  } else if (u.searchParams.has('inbox')) launch = { inbox: true }
  if (!launch) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify(launch))
  } catch {
    // storage unavailable: the share is lost, the app still opens
  }
  history.replaceState(null, '', `/${location.hash}`)
}

export function takeLaunch(): Launch {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return raw ? (JSON.parse(raw) as Launch) : {}
  } catch {
    return {}
  }
}
