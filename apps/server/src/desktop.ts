import { Hono } from 'hono'
import type { AppEnv, Env } from './env.ts'

// Desktop releases live in R2 under "desktop/":
//   desktop/latest.json                       fallback manifest (last published release)
//   desktop/<version>/latest.json             staged manifest, served by the Worker whose APP_VERSION matches
//   desktop/<version>/DoggyNote.app.tar.gz    signed update bundle
//   desktop/<version>/DoggyNote_<v>_<arch>.dmg first-install disk image
// These are public: app binaries aren't secret, and the GitHub repo is private,
// so its release assets can't be downloaded without a token.

const VERSION = /^\d+\.\d+\.\d+$/
const FILE = /^DoggyNote(?:\.app\.tar\.gz|_\d+\.\d+\.\d+_[a-z0-9_]+\.dmg)$/

type Manifest = { version: string; platforms: Record<string, { url: string; signature: string }> }

export const desktop = new Hono<AppEnv>()

/** The release deploys this Worker with APP_VERSION before the Mac build is
 * staged (unless MIN_CLIENT changes; see release.yml). Its manifest is written
 * to R2 last, after the bundle and DMG, so it appears here only once complete.
 * Until then, and on older Workers, the last published release is served. */
async function releaseManifest(env: Env): Promise<R2ObjectBody | null> {
  if (env.APP_VERSION && VERSION.test(env.APP_VERSION)) {
    const staged = await env.BUCKET.get(`desktop/${env.APP_VERSION}/latest.json`)
    if (staged) return staged
  }
  return env.BUCKET.get('desktop/latest.json')
}

/** Which version the server (and the web app it serves) is on, and the oldest client it still supports. */
desktop.get('/version', (c) => {
  c.header('cache-control', 'no-store')
  return c.json({ version: c.env.APP_VERSION ?? 'dev', minClient: c.env.MIN_CLIENT ?? '0.0.0' })
})

desktop.get('/desktop/latest.json', async (c) => {
  const obj = await releaseManifest(c.env)
  if (!obj) return c.json({ error: 'No desktop release yet' }, 404)
  return new Response(obj.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
})

/** A link you can hand to friends: always the newest disk image. */
desktop.get('/desktop/download', async (c) => {
  const obj = await releaseManifest(c.env)
  if (!obj) return c.json({ error: 'No desktop release yet' }, 404)
  const m = (await obj.json()) as Manifest & { dmg?: string }
  if (!m.dmg || !VERSION.test(m.version) || !FILE.test(m.dmg)) return c.json({ error: 'Release has no disk image' }, 404)
  c.header('cache-control', 'no-store')
  return c.redirect(`/api/desktop/files/${m.version}/${m.dmg}`, 302)
})

desktop.get('/desktop/files/:version/:name', async (c) => {
  const { version, name } = c.req.param()
  if (!VERSION.test(version) || !FILE.test(name)) return c.json({ error: 'Not found' }, 404)
  const obj = await c.env.BUCKET.get(`desktop/${version}/${name}`)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  if (name.endsWith('.dmg')) headers.set('content-disposition', `attachment; filename="${name}"`)
  return new Response(obj.body, { headers })
})
