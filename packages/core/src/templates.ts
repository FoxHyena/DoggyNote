import type { Board, Card, CardContent, CardType, Obj } from './model.ts'
import { DEFAULT_SIZE } from './model.ts'

export const BUILTIN_TEMPLATES = [
  { id: 'research', name: 'Research', description: 'Collect sources, observations and open questions.' },
  { id: 'moodboard', name: 'Moodboard', description: 'Explore a direction with references and a clear visual brief.' },
  { id: 'project-brief', name: 'Project brief', description: 'Give a project a purpose, scope and next steps.' },
] as const
export type BuiltinTemplate = typeof BUILTIN_TEMPLATES[number]['id']

/** Document data only. Every use passes through the independent graph copier. */
export function builtinTemplate(id: BuiltinTemplate): { rootId: string; objects: Obj[] } {
  const rootId = 'template-root'
  const info = BUILTIN_TEMPLATES.find((t) => t.id === id)
  if (!info) throw new Error('This template is unavailable.')
  const objects: Obj[] = [{ id: rootId, kind: 'board', parentId: null, title: info.name, icon: 'paw', color: 'gold', createdAt: 0 } satisfies Board]
  let n = 0
  function card<T extends CardType>(type: T, x: number, y: number, content: CardContent[T], columnId?: string): string {
    const cardId = `template-card-${++n}`
    objects.push({ id: cardId, kind: 'card', type, boardId: rootId, x, y, ...DEFAULT_SIZE[type], z: n, color: 'none', columnId: columnId ?? null, order: n, content, createdAt: 0 } as Card)
    return cardId
  }
  if (id === 'research') {
    card('note', 0, 0, { md: '# Research question\nWhat are we trying to understand?\n\nAdd a focused question and the decisions it will inform.' })
    const sources = card('column', 320, 0, { title: 'Sources & references' })
    card('note', 0, 0, { md: '## Start collecting\nDrop images, links or files here. Add a short observation beside each reference.' }, sources)
    const findings = card('column', 640, 0, { title: 'Findings & questions' })
    card('note', 0, 0, { md: '## What we noticed\n- Patterns\n- Surprises\n- Questions to investigate' }, findings)
    const child: Board = { id: 'template-deeper', kind: 'board', parentId: rootId, title: 'Deeper research', icon: 'star', color: 'sky', createdAt: 0 }
    objects.push(child)
    card('board', 0, 240, { boardId: child.id })
  } else if (id === 'moodboard') {
    const brief = card('note', 0, 0, { md: '# Visual direction\nDescribe the feeling, audience and story.\n\nWhat should people notice first?' })
    const references = card('column', 320, 0, { title: 'Visual references' })
    const note = card('note', 0, 0, { md: '## A useful reference\nAdd images here, then describe what works: light, shape, texture or composition.' }, references)
    card('note', 640, 0, { md: '## Keep / explore / avoid\n- Keep the strongest ideas\n- Explore a new direction\n- Name what does not fit' })
    objects.push({ id: 'template-line', kind: 'connection', boardId: rootId, from: brief, to: note, arrow: 'end', createdAt: 0 })
  } else {
    card('note', 0, 0, { md: '# Project brief\n## Purpose\nWhat problem are we solving, and for whom?\n\n## Success\nHow will we know it worked?' })
    card('note', 320, 0, { md: '## Scope\n### Included\n- The essential outcome\n\n### Constraints\n- Time\n- Budget\n- Dependencies' })
    card('todo', 640, 0, { title: 'Next steps', items: [{ id: 'template-task-1', text: 'Agree on the brief', done: false }, { id: 'template-task-2', text: 'Collect references', done: false }, { id: 'template-task-3', text: 'Review the first direction', done: false }] })
  }
  return { rootId, objects }
}
