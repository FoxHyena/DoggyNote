import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

/** Real stdio client for the e2e suite: uploads a folder of reference images through `upload_images`. */
const boardId = process.env.DOGGYNOTE_SMOKE_BOARD
if (!boardId) throw new Error('DOGGYNOTE_SMOKE_BOARD is required')
const dir = await mkdtemp(join(tmpdir(), 'dn-refs-'))
const colors = [{ r: 220, g: 80, b: 60 }, { r: 60, g: 160, b: 90 }, { r: 50, g: 90, b: 200 }]
for (const [i, background] of colors.entries()) {
  const image = sharp({ create: { width: 600 + i * 100, height: 400, channels: 3, background } })
  await writeFile(join(dir, `ref-${i + 1}.${i === 1 ? 'jpg' : 'png'}`), await (i === 1 ? image.jpeg() : image.png()).toBuffer())
}
await writeFile(join(dir, 'notes.txt'), 'not an image')
const env = Object.fromEntries(Object.entries(process.env).filter((p): p is [string, string] => p[1] !== undefined))
const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', fileURLToPath(new URL('./index.ts', import.meta.url))], env, stderr: 'pipe' })
const client = new Client({ name: 'doggynote-upload-client', version: '1.0.0' })
try {
  await client.connect(transport)
  const args = { boardId, paths: [dir], columns: 2, captions: 'filename', idempotencyKey: `refs-${randomUUID()}` }
  const staged = await client.callTool({ name: 'upload_images', arguments: args })
  if (staged.isError) throw new Error(JSON.stringify(staged.content))
  const data = staged.structuredContent as { id?: string; status?: string; label?: string; uploaded?: unknown[]; skipped?: unknown[] }
  if (!data.id || data.status !== 'pending' || data.uploaded?.length !== 3) throw new Error(`Upload was not staged: ${JSON.stringify(data)}`)
  // A retry reuses the stored images and returns the same proposal.
  const retry = await client.callTool({ name: 'upload_images', arguments: args })
  if ((retry.structuredContent as { id?: string })?.id !== data.id) throw new Error('Retry created a duplicate proposal')
  process.stdout.write(JSON.stringify({ proposalId: data.id, label: data.label, uploaded: data.uploaded, skipped: data.skipped }))
} finally { await client.close(); await rm(dir, { recursive: true }) }
