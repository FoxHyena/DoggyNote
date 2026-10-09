import { request } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { WEB_PORT } from './ports.ts'

/** Sign in once as rex and save the session cookie for every test. */
export default async function globalSetup() {
  mkdirSync('e2e/.auth', { recursive: true })
  const ctx = await request.newContext({ baseURL: `http://localhost:${WEB_PORT}` })
  const res = await ctx.post('/api/auth/login', { data: { username: 'rex', password: 'goodboy123' } })
  if (!res.ok()) throw new Error(`e2e login failed: ${res.status()} ${await res.text()}`)
  await ctx.storageState({ path: 'e2e/.auth/rex.json' })
  await ctx.dispose()
}
