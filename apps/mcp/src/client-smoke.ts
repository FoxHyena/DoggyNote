import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

/** Real stdio client used by the real-Worker E2E suite and local setup checks. */
const boardId = process.env.DOGGYNOTE_SMOKE_BOARD
if (!boardId) throw new Error('DOGGYNOTE_SMOKE_BOARD is required')
const env = Object.fromEntries(Object.entries(process.env).filter((p): p is [string, string] => p[1] !== undefined))
const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', fileURLToPath(new URL('./index.ts', import.meta.url))], env, stderr: 'pipe' })
const client = new Client({ name: 'doggynote-acceptance-client', version: '1.0.0' })
try {
  await client.connect(transport)
  const tools = await client.listTools()
  if (!['list_boards', 'read_board', 'propose_changes', 'proposal_status', 'propose_board'].every((name) => tools.tools.some((t) => t.name === name))) throw new Error('Missing required MCP tools')
  const read = await client.callTool({ name: 'read_board', arguments: { boardId } })
  if (read.isError) throw new Error('MCP board read failed')
  const suffix = randomUUID(), now = Date.now(), label = `Agent board plan ${suffix.slice(0, 6)}`
  const base = { kind: 'card', boardId, color: 'none', createdAt: now, z: 1, w: 260, h: 80, x: 40, y: 40 }
  const note = { ...base, id: `agent-note-${suffix}`, type: 'note', color: 'gold', content: { md: 'A note built through the MCP client' } }
  const column = { ...base, id: `agent-column-${suffix}`, type: 'column', x: 360, w: 280, h: 260, content: { title: 'Agent organization' } }
  const todo = { ...base, id: `agent-todo-${suffix}`, type: 'todo', columnId: column.id, order: 1, content: { title: 'Review checklist', items: [{ id: randomUUID(), text: 'Approve the proposal', done: false }] } }
  const link = { ...base, id: `agent-link-${suffix}`, type: 'link', x: 40, y: 180, content: { url: 'https://example.com', title: 'Reference', status: 'ok' } }
  const proposal = { idempotencyKey: `smoke-${suffix}`, label, operations: [note, column, todo, link].map((object) => ({ action: 'create', object })) }
  const staged = await client.callTool({ name: 'propose_changes', arguments: proposal })
  if (staged.isError) throw new Error(JSON.stringify(staged.content))
  const data = staged.structuredContent as { id?: string; status?: string }
  if (!data.id || data.status !== 'pending') throw new Error('Proposal was not staged')
  const retry = await client.callTool({ name: 'propose_changes', arguments: proposal })
  if ((retry.structuredContent as { id?: string })?.id !== data.id) throw new Error('Retry created a duplicate proposal')
  const status = await client.callTool({ name: 'proposal_status', arguments: { proposalId: data.id } })
  if (status.isError) throw new Error('Proposal status failed')
  process.stdout.write(JSON.stringify({ proposalId: data.id, label, noteId: note.id, columnId: column.id, todoId: todo.id, linkId: link.id, tools: tools.tools.map((t) => t.name) }))
} finally { await client.close() }
