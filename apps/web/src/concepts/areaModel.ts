export type Concept = 'areas' | 'sections' | 'tabs'
export type Note = { id: string; title: string; body: string; color?: 'ball' | 'sky' | 'peach'; done?: boolean }
export type Column = { id: string; title: string; notes: Note[]; x: number; y: number }
export type AreaItem = Note & { kind: 'note' | 'todo' | 'link' | 'image'; x: number; y: number; url?: string; src?: string; checks?: { id: string; text: string; done: boolean }[] }
export type Arrow = { id: string; from: string; to: string }
export type Group = { id: string; title: string; description: string; color: 'ball' | 'sky'; columns: Column[]; items: AreaItem[]; collapsed: boolean; x: number; y: number }
export const examples: Group[] = [
  { id: 'weekend', title: 'Weekend away', description: 'A little fresh air, a slower couple of days.', color: 'ball', collapsed: false, x: 36, y: 40, items: [
    { id: 'context', kind: 'note', title: 'A note to ourselves', body: 'Make room for a little spontaneity. We don’t need to plan every hour.', color: 'peach', x: 16, y: 420 },
    { id: 'trip-checklist', kind: 'todo', title: 'Before we set off', body: '', x: 304, y: 420, checks: [{ id: 'check-1', text: 'Ask someone to water the plants', done: false }, { id: 'check-2', text: 'Pack the walking shoes', done: true }] },
    { id: 'trip-reference', kind: 'link', title: 'A place to start exploring', body: 'Save useful references right beside the plan.', url: 'https://www.nps.gov/pore/', x: 592, y: 420 },
  ], columns: [
    { id: 'trip-ideas', title: 'Ideas', x: 0, y: 12, notes: [
      { id: 'coast', title: 'Somewhere by the coast', body: 'Point Reyes or the Mendocino coast. Somewhere we can walk to coffee.', color: 'ball' },
      { id: 'walk', title: 'One really good walk', body: 'Coastal trail, picnic halfway. Leave the afternoon open.' },
    ] },
    { id: 'trip-plan', title: 'Planning', x: 0, y: 40, notes: [
      { id: 'stay', title: 'Find a place to stay', body: 'Two nights · dog friendly\nA kitchen would be lovely.' },
      { id: 'route', title: 'Take the scenic route', body: 'Leave Friday after lunch. Stop at the farm stand on the way.', color: 'sky' },
    ] },
    { id: 'trip-ready', title: 'Ready', x: 0, y: 0, notes: [
      { id: 'dates', title: 'Dates are in the calendar', body: 'November 13–15\nEveryone has the Friday afternoon free.', done: true },
    ] },
  ] },
  { id: 'home', title: 'Home projects', description: 'Small things that make the everyday nicer.', color: 'sky', collapsed: false, x: 1040, y: 120, items: [
    { id: 'home-context', kind: 'note', title: 'One thing at a time', body: 'Let’s finish a small project before starting another.', color: 'ball', x: 16, y: 300 },
  ], columns: [
    { id: 'home-ideas', title: 'Ideas', x: 0, y: 0, notes: [
      { id: 'reading', title: 'A proper reading corner', body: 'The chair by the window, a warm lamp, and somewhere for a cup of tea.', color: 'peach' },
    ] },
    { id: 'home-plan', title: 'Planning', x: 0, y: 28, notes: [
      { id: 'garden', title: 'Herbs for the kitchen', body: 'Measure the windowsill. Start with rosemary, mint, and basil.' },
    ] },
    { id: 'home-ready', title: 'Ready', x: 0, y: 10, notes: [
      { id: 'shelf', title: 'Clear the little shelf', body: 'Books donated. The plants finally have some room.', done: true },
    ] },
  ] },
]

export const COLUMN_STEP = 288
export const areaWidth = (g: Group) => Math.max(Math.max(1, g.columns.length) * COLUMN_STEP - 32, ...g.columns.map((column, i) => 16 + i * COLUMN_STEP + column.x + 224), ...g.items.map(item => item.x + 280)) + 32
export const sampleArrows: Arrow[] = [
  { id: 'trip-flow-1', from: 'column:trip-ideas', to: 'column:trip-plan' },
  { id: 'trip-flow-2', from: 'column:trip-plan', to: 'column:trip-ready' },
  { id: 'home-flow-1', from: 'column:home-ideas', to: 'column:home-plan' },
  { id: 'home-flow-2', from: 'column:home-plan', to: 'column:home-ready' },
]
