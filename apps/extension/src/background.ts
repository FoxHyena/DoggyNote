import { CLIPPER_REDIRECT } from '@doggynote/core'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, processImage } from '@doggynote/browser-images'
import type { ImageSource } from '@doggynote/core'
import type { Connection, PanelState } from './protocol.ts'
import { clearDraft, getDraft, putDraft, updateDraftIfCurrent } from './storage.ts'

const protectedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
let operation: Promise<unknown> | undefined
async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  if (operation) throw new Error('An image is being prepared or saved. Please wait a moment.')
  const task = run(); operation = task
  try { return await task } finally { operation = undefined }
}
const httpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 8192) return false
  try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false }
}
function sourceOf(value: unknown): ImageSource {
  const data = value as ImageSource | undefined
  if (!data || !httpUrl(data.imageUrl) || !httpUrl(data.pageUrl) || typeof data.pageTitle !== 'string') throw new Error('Choose an image on an HTTP or HTTPS page.')
  return { imageUrl: data.imageUrl, pageUrl: data.pageUrl, pageTitle: data.pageTitle.slice(0, 1000) }
}
async function connection(): Promise<Connection | undefined> {
  await protectedStorage
  return (await chrome.storage.local.get('connection')).connection as Connection | undefined
}
async function changed() { await chrome.storage.local.set({ revision: crypto.randomUUID() }) }
async function state(): Promise<PanelState> {
  const c = await connection(), draft = await getDraft()
  const settings = await chrome.storage.local.get('lastBoard') as { lastBoard?: { userId: string; id: string } }
  const valid = c && c.expiresAt > Date.now()
  return { connected: !!valid, username: c?.user.username, capture: draft?.capture, lastBoardId: settings.lastBoard?.userId === c?.user.id ? settings.lastBoard?.id : undefined }
}
async function api<T>(path: string, init: RequestInit = {}, json?: unknown): Promise<T> {
  const c = await connection()
  if (!c || c.expiresAt <= Date.now()) throw new Error('Connect DoggyNote to save this image.')
  const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${c.token}`)
  if (json !== undefined) headers.set('content-type', 'application/json')
  let response: Response
  try { response = await fetch(`${__API_BASE__}/api/clipper/${path}`, { ...init, headers, body: json === undefined ? init.body : JSON.stringify(json), credentials: 'omit', signal: AbortSignal.timeout(25000) }) }
  catch { throw new Error('Cannot reach DoggyNote. Check your connection and retry saving.') }
  if (response.status === 401) { await chrome.storage.local.remove('connection'); await changed() }
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'DoggyNote could not save this image. Please retry.')
  return result
}
async function select(source: ImageSource) {
  await exclusive(async () => {
    const c = await connection()
    await putDraft({ capture: { id: crypto.randomUUID(), assetId: crypto.randomUUID(), source, status: 'selected', accountId: c?.user.id } })
    await changed()
  })
}
async function imageBytes(url: string) {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error('The source site would not provide this image. Try opening the image itself and saving again.')
  const type = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase().trim()
  if (!IMAGE_TYPES.has(type)) throw new Error('Choose a JPEG, PNG, WebP, or GIF image.')
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('This image exceeds the 15 MB image limit.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('The image could not be downloaded.')
  const parts: Uint8Array<ArrayBuffer>[] = []; let bytes = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > MAX_IMAGE_BYTES) throw new Error('This image exceeds the 15 MB image limit.')
      parts.push(new Uint8Array(result.value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  return new Blob(parts, { type })
}
async function prepare() {
  // A panel reopened during processing joins the existing work instead of showing a false failure.
  if (operation) await operation.catch(() => {})
  return exclusive(async () => {
    const draft = await getDraft()
    if (!draft) throw new Error('Hover an image and choose Save to get started.')
    if (draft.renditions) return state()
    try {
      const processed = await processImage(await imageBytes(draft.capture.source.imageUrl))
      draft.renditions = processed.renditions
      Object.assign(draft.capture, { width: processed.width, height: processed.height, status: 'ready', error: undefined })
      await updateDraftIfCurrent(draft)
    } catch (e) {
      draft.capture.status = 'error'; draft.capture.error = e instanceof Error ? e.message : 'Could not prepare this image.'
      await updateDraftIfCurrent(draft)
      throw e
    } finally { await changed() }
    return state()
  })
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function connect() {
  const verifier = base64(crypto.getRandomValues(new Uint8Array(32))), nonce = base64(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  if (chrome.identity.getRedirectURL('clipper') !== CLIPPER_REDIRECT) throw new Error('This build has a different extension ID. Install the packaged manifest with its development key.')
  const url = new URL(`${__API_BASE__}/clipper/connect`)
  url.search = new URLSearchParams({ challenge, state: nonce, redirect_uri: CLIPPER_REDIRECT }).toString()
  const callback = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true })
  if (!callback) throw new Error('Connection cancelled.')
  const result = new URL(callback)
  if (`${result.origin}${result.pathname}` !== CLIPPER_REDIRECT || result.searchParams.get('state') !== nonce) throw new Error('Connection could not be verified. Please connect again.')
  if (result.searchParams.has('error')) throw new Error('Connection cancelled.')
  const response = await fetch(`${__API_BASE__}/api/clipper/exchange`, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: result.searchParams.get('code'), verifier, redirectUri: CLIPPER_REDIRECT }), signal: AbortSignal.timeout(25000) })
  const data = await response.json() as Connection & { error?: string }
  if (!response.ok) throw new Error(data.error || 'Could not connect. Please try again.')
  const old = await getDraft()
  if (old?.capture.accountId && old.capture.accountId !== data.user.id) await clearDraft()
  else if (old) { old.capture.accountId = data.user.id; await putDraft(old) }
  await protectedStorage
  await chrome.storage.local.set({ connection: data })
  await changed()
  return state()
}
async function save(boardId: unknown) {
  if (typeof boardId !== 'string' || !boardId || boardId.length > 200) throw new Error('Choose a board first.')
  return exclusive(async () => {
    const draft = await getDraft(), c = await connection()
    if (!draft?.renditions || !c) throw new Error('Connect DoggyNote and prepare the image first.')
    if (draft.capture.accountId && draft.capture.accountId !== c.user.id) throw new Error('This image belongs to a different account. Capture it again.')
    if (draft.capture.status === 'saved') return state()
    const previousId = draft.capture.id
    // A deliberate destination change starts a new request; retries keep their IDs and bytes.
    if (draft.capture.boardId && draft.capture.boardId !== boardId) draft.capture.id = crypto.randomUUID()
    Object.assign(draft.capture, { boardId, accountId: c.user.id, status: 'saving', error: undefined })
    if (!await updateDraftIfCurrent(draft, previousId)) throw new Error('This capture was cleared. Choose an image again.')
    await changed()
    try {
      await api('uploads', { method: 'POST' }, { assetId: draft.capture.assetId })
      for (const { size, blob } of draft.renditions) await api(`assets/${draft.capture.assetId}/${size}`, { method: 'PUT', headers: { 'content-type': blob.type }, body: blob })
      await api('clips', { method: 'POST' }, { id: draft.capture.id, boardId, image: { assetId: draft.capture.assetId, width: draft.capture.width, height: draft.capture.height, sizes: draft.renditions.map((r) => r.size) }, source: draft.capture.source })
      draft.capture.status = 'saved'
      await chrome.storage.local.set({ lastBoard: { userId: c.user.id, id: boardId } })
    } catch (e) { draft.capture.status = 'error'; draft.capture.error = e instanceof Error ? e.message : 'Could not save. Please retry.'; throw e }
    finally {
      await updateDraftIfCurrent(draft)
      await changed()
    }
    return state()
  })
}

chrome.runtime.onInstalled.addListener(() => {
  void protectedStorage
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'save-image', title: 'Save image to DoggyNote', contexts: ['image'], documentUrlPatterns: ['http://*/*', 'https://*/*'] }))
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'save-image' || !tab?.id || !info.srcUrl) return
  // Open before awaiting anything, preserving Chrome's user gesture.
  const opening = chrome.sidePanel.open({ tabId: tab.id })
  void opening.then(() => select(sourceOf({ imageUrl: info.srcUrl, pageUrl: info.pageUrl, pageTitle: tab.title ?? '' }))).catch(console.warn)
})
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const input = message as { type?: string; source?: unknown; boardId?: unknown }
  if (!input || typeof input.type !== 'string') return false
  if (input.type === 'capture' && sender.tab?.id && sender.frameId === 0 && httpUrl(sender.url)) {
    let source: ImageSource
    try {
      source = sourceOf(input.source)
      if (new URL(source.pageUrl).origin !== new URL(sender.url).origin) throw new Error('Capture source mismatch')
    } catch { respond({ ok: false, error: 'Invalid image source' }); return false }
    const opening = chrome.sidePanel.open({ tabId: sender.tab.id })
    void opening.then(() => select(source)).then(() => respond({ ok: true })).catch((e: Error) => respond({ ok: false, error: e.message }))
    return true
  }
  // Only our panel can access connection, download and upload operations.
  if (sender.url !== chrome.runtime.getURL('sidepanel.html')) return false
  const run = async () => {
    switch (input.type) {
      case 'state': return state()
      case 'prepare': return prepare()
      case 'connect': return exclusive(connect)
      case 'boards': return api('boards')
      case 'save': return save(input.boardId)
      case 'disconnect':
        await api('connection', { method: 'DELETE' })
        await chrome.storage.local.remove(['connection', 'lastBoard'])
        await clearDraft(); await changed(); return state()
      default: throw new Error('Unknown clipper action')
    }
  }
  void run().then((value) => respond({ ok: true, value })).catch((e: Error) => respond({ ok: false, error: e.message }))
  return true
})
