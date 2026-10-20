// Seeds a realistic board for mobile QA: notes, a to-do list, a column, a link,
// an inner board, a connection, a comment thread, Inbox items and a share link.
// Usage: import { seed } from './fixture.mjs'; await seed(request)

const uid = () => crypto.randomUUID()

async function sync(request, changes) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request.post('/api/sync', { data: { changes } })
    if (res.ok()) return res
    if (res.status() !== 409) throw new Error(`sync ${res.status()} ${await res.text()}`)
  }
  throw new Error('sync kept conflicting')
}

const card = (boardId, type, x, y, w, content, extra = {}) => ({ id: uid(), kind: 'card', type, boardId, x, y, w, h: 80, z: 1, color: 'none', content, createdAt: Date.now(), ...extra })

export async function seed(request, { title = 'Weekend in the hills' } = {}) {
  const me = (await (await request.get('/api/me')).json()).user
  const board = uid()
  const inner = uid()
  const now = Date.now()
  const objects = [
    { id: board, kind: 'board', parentId: 'home', title, icon: 'paw', color: 'gold', createdAt: now },
    { id: inner, kind: 'board', parentId: board, title: 'Trail snacks', icon: 'bone', color: 'ball', createdAt: now },
  ]
  const intro = card(board, 'note', 0, 0, 280, { md: '# Hike plan\nLeave **8am** Saturday. Meet at the trailhead café.\n\n- [x] Book the cabin\n- [ ] Check the weather' }, { color: 'gold' })
  const todo = card(board, 'todo', 320, 0, 260, { title: 'Packing list', items: [
    { id: uid(), text: 'Boots', done: true },
    { id: uid(), text: 'Rain jacket', done: false },
    { id: uid(), text: 'Water bottles', done: false },
    { id: uid(), text: 'Dog treats', done: false },
  ] })
  const link = card(board, 'link', 0, 260, 280, { url: 'https://example.com/trail', title: 'Ridge loop trail guide', description: '9 km loop with a lake halfway. Dogs welcome on leads.', siteName: 'example.com', status: 'ok' })
  const boardCard = card(board, 'board', 620, 0, 140, { boardId: inner })
  const column = card(board, 'column', 620, 200, 280, { title: 'Ideas for Sunday' })
  const kids = [
    card(board, 'note', 0, 0, 264, { md: 'Swim at the lake if it is warm' }, { columnId: column.id, order: 1 }),
    card(board, 'note', 0, 0, 264, { md: 'Farmers market in town' }, { columnId: column.id, order: 2, color: 'sky' }),
  ]
  const late = card(board, 'note', 0, 440, 260, { md: 'Who is driving? 🚗' }, { color: 'peach' })
  const conn = { id: uid(), kind: 'connection', boardId: board, from: intro.id, to: todo.id, createdAt: now }
  const innerNote = card(inner, 'note', 0, 0, 260, { md: 'Trail mix, apples, peanut butter sandwiches' })
  objects.push(intro, todo, link, boardCard, column, ...kids, late, conn, innerNote)
  await sync(request, objects.map((o) => ({ id: o.id, patch: o })))
  const comment = uid()
  await sync(request, [{ id: comment, patch: { id: comment, kind: 'comment', boardId: board, cardId: late.id, text: 'I can drive! Room for two more and a dog.', createdAt: Date.now() } }])

  // Inbox items (the private toybox board is created by the app on first load).
  const toy = `toybox:${me.id}`
  await sync(request, [{ id: toy, patch: { id: toy, kind: 'board', parentId: null, title: 'Unsorted', icon: 'ball', color: 'gold', createdAt: now } }]).catch(() => {})
  await sync(request, [
    card(toy, 'note', 0, 0, 260, { md: 'Idea: bring the hammock' }),
    card(toy, 'link', 0, 0, 260, { url: 'https://example.com/recipe', title: 'Campfire chili', siteName: 'example.com', status: 'ok' }),
  ].map((o) => ({ id: o.id, patch: o })))

  const share = (await (await request.post('/api/shares', { data: { boardId: board } })).json()).share
  return { board, inner, ids: { intro: intro.id, todo: todo.id, late: late.id, column: column.id, boardCard: boardCard.id }, share: share?.token }
}
