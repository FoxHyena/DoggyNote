// Password hashing and tokens with WebCrypto only, so the same code runs in
// Workers and in Node (the create-user script). Workers cap PBKDF2 at 100k
// iterations.

const ITERATIONS = 100_000
const enc = new TextEncoder()

export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false
  const got = await derive(password, fromB64url(salt), Number(iter))
  const want = fromB64url(hash)
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i]
  return diff === 0
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** `<userId>.<expiresAtMs>.<sig>`: lets <img> tags fetch images for a signed-in user without a header. */
export async function signAssetToken(secret: string, userId: string, expiresAt: number): Promise<string> {
  const payload = `${userId}.${expiresAt}`
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)))
  return `${payload}.${b64url(sig)}`
}

/** The user id if the token is genuine and unexpired, else null. */
export async function verifyAssetToken(secret: string, token: string, now: number): Promise<string | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, exp, sig] = parts
  if (!userId || !(Number(exp) > now)) return null
  let sigBytes: Uint8Array<ArrayBuffer>
  try {
    sigBytes = fromB64url(sig)
  } catch {
    return null
  }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(`${userId}.${exp}`))
  return ok ? userId : null
}
