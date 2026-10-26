import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Icon, type IconName } from '../ui/icons.tsx'

import { COLUMN_STEP, areaWidth, examples, sampleArrows, type Arrow, type AreaItem, type Concept, type Column, type Group } from './areaModel.ts'
import { autoSides, connectorPath, type Rect } from '@doggynote/core'
const details: Record<Concept, { title: string; icon: IconName; subtitle: string; description: string; benefit: string; tradeoff: string; actions: string[] }> = {
  areas: { title: 'Canvas areas', icon: 'multi', subtitle: 'A place for every project.', description: 'Put a named area around related columns. Keep your spatial layout, with room for notes alongside the workflow.', benefit: 'Best for thinking visually and keeping context close to the work.', tradeoff: 'A large board still needs panning. Free placement takes a little upkeep.', actions: ['Use Add to area for notes and references', 'Move items with their dotted handles', 'Connect items using Project arrows'] },
  sections: { title: 'Board sections', icon: 'column', subtitle: 'Different projects. A shared rhythm.', description: 'Give each project a horizontal section. Its columns line up automatically, while each section keeps its own workflow.', benefit: 'Best for seeing several projects and comparing their stages at a glance.', tradeoff: 'Less freedom to position things. Long sections scroll horizontally.', actions: ['Collapse a section with its chevron', 'Move a column using its group menu', 'Add a note to any stage'] },
  tabs: { title: 'Focus tabs', icon: 'layers', subtitle: 'One project in front of you.', description: 'Keep your groups in a slim tab bar. Switch the visible workflow without leaving the board or opening a nested board.', benefit: 'Best for a busy board when you want fewer things competing for attention.', tradeoff: 'Other projects are hidden until you switch tabs. Side-by-side comparison is harder.', actions: ['Switch between project tabs', 'Rename a group in its heading', 'Move a column to another project'] },
}
const STORAGE = 'doggynote.grouping-concepts.v1'
const clone = () => structuredClone(examples)

export function GroupingPlayground() {
  const [theme, setTheme] = createSignal<'dark' | 'light'>('dark')
  const [concept, setConcept] = createSignal<Concept>('areas')
  const [groups, setGroups] = createSignal<Group[]>(clone())
  const [arrows, setArrows] = createSignal<Arrow[]>(structuredClone(sampleArrows))
  const [showArrows, setShowArrows] = createSignal(true)
  const [from, setFrom] = createSignal('area:weekend')
  const [to, setTo] = createSignal('area:home')
  const [active, setActive] = createSignal('weekend')
  const [selectedNote, setSelectedNote] = createSignal<string>()
  const [message, setMessage] = createSignal('Arrows show the workflow. Add notes and references to any area.')
  const [storageError, setStorageError] = createSignal(false)
  const [rects, setRects] = createSignal<Record<string, Rect>>({})
  const nodes = new Map<string, HTMLElement>()
  let stage!: HTMLDivElement
  let world!: HTMLDivElement
  let observer: ResizeObserver | undefined
  let frame = 0
  let dragCleanup: (() => void) | undefined

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null')
    if (Array.isArray(saved) && saved.length && saved.every((g: Group) => typeof g.id === 'string' && typeof g.title === 'string' && Array.isArray(g.columns) && g.columns.every(c => Array.isArray(c.notes)))) {
      setGroups(saved.map((g: Group) => ({ ...g, items: Array.isArray(g.items) ? g.items : structuredClone(examples.find(e => e.id === g.id)?.items ?? []), x: !g.items && g.x === 820 ? 1040 : g.x })))
    }
    const context = localStorage.getItem(`${STORAGE}.context`)
    if (context !== null && !saved?.[0]?.items) setGroups(all => all.map(g => ({ ...g, items: g.items.map(item => item.id === 'context' ? { ...item, body: context } : item) })))
    const storedArrows = JSON.parse(localStorage.getItem(`${STORAGE}.arrows`) || 'null')
    if (Array.isArray(storedArrows) && storedArrows.every(a => typeof a.id === 'string' && typeof a.from === 'string' && typeof a.to === 'string')) setArrows(storedArrows)
  } catch { /* A broken or unavailable demo store starts with the examples. */ }

  function store(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); setStorageError(false) }
    catch { setStorageError(true); setMessage('This sample could not be saved locally. Try a smaller image or reset the sample.') }
  }
  function save(next: Group[]) { setGroups(next); store(STORAGE, next) }
  function saveArrows(next: Arrow[]) { setArrows(next); store(`${STORAGE}.arrows`, next) }
  function updateGroup(id: string, change: (g: Group) => Group) { save(groups().map(g => g.id === id ? change(g) : g)) }
  function updateColumn(groupId: string, columnId: string, change: (c: Column) => Column) {
    updateGroup(groupId, g => ({ ...g, columns: g.columns.map(c => c.id === columnId ? change(c) : c) }))
  }
  function updateNote(groupId: string, columnId: string, noteId: string, field: 'title' | 'body', value: string) {
    updateColumn(groupId, columnId, c => ({ ...c, notes: c.notes.map(n => n.id === noteId ? { ...n, [field]: value } : n) }))
  }
  function updateItem(groupId: string, itemId: string, change: (item: AreaItem) => AreaItem) {
    updateGroup(groupId, g => ({ ...g, items: g.items.map(item => item.id === itemId ? change(item) : item) }))
  }
  const toggleTheme = () => {
    const next = theme() === 'dark' ? 'light' : 'dark'
    setTheme(next); document.documentElement.dataset.theme = next
  }
  function switchConcept(next: Concept) {
    setConcept(next); setSelectedNote(undefined)
    stage.scrollTo({ left: 0, top: 0 }); setMessage(details[next].actions[0])
  }
  function makeRoom(next: Group[], groupId: string) {
    const grown = next.find(g => g.id === groupId)!
    const right = grown.x + areaWidth(grown) + 48
    return next.map(g => g.id !== groupId && g.x > grown.x && g.x < right ? { ...g, x: right } : g)
  }
  function moveColumn(source: string, columnId: string, target: string) {
    if (source === target) return
    const col = groups().find(g => g.id === source)?.columns.find(c => c.id === columnId)
    if (!col) return
    save(makeRoom(groups().map(g => g.id === source ? { ...g, columns: g.columns.filter(c => c.id !== columnId) } : g.id === target ? { ...g, columns: [...g.columns, { ...col, x: 0, y: 0 }] } : g), target))
    setMessage(`Moved “${col.title}” to ${groups().find(g => g.id === target)?.title}. Its arrows stay attached.`)
  }
  function addColumn(id: string) {
    save(makeRoom(groups().map(g => g.id === id ? { ...g, collapsed: false, columns: [...g.columns, { id: crypto.randomUUID(), title: 'New stage', notes: [], x: 0, y: 0 }] } : g), id))
    setMessage('Stage added. Click its name to rename it.')
  }
  function addNote(groupId: string, columnId: string) {
    const id = crypto.randomUUID()
    updateColumn(groupId, columnId, c => ({ ...c, notes: [...c.notes, { id, title: 'New note', body: '' }] }))
    setSelectedNote(id); setMessage('Note added. Click its title or text to edit.')
  }
  function addItem(groupId: string, kind: AreaItem['kind'], src?: string) {
    const id = crypto.randomUUID()
    const g = groups().find(g => g.id === groupId)!
    const y = Math.max(420, ...g.columns.map(c => c.y + (rects()[`column:${c.id}`]?.h ?? 330) + 32), ...g.items.map(item => item.y + (rects()[`item:${item.id}`]?.h ?? 180) + 24))
    const title = { note: 'New area note', todo: 'New checklist', link: 'New reference', image: 'Image reference' }[kind]
    const item: AreaItem = { id, kind, title, body: '', x: 16, y, ...(kind === 'note' ? { color: 'peach' as const } : {}), ...(kind === 'todo' ? { checks: [{ id: crypto.randomUUID(), text: 'First task', done: false }] } : {}), ...(kind === 'link' ? { url: '' } : {}), ...(src ? { src } : {}) }
    updateGroup(groupId, group => ({ ...group, collapsed: false, items: [...group.items, item] }))
    setSelectedNote(id); setMessage(`${title} added inside ${g.title}. Move it with its dotted handle.`)
    requestAnimationFrame(() => nodes.get(`item:${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }
  function loadImage(groupId: string, file?: File) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setMessage('Choose a PNG, JPEG, WebP, or GIF image.'); return }
    if (file.size > 1_000_000) { setMessage('Choose an image smaller than 1 MB for this local sample.'); return }
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') addItem(groupId, 'image', reader.result) }
    reader.onerror = () => setMessage('That image could not be read. Try another image.')
    reader.readAsDataURL(file)
  }
  function moveItem(source: string, itemId: string, target: string) {
    if (source === target) return
    const item = groups().find(g => g.id === source)?.items.find(i => i.id === itemId)
    const targetGroup = groups().find(g => g.id === target)
    if (!item || !targetGroup) return
    const y = Math.max(420, ...targetGroup.items.map(i => i.y + (rects()[`item:${i.id}`]?.h ?? 180) + 24))
    save(groups().map(g => g.id === source ? { ...g, items: g.items.filter(i => i.id !== itemId) } : g.id === target ? { ...g, items: [...g.items, { ...item, x: 16, y }], collapsed: false } : g))
    setMessage(`Moved “${item.title}” into ${targetGroup.title}.`)
  }
  function removeItem(groupId: string, itemId: string) {
    updateGroup(groupId, g => ({ ...g, items: g.items.filter(i => i.id !== itemId) }))
    saveArrows(arrows().filter(a => a.from !== `item:${itemId}` && a.to !== `item:${itemId}`))
    setMessage('Sample item removed with its arrows.')
  }
  function drag(e: PointerEvent, groupId: string, columnId?: string, itemId?: string) {
    if (concept() !== 'areas' || e.button !== 0 || (e.target as Element).closest('input, textarea, select, button:not(.gp-drag-handle)')) return
    dragCleanup?.()
    const g = groups().find(g => g.id === groupId)!
    const object = g.columns.find(c => c.id === columnId) ?? g.items.find(i => i.id === itemId)
    const x = object?.x ?? g.x, y = object?.y ?? g.y, startX = e.clientX, startY = e.clientY
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId); handle.classList.add('is-dragging')
    const move = (event: PointerEvent) => {
      const nextX = Math.max(columnId ? -g.columns.findIndex(c => c.id === columnId) * COLUMN_STEP : itemId ? 16 : 12, x + event.clientX - startX)
      const nextY = Math.max(object ? 0 : 12, y + event.clientY - startY)
      setGroups(all => all.map(group => group.id !== groupId ? group : columnId
        ? { ...group, columns: group.columns.map(c => c.id === columnId ? { ...c, x: nextX, y: nextY } : c) }
        : itemId ? { ...group, items: group.items.map(i => i.id === itemId ? { ...i, x: nextX, y: nextY } : i) }
        : { ...group, x: nextX, y: nextY }))
    }
    const end = () => { cleanup(); save(groups()); setMessage(object ? 'Item repositioned. Its arrows stay attached.' : 'The whole area moved together, including its notes and arrows.') }
    const cleanup = () => {
      handle.classList.remove('is-dragging')
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end)
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      dragCleanup = undefined
    }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
    dragCleanup = cleanup; e.preventDefault()
  }
  function tidy(id: string) {
    const g = groups().find(g => g.id === id)!
    const y = Math.max(360, ...g.columns.map(c => (rects()[`column:${c.id}`]?.h ?? 330) + 32))
    const rows: number[] = []
    updateGroup(id, group => ({ ...group, columns: group.columns.map(c => ({ ...c, x: 0, y: 0 })), items: group.items.map((item, i) => {
      const row = Math.floor(i / 3)
      rows[row] = Math.max(rows[row] ?? 0, rects()[`item:${item.id}`]?.h ?? 180)
      return { ...item, x: 16 + (i % 3) * 288, y: y + rows.slice(0, row).reduce((sum, height) => sum + height + 24, 0) }
    }) }))
    setMessage('Workflow columns aligned. Notes and references are arranged below.')
  }
  function reset() {
    dragCleanup?.(); save(clone()); saveArrows(structuredClone(sampleArrows)); setActive('weekend'); setSelectedNote(undefined)
    try { localStorage.removeItem(`${STORAGE}.context`) } catch { /* Storage is optional. */ }
    stage.scrollTo({ left: 0, top: 0 }); setMessage('Sample board reset.')
  }
  function jump(id: string) {
    setActive(id)
    if (concept() !== 'tabs') {
      const el = nodes.get(`area:${id}`)
      if (el) stage.scrollTo({ left: Math.max(0, el.offsetLeft - 32), top: Math.max(0, el.offsetTop - 32), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }
  function fit(el: HTMLTextAreaElement) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  function autosize(el: HTMLTextAreaElement) {
    onMount(() => {
      fit(el); let width = el.clientWidth
      const resize = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(el) } })
      resize.observe(el); onCleanup(() => resize.disconnect())
    })
  }
  function register(id: string, el: HTMLElement) {
    nodes.set(id, el); observer?.observe(el); scheduleMeasure()
    onCleanup(() => { observer?.unobserve(el); if (nodes.get(id) === el) nodes.delete(id); scheduleMeasure() })
  }
  function scheduleMeasure() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!world) return
      const base = world.getBoundingClientRect()
      const next: Record<string, Rect> = {}
      for (const [id, el] of nodes) {
        if (!el.isConnected) continue
        const r = el.getBoundingClientRect()
        next[id] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }
      }
      setRects(old => JSON.stringify(old) === JSON.stringify(next) ? old : next)
    })
  }
  onMount(() => { observer = new ResizeObserver(scheduleMeasure); for (const el of nodes.values()) observer.observe(el); scheduleMeasure() })
  createEffect(() => { groups(); concept(); active(); scheduleMeasure() })
  onCleanup(() => { dragCleanup?.(); observer?.disconnect(); cancelAnimationFrame(frame) })
  function contentHeight(g: Group) {
    return Math.max(400, ...g.columns.map(c => c.y + (rects()[`column:${c.id}`]?.h ?? 330) + 24), ...g.items.map(item => item.y + (rects()[`item:${item.id}`]?.h ?? 180) + 24))
  }
  const endpoints = createMemo(() => groups().flatMap(g => [
    { id: `area:${g.id}`, title: g.title, label: `${g.title} · area`, groupId: g.id },
    ...g.columns.map(c => ({ id: `column:${c.id}`, title: c.title, label: `${g.title} · ${c.title}`, groupId: g.id })),
    ...g.items.map(i => ({ id: `item:${i.id}`, title: i.title, label: `${g.title} · ${i.title || 'Untitled item'}`, groupId: g.id })),
  ]))
  const endpointName = (id: string) => endpoints().find(e => e.id === id)?.title ?? 'Removed item'
  const drawnArrows = createMemo(() => {
    const boxes = rects()
    const visibleEndpoint = (id: string) => {
      const entry = endpoints().find(e => e.id === id)
      if (!entry) return undefined
      return groups().find(g => g.id === entry.groupId)?.collapsed ? `area:${entry.groupId}` : id
    }
    return arrows().flatMap(arrow => {
      const source = visibleEndpoint(arrow.from), target = visibleEndpoint(arrow.to)
      if (!source || !target || source === target || !boxes[source] || !boxes[target]) return []
      const a = boxes[source], b = boxes[target], [sideA, sideB] = autoSides(a, b)
      return [{ ...arrow, d: connectorPath(a, sideA, { rect: b, side: sideB }).d, collapsed: source !== arrow.from || target !== arrow.to }]
    })
  })
  function addArrow() {
    if (from() === to() || !endpoints().some(e => e.id === from()) || !endpoints().some(e => e.id === to())) { setMessage('Choose two different items for the arrow.'); return }
    if (arrows().some(a => a.from === from() && a.to === to())) { setMessage('That arrow already exists.'); return }
    saveArrows([...arrows(), { id: crypto.randomUUID(), from: from(), to: to() }]); setShowArrows(true)
    setMessage(`Arrow added from ${endpointName(from())} to ${endpointName(to())}.`)
  }
  const current = () => details[concept()]
  const noteCount = (g: Group) => g.columns.reduce((count, c) => count + c.notes.length, 0) + g.items.length
  const itemIcon = (kind: AreaItem['kind']): IconName => ({ note: 'note', todo: 'todo', link: 'link', image: 'image' } as const)[kind]
  function safeUrl(url: string) { try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined } catch { return undefined } }

  function AreaItemView(props: { group: Group; item: AreaItem }) {
    const g = () => props.group, item = () => props.item
    return <article class="gp-area-item" data-item={item().id} ref={el => register(`item:${item().id}`, el)}
      style={concept() === 'areas' ? { left: `${item().x}px`, top: `${item().y}px` } : {}}>
      <div class="gp-item-body gp-note" classList={{ 'gp-note-selected': selectedNote() === item().id }} onFocusIn={() => setSelectedNote(item().id)}
        style={item().color ? { background: `var(--dn-card-${item().color}-bg)`, color: `var(--dn-card-${item().color}-text)` } : {}}>
        <header class="gp-item-head" onPointerDown={e => drag(e, g().id, undefined, item().id)}>
          <Show when={concept() === 'areas'}><button class="gp-drag-handle" aria-label={`Drag ${item().title} item`} title="Drag item"><Icon name="grip" size={16} /></button></Show>
          <Icon name={itemIcon(item().kind)} size={16} /><span>{item().kind === 'todo' ? 'Checklist' : item().kind === 'link' ? 'Reference' : item().kind === 'image' ? 'Image' : 'Note'}</span>
          <button class="gp-item-remove" aria-label={`Remove ${item().title}`} title="Remove sample item" onClick={() => removeItem(g().id, item().id)}><Icon name="close" size={14} /></button>
        </header>
        <Show when={item().kind === 'image' && item().src}><img class="gp-reference-image" src={item().src} alt={item().title} onLoad={scheduleMeasure} /></Show>
        <textarea class="gp-note-title" ref={autosize} rows={1} aria-label={`Area item title: ${item().title}`} value={item().title} onInput={e => fit(e.currentTarget)} onChange={e => updateItem(g().id, item().id, i => ({ ...i, title: e.currentTarget.value }))} />
        <Show when={item().kind !== 'todo'}><textarea ref={autosize} rows={2} aria-label={item().id === 'context' ? 'Loose context note' : `Area item text: ${item().title}`} placeholder={item().kind === 'image' ? 'Add a caption…' : 'Write a little more…'} value={item().body} onInput={e => fit(e.currentTarget)} onChange={e => updateItem(g().id, item().id, i => ({ ...i, body: e.currentTarget.value }))} /></Show>
        <Show when={item().kind === 'todo'}>
          <div class="gp-checklist"><For each={(item().checks ?? []).map(check => check.id)}>{checkId => {
            const check = () => item().checks!.find(c => c.id === checkId)!
            return <label><input type="checkbox" checked={check().done} aria-label={`Complete ${check().text}`} onChange={e => updateItem(g().id, item().id, i => ({ ...i, checks: i.checks!.map(c => c.id === checkId ? { ...c, done: e.currentTarget.checked } : c) }))} /><input type="text" aria-label={`Task text: ${check().text}`} value={check().text} classList={{ checked: check().done }} onChange={e => updateItem(g().id, item().id, i => ({ ...i, checks: i.checks!.map(c => c.id === checkId ? { ...c, text: e.currentTarget.value } : c) }))} /></label>
          }}</For></div>
          <button class="gp-add-task" onClick={() => updateItem(g().id, item().id, i => ({ ...i, checks: [...i.checks ?? [], { id: crypto.randomUUID(), text: 'New task', done: false }] }))}><Icon name="plus" size={14} />Add task</button>
        </Show>
        <Show when={item().kind === 'link'}>
          <label class="gp-url-label">URL<input type="url" aria-label={`Reference URL: ${item().title}`} placeholder="https://…" value={item().url ?? ''} onChange={e => updateItem(g().id, item().id, i => ({ ...i, url: e.currentTarget.value }))} /></label>
          <Show when={safeUrl(item().url ?? '')}><a class="gp-open-reference" href={safeUrl(item().url ?? '')} target="_blank" rel="noreferrer">Open reference<Icon name="line" size={14} /></a></Show>
        </Show>
      </div>
      <label class="gp-move-label"><Icon name="multi" size={13} /><select aria-label={`Area for ${item().title}`} onChange={e => moveItem(g().id, item().id, e.currentTarget.value)}><For each={groups()}>{group => <option value={group.id} selected={group.id === g().id}>{group.title}</option>}</For></select></label>
    </article>
  }

  function GroupView(props: { group: Group }) {
    const g = () => props.group
    let fileInput!: HTMLInputElement
    function added(e: MouseEvent, action: () => void) { e.currentTarget instanceof Element && e.currentTarget.closest('details')?.removeAttribute('open'); action() }
    return <section class="gp-group" data-group={g().id} ref={el => register(`area:${g().id}`, el)} classList={{ 'gp-folded': g().collapsed }}
      style={concept() === 'areas' ? { left: `${g().x}px`, top: `${g().y}px`, width: `${areaWidth(g())}px` } : {}} aria-label={`${g().title} group`}>
      <header class="gp-group-head" onPointerDown={e => { if (!(e.target as Element).closest('details')) drag(e, g().id) }}>
        <Show when={concept() === 'areas'}><button class="gp-drag-handle" aria-label={`Drag ${g().title} area`} title="Drag area"><Icon name="grip" size={17} /></button></Show>
        <button class="gp-icon-button" aria-label={`${g().collapsed ? 'Expand' : 'Collapse'} ${g().title}`} aria-expanded={!g().collapsed} onClick={() => updateGroup(g().id, group => ({ ...group, collapsed: !group.collapsed }))}><Icon name={g().collapsed ? 'open' : 'chevronDown'} size={17} /></button>
        <span class="gp-group-dot" style={{ background: `var(--dn-card-${g().color}-bg)` }} />
        <input class="gp-group-title" aria-label={`Group name: ${g().title}`} value={g().title} maxlength="70" onChange={e => updateGroup(g().id, group => ({ ...group, title: e.currentTarget.value.trim() || 'Untitled group' }))} />
        <span class="gp-count">{g().columns.length} columns <span>· {noteCount(g())} items</span></span>
        <Show when={concept() === 'areas'}><button class="gp-text-button gp-tidy" onClick={() => tidy(g().id)}><Icon name="tidy" size={15} />Tidy</button></Show>
        <details class="gp-add-menu"><summary aria-label={`Add to ${g().title}`}><Icon name="plus" size={16} />Add to area</summary><div class="gp-add-options">
          <button onClick={e => added(e, () => addColumn(g().id))}><Icon name="column" size={17} />Column</button>
          <For each={['note', 'todo', 'link'] as const}>{kind => <button onClick={e => added(e, () => addItem(g().id, kind))}><Icon name={itemIcon(kind)} size={17} />{kind === 'todo' ? 'Checklist' : kind === 'link' ? 'Link' : 'Note'}</button>}</For>
          <button onClick={e => added(e, () => fileInput.click())}><Icon name="image" size={17} />Image</button>
        </div></details>
        <input ref={fileInput} class="gp-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={`Image for ${g().title}`} onChange={e => { loadImage(g().id, e.currentTarget.files?.[0]); e.currentTarget.value = '' }} />
      </header>
      <Show when={!g().collapsed}>
        <p class="gp-group-description">{g().description}</p>
        <div class="gp-area-content" style={concept() === 'areas' ? { 'min-height': `${contentHeight(g())}px` } : {}}>
          <div class="gp-columns">
            <For each={g().columns.map(c => c.id)}>{id => { const col = () => g().columns.find(c => c.id === id)!; return <article class="gp-column" data-column={id} ref={el => register(`column:${id}`, el)} style={concept() === 'areas' ? { position: 'relative', left: `${col().x}px`, top: `${col().y}px` } : {}}>
              <header class="gp-column-head" onPointerDown={e => drag(e, g().id, col().id)}>
                <Show when={concept() === 'areas'}><button class="gp-drag-handle" aria-label={`Drag ${col().title} column in ${g().title}`} title="Drag column"><Icon name="grip" size={16} /></button></Show>
                <input aria-label={`Column name: ${col().title} in ${g().title}`} value={col().title} maxlength="60" onChange={e => updateColumn(g().id, col().id, c => ({ ...c, title: e.currentTarget.value.trim() || 'Untitled column' }))} /><span>{col().notes.length}</span>
              </header>
              <div class="gp-note-list">
                <For each={col().notes}>{note => <div class="gp-note" data-note={note.id} classList={{ 'gp-note-selected': selectedNote() === note.id }} style={note.color ? { background: `var(--dn-card-${note.color}-bg)`, color: `var(--dn-card-${note.color}-text)` } : {}} onFocusIn={() => setSelectedNote(note.id)}>
                  <Show when={note.done}><span class="gp-complete"><Icon name="check" size={14} />Sorted</span></Show>
                  <textarea class="gp-note-title" ref={autosize} rows={1} onInput={e => fit(e.currentTarget)} aria-label={`Note title: ${note.title}`} value={note.title} onChange={e => updateNote(g().id, col().id, note.id, 'title', e.currentTarget.value)} />
                  <textarea ref={autosize} onInput={e => fit(e.currentTarget)} aria-label={`Note text: ${note.title}`} value={note.body} rows={2} placeholder="Write a little more…" onChange={e => updateNote(g().id, col().id, note.id, 'body', e.currentTarget.value)} />
                </div>}</For>
                <Show when={!col().notes.length}><div class="gp-empty">A little room for what’s next.</div></Show>
                <button class="gp-add-note" onClick={() => addNote(g().id, col().id)}><Icon name="plus" size={14} />Add note</button>
              </div>
              <label class="gp-move-label"><Icon name="layers" size={13} /><select aria-label={`Group for ${col().title} in ${g().title}`} onChange={e => moveColumn(g().id, col().id, e.currentTarget.value)}><For each={groups()}>{group => <option value={group.id} selected={group.id === g().id}>{group.title}</option>}</For></select></label>
            </article> }}</For>
            <Show when={!g().columns.length}><div class="gp-empty-group"><p>No columns here yet.</p><button class="gp-text-button" onClick={() => addColumn(g().id)}><Icon name="plus" size={16} />Add a column</button></div></Show>
          </div>
          <div class="gp-area-items"><For each={g().items.map(i => i.id)}>{id => <AreaItemView group={g()} item={g().items.find(i => i.id === id)!} />}</For></div>
        </div>
      </Show>
    </section>
  }

  return <div class="gp-app">
    <header class="gp-explorer">
      <div class="gp-explorer-title"><Icon name="paw" size={23} /><div><h1>A little more organized.</h1><p>Projects, workflows, and the ideas around them</p></div></div>
      <nav class="gp-concepts" aria-label="Grouping concept"><For each={['areas', 'sections', 'tabs'] as Concept[]}>{id => <button aria-pressed={concept() === id} onClick={() => switchConcept(id)}><Icon name={details[id].icon} size={18} />{details[id].title}</button>}</For></nav>
      <button class="gp-icon-button" aria-label={`Switch to ${theme() === 'dark' ? 'light' : 'dark'} theme`} title="Change theme" onClick={toggleTheme}><Icon name={theme() === 'dark' ? 'sun' : 'moon'} size={20} /></button>
    </header>
    <div class="gp-workspace">
      <div class="gp-board-shell">
        <div class="gp-board-bar"><div><Icon name="board" size={18} /><span>Life, lately</span><span class="gp-demo-label">Sample board</span></div><button class="gp-text-button" aria-pressed={showArrows()} onClick={() => setShowArrows(!showArrows())}><Icon name="line" size={16} />{showArrows() ? 'Hide arrows' : 'Show arrows'}</button></div>
        <Show when={concept() === 'tabs'}><nav class="gp-project-tabs" aria-label="Project groups"><For each={groups()}>{g => <button aria-pressed={active() === g.id} onClick={() => jump(g.id)}><span class="gp-group-dot" style={{ background: `var(--dn-card-${g.color}-bg)` }} />{g.title}<span class="gp-count">{g.columns.length}</span></button>}</For></nav></Show>
        <div ref={stage} class={`gp-stage gp-${concept()}`}>
          <div ref={world} class="gp-world" style={concept() === 'areas' ? { width: `${Math.max(2040, ...groups().map(g => g.x + areaWidth(g) + 60))}px`, 'min-height': `${Math.max(1000, ...groups().map(g => g.y + contentHeight(g) + 150))}px` } : {}}>
            <For each={groups().filter(g => concept() !== 'tabs' || g.id === active()).map(g => g.id)}>{id => <GroupView group={groups().find(g => g.id === id)!} />}</For>
            <Show when={showArrows()}><svg class="gp-area-connections" role="img" aria-label="Project planning arrows"><defs><marker id="gp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--dn-text-muted)" /></marker></defs><For each={drawnArrows()}>{arrow => <path data-arrow={arrow.id} d={arrow.d} stroke-dasharray={arrow.collapsed ? '6 4' : undefined} marker-end="url(#gp-arrow)"><title>{endpointName(arrow.from)} to {endpointName(arrow.to)}</title></path>}</For></svg></Show>
          </div>
        </div>
        <footer class="gp-status"><span role="status" aria-live="polite">{message()}</span><span>{storageError() ? 'Session only · local storage is full' : 'Editable demo · saved on this device'}</span></footer>
      </div>
      <aside class="gp-guide">
        <div class="gp-guide-intro"><Icon name={current().icon} size={25} /><h2>{current().subtitle}</h2><p>{current().description}</p></div>
        <div class="gp-guide-section gp-arrow-editor"><h3>Project arrows</h3><p>Connect stages, supporting items, or whole areas.</p>
          <label>From<select aria-label="Arrow from" value={from()} onChange={e => setFrom(e.currentTarget.value)}><For each={endpoints()}>{entry => <option value={entry.id} selected={entry.id === from()}>{entry.label}</option>}</For></select></label>
          <label>To<select aria-label="Arrow to" value={to()} onChange={e => setTo(e.currentTarget.value)}><For each={endpoints()}>{entry => <option value={entry.id} selected={entry.id === to()}>{entry.label}</option>}</For></select></label>
          <button class="gp-text-button gp-create-arrow" disabled={from() === to()} onClick={addArrow}><Icon name="line" size={16} />Add arrow</button>
          <details class="gp-arrow-list"><summary>{arrows().length} saved arrows</summary><ul><For each={arrows()}>{arrow => <li><span>{endpointName(arrow.from)}<Icon name="line" size={13} />{endpointName(arrow.to)}</span><button class="gp-icon-button" aria-label={`Remove arrow from ${endpointName(arrow.from)} to ${endpointName(arrow.to)}`} onClick={() => { saveArrows(arrows().filter(a => a.id !== arrow.id)); setMessage('Arrow removed.') }}><Icon name="close" size={14} /></button></li>}</For></ul></details>
        </div>
        <div class="gp-guide-section"><h3>Try it out</h3><ul><For each={current().actions}>{action => <li>{action}</li>}</For></ul><p class="gp-edit-hint">Everything inside an area moves with it. Collapsing it tucks the contents away.</p></div>
        <div class="gp-guide-section"><h3>Why this works</h3><p>{current().benefit}</p><h3>The tradeoff</h3><p>{current().tradeoff}</p></div>
        <div class="gp-guide-section gp-jumps"><h3>On this board</h3><For each={groups()}>{g => <button class="gp-jump" onClick={() => jump(g.id)}><span class="gp-group-dot" style={{ background: `var(--dn-card-${g.color}-bg)` }} />{g.title}<Icon name="open" size={14} /></button>}</For></div>
        <button class="gp-reset" onClick={reset}><Icon name="restore" size={16} />Reset sample board</button><p class="gp-local-only">A concept playground. Your real boards stay as they are.</p>
      </aside>
    </div>
  </div>
}
