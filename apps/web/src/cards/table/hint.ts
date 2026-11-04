// The first-run hint under a brand-new table. "Seen" lives in localStorage, like the app's
// other small settings: a use is counted each time the hint is shown, and a first filled
// cell (or any other change) ends it for good. Storage that is unavailable just shows it each time.

const KEY = 'doggynote.tableHint'
/** The hint is shown at most this many times to someone who never fills anything in. */
export const HINT_USES = 3

function uses(): number {
  try { const n = Number(localStorage.getItem(KEY)); return Number.isInteger(n) && n > 0 ? n : 0 } catch { return 0 }
}
const remember = (n: number) => { try { localStorage.setItem(KEY, String(n)) } catch { /* private mode: it shows again, which is harmless */ } }

/** Should this table show the hint? Counts the showing, so call it once per edit. */
export function takeHint(): boolean {
  const n = uses()
  if (n >= HINT_USES) return false
  remember(n + 1)
  return true
}

/** Someone filled something in: they have the idea. */
export const finishHint = () => remember(HINT_USES)
