// HTTP client for the Worker. The browser build talks to its own origin with a
// session cookie. The desktop build talks to the deployed server with a bearer
// token (cookies don't cross from tauri:// to https://).

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

let bearer: string | null = null
export const setBearer = (t: string | null) => (bearer = t)
export const hasBearer = () => !!bearer

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (bearer) headers.set('authorization', `Bearer ${bearer}`)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(API_BASE + path, { ...init, headers, body, // Cookies only same-origin (the browser app). The desktop app is cross-origin and uses a bearer token.
    credentials: API_BASE ? 'omit' : 'same-origin' })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, msg)
  }
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>
}

// ---- image URLs ------------------------------------------------------------
// Images need a credential. The browser editor's <img> sends the session cookie
// on its own. The desktop app's <img> is cross-origin and can't send a bearer
// header, so it appends a daily asset token. The share viewer appends its share
// token, which only unlocks images on the boards that link covers.

let shareToken: string | null = null
export const setShareToken = (t: string | null) => (shareToken = t)

let assetToken: { token: string; expiresAt: number } | null = null
let assetTokenReq: Promise<string | null> | null = null

async function currentAssetToken(): Promise<string | null> {
  if (assetToken && assetToken.expiresAt - Date.now() > 3_600_000) return assetToken.token
  assetTokenReq ??= api<{ token: string; expiresAt: number }>('/api/assets/token')
    .then((t) => {
      assetToken = t
      return t.token
    })
    .catch(() => assetToken?.token ?? null)
    .finally(() => (assetTokenReq = null))
  return assetTokenReq
}

export const clearAssetToken = () => (assetToken = null)

/** Server URL for an image, with whatever credential this client needs. */
export async function assetUrl(assetId: string, size: string): Promise<string> {
  const base = `${API_BASE}/api/assets/${encodeURIComponent(assetId)}/${size}`
  if (shareToken) return `${base}?share=${encodeURIComponent(shareToken)}`
  if (bearer) {
    const t = await currentAssetToken()
    return t ? `${base}?t=${encodeURIComponent(t)}` : base
  }
  return base
}
