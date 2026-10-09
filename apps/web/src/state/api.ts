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

export const assetPath = (assetId: string, size: string) => `${API_BASE}/api/assets/${encodeURIComponent(assetId)}/${size}`
