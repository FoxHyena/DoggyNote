// Ways into the app from a phone: something shared from another app arrives
// at /share?title&text&url (Android share target), and the home-screen
// shortcut opens /?inbox=1. Both are remembered across sign-in and handled
// once the Inbox exists.

const KEY = 'doggynote.launch'

type Launch = { share?: string; title?: string; inbox?: boolean }

/**
 * What to drop in the Inbox from a share. A bare link becomes a link card
 * (its preview brings the page title back); a link with your own words stays
 * a note with both; words alone are a note.
 */
export function sharedText(title: string, text: string, url: string): string {
  const t = text.trim()
  const link = url || t.match(/https?:\/\/\S+/)?.[0] || ''
  if (!link) return [title.trim(), t].filter(Boolean).join('\n')
  const words = t.replace(link, '').trim()
  if (!words || words === title.trim()) return link
  return t.includes(link) ? t : `${t} ${link}`
}

/** Before routing: note the intent and tidy the address bar. */
export function captureLaunch() {
  const u = new URL(location.href)
  let launch: Launch | null = null
  if (u.pathname === '/share') {
    const p = (k: string) => u.searchParams.get(k) ?? ''
    launch = { share: sharedText(p('title'), p('text'), p('url')), title: p('title').trim() || undefined, inbox: true }
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
