// Seeds the board for the everyday-polish QA round: a to-do list with done items,
// a note with nested lists and inline formatting, a coloured column, connected
// cards, a comment, and a pending agent proposal that adds, moves and buries cards.
// Usage: import { seed } from './fixture.mjs'; await seed(request)

const uid = () => crypto.randomUUID()
const DAY = 86_400_000

async function sync(request, changes) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request.post('/api/sync', { data: { changes } })
    if (res.ok()) return res
    if (res.status() !== 409) throw new Error(`sync ${res.status()} ${await res.text()}`)
  }
  throw new Error('sync kept conflicting')
}

const card = (boardId, type, x, y, w, content, extra = {}) => ({ id: uid(), kind: 'card', type, boardId, x, y, w, h: 80, z: 1, color: 'none', content, createdAt: Date.now(), ...extra })

export async function seed(request, { title = 'Movie night and chores' } = {}) {
  const board = uid()
  const now = Date.now()
  const objects = [{ id: board, kind: 'board', parentId: 'home', title, icon: 'star', color: 'lilac', createdAt: now }]
  const plan = card(board, 'note', 0, 0, 300, { md: '# Saturday plan\nPick up **popcorn** and the _good_ blanket.\n\n- Snacks\n  - Popcorn\n  - Gummy bears\n- Drinks\n1. Clean the couch\n2. Set up the projector\n   1. Find the HDMI cable\n- [ ] Text Fido the time\n- [x] Charge the speaker' }, { color: 'gold' })
  const chores = card(board, 'todo', 340, 0, 260, { title: 'Chores', items: [
    { id: uid(), text: 'Vacuum the rug', done: false },
    { id: uid(), text: 'Water the plants', done: true, doneAt: now - 2 * 60_000 },
    { id: uid(), text: 'Take out recycling', done: false },
    { id: uid(), text: 'Wash the dog bowl', done: true, doneAt: now - DAY },
    { id: uid(), text: 'Buy kibble', done: true, doneAt: now - 9 * DAY },
  ] })
  const column = card(board, 'column', 640, 0, 280, { title: 'Watchlist' }, { color: 'sky' })
  const kids = [
    card(board, 'note', 0, 0, 264, { md: 'The Iron Giant' }, { columnId: column.id, order: 1 }),
    card(board, 'note', 0, 0, 264, { md: 'Paddington 2' }, { columnId: column.id, order: 2 }),
    // Movie cards resolve against TMDB (the fixture server's stand-in) when they first mount.
    card(board, 'movie', 0, 0, 264, { kind: 'movie', tmdbId: 999, title: '', status: 'pending' }, { columnId: column.id, order: 3 }),
    card(board, 'movie', 960, 0, 300, { kind: 'movie', tmdbId: 157336, title: '', status: 'pending', watched: true, watchedAt: now - DAY }),
    card(board, 'movie', 1290, 0, 300, { kind: 'tv', tmdbId: 95396, title: '', status: 'pending', details: true }),
  ]
  const a = card(board, 'note', 0, 380, 220, { md: 'Order pizza at 6' }, { color: 'peach' })
  const b = card(board, 'note', 300, 380, 220, { md: 'Movie starts at 7' })
  const conn = { id: uid(), kind: 'connection', boardId: board, from: a.id, to: b.id, arrow: 'end', createdAt: now }
  objects.push(plan, chores, column, ...kids, a, b, conn)
  await sync(request, objects.map((o) => ({ id: o.id, patch: o })))
  const comment = uid()
  await sync(request, [{ id: comment, patch: { id: comment, kind: 'comment', boardId: board, cardId: b.id, text: 'Can we start at 7:30?', createdAt: Date.now() } }])

  // A pending agent proposal: one new note, one new to-do, one moved card, one buried card.
  let proposal = null
  const conn2 = await request.post('/api/agent-connections', { data: { name: 'QA helper', mode: 'propose', boardIds: [board], expiresInDays: 1 } })
  if (conn2.ok()) {
    const { token } = await conn2.json()
    const headers = { authorization: `Bearer ${token}` }
    const read = await (await request.get(`/api/agent/boards/${board}`, { headers })).json()
    const rev = (id) => read.objects.find((o) => o.object.id === id)
    const moved = rev(b.id)
    const buried = rev(a.id)
    const res = await request.post('/api/agent/proposals', { headers, data: {
      idempotencyKey: `qa-${uid().slice(0, 12)}`,
      label: 'Tidy movie night',
      operations: [
        { action: 'create', object: { id: uid(), kind: 'card', type: 'note', boardId: board, x: 0, y: 520, w: 260, h: 60, z: 5, color: 'lilac', createdAt: now, content: { md: '## Snack budget\nAbout **$20**, split three ways.' } } },
        { action: 'create', object: { id: uid(), kind: 'card', type: 'todo', boardId: board, x: 300, y: 520, w: 260, h: 110, z: 6, color: 'none', createdAt: now, content: { title: 'Before guests arrive', items: [{ id: uid(), text: 'Fluff the pillows', done: false }, { id: uid(), text: 'Hide the shoes', done: false }] } } },
        { action: 'replace', expectedRevision: moved.revision, object: { ...moved.object, x: 620, y: 380 } },
        { action: 'trash', id: a.id, expectedRevision: buried.revision },
      ],
    } })
    if (res.ok()) proposal = (await res.json()).id
    else console.warn('proposal', res.status(), await res.text())
  }
  return { board, ids: { plan: plan.id, chores: chores.id, column: column.id }, proposal }
}
