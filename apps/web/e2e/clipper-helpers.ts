import { readFileSync } from 'node:fs'
import { expect, type APIRequestContext } from '@playwright/test'
import { CLIPPER_REDIRECT } from '@doggynote/core'

export async function captureBoardImage(api: APIRequestContext, boardId: string, options: { sessionToken?: string; apiBase?: string } = {}) {
  const base = options.apiBase ?? ''
  const sessionHeaders = options.sessionToken ? { authorization: `Bearer ${options.sessionToken}` } : {}
  const verifier = 'a'.repeat(43), challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
  const approval = await api.post(`${base}/api/clipper/authorize`, { headers: sessionHeaders, data: { challenge, state: 'b'.repeat(43), redirectUri: CLIPPER_REDIRECT } })
  expect(approval.ok(), await approval.text()).toBe(true)
  const code = new URL((await approval.json()).redirect).searchParams.get('code')
  const exchange = await api.post(`${base}/api/clipper/exchange`, { data: { code, verifier, redirectUri: CLIPPER_REDIRECT } })
  expect(exchange.status()).toBe(201)
  const { token, id: credentialId } = await exchange.json(), headers = { authorization: `Bearer ${token}` }
  const assetId = crypto.randomUUID(), id = crypto.randomUUID()
  expect((await api.post(`${base}/api/clipper/uploads`, { headers, data: { assetId } })).ok()).toBe(true)
  const bytes = readFileSync('public/icons/icon-192.png')
  for (const size of ['thumb', 'small', 'medium', 'full']) expect((await api.put(`${base}/api/clipper/assets/${assetId}/${size}`, { headers: { ...headers, 'content-type': 'image/png' }, data: bytes })).ok()).toBe(true)
  const response = await api.post(`${base}/api/clipper/clips`, { headers, data: { id, boardId, image: { assetId, width: 192, height: 192, sizes: ['thumb', 'small', 'medium', 'full'] }, source: { pageUrl: 'https://example.com/art', imageUrl: 'https://example.com/dog.png', pageTitle: 'A dog for the collection' } } })
  expect(response.ok(), await response.text()).toBe(true)
  return { id, token, credentialId }
}
