import { For, Show, createEffect, createMemo, createSignal, on, onMount } from 'solid-js'
import { COLUMN_HEADER, type Card } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { columnCollapsed, setColumnCollapsed } from '../state/columns.ts'
import { endEdit } from '../state/ui.ts'
import { columnChildren } from '../state/actions.ts'
import { CardView, type CardProps } from '../canvas/CardView.tsx'
import { dropTarget } from '../canvas/dnd.ts'
import { remeasure, setMeasuring } from '../canvas/layout.ts'

export function ColumnCard(props: CardProps<'column'>) {
  const collapsed = () => columnCollapsed(props.card)
  const title = () => typeof props.card.content?.title === 'string' ? props.card.content.title : ''
  const kids = createMemo(() => columnChildren(props.card.id))
  // The body slides shut before it unmounts, and slides open after it mounts. Board
  // measuring pauses for the slide (it otherwise re-measured every card each frame)
  // and catches up once at the end.
  const [open, setOpen] = createSignal(!collapsed())
  let body: HTMLDivElement | undefined
  let expanding = false
  const animate = () => !props.lod && !matchMedia('(prefers-reduced-motion: reduce)').matches
  const slide = (el: HTMLElement, opening: boolean) => {
    const full = { height: `${el.offsetHeight}px`, opacity: 1 }, shut = { height: '0px', opacity: 0 }
    setMeasuring(false)
    el.classList.add('sliding')
    const anim = el.animate(opening ? [shut, full] : [full, shut], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' })
    const done = () => { el.classList.remove('sliding'); setMeasuring(true); remeasure(el.closest<HTMLElement>('[data-card-id]')) }
    anim.addEventListener('finish', done); anim.addEventListener('cancel', done)
    return anim
  }
  createEffect(on(collapsed, (shut) => {
    if (!shut) { expanding = !open(); setOpen(true); return }
    if (!body || !animate()) { setOpen(false); return }
    const anim = slide(body, false)
    anim.onfinish = anim.oncancel = () => { if (collapsed()) setOpen(false) }
  }, { defer: true }))
  const drop = () => {
    const d = dropTarget()
    return d?.columnId === props.card.id ? d.index : -1
  }

  return (
    <div class="column" style={{ '--column-header': `${COLUMN_HEADER}px` }} classList={{ collapsed: collapsed(), 'drop-active': drop() >= 0 }}>
      <div class="column-head">
        <button class="column-toggle" data-testid="column-toggle" data-nodrag
          aria-label={collapsed() ? 'Expand column' : 'Collapse column'} aria-expanded={!collapsed()}
          title={collapsed() ? 'Expand column' : 'Collapse column'}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (!e.metaKey && !e.ctrlKey && e.key !== 'Escape') e.stopPropagation() }}
          onClick={(e) => { e.stopPropagation(); setColumnCollapsed(props.card.id, !collapsed(), props.readOnly) }}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d={collapsed() ? 'M6 3l5 5-5 5' : 'M3 6l5 5 5-5'} fill="none" stroke="currentColor" stroke-width="1.8" /></svg>
        </button>
        <div class="column-heading" data-edit-title>
        <Show
          when={props.editing}
          fallback={
            <div class="column-title" data-testid="column-title" title={title() || 'Column'}>
              {title() || 'Column'}
            </div>
          }
        >
          <input
            ref={(el) => onMount(() => el.focus())}
            class="column-title-input"
            data-testid="column-title-input"
            placeholder="Column"
            value={title()}
            onInput={(e) => doc.transient(props.card.id, { content: { title: e.currentTarget.value } } as Partial<Card>)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                endEdit()
              }
            }}
          />
        </Show>
        <div class="column-meta" title={collapsed() ? 'Live cards in this column. Dashed connections lead to hidden cards.' : 'Live cards in this column'}>
          {kids().length} card{kids().length === 1 ? '' : 's'}
        </div>
        </div>
      </div>
      <Show when={open()}>
      <div class="column-body" data-testid="column-body" ref={(el) => { body = el; onMount(() => { if (expanding && animate()) slide(el, true); expanding = false }) }}>
        <For each={kids()}>
          {(k, i) => (
            <>
              <Show when={drop() === i()}>
                <div class="drop-line" data-testid="drop-line" />
              </Show>
              <CardView card={k} lod={props.lod} readOnly={props.readOnly} inColumn />
            </>
          )}
        </For>
        <Show when={drop() === kids().length}>
          <div class="drop-line" data-testid="drop-line" />
        </Show>
        <Show when={!kids().length && drop() < 0}>
          <div class="column-empty">Drag cards here</div>
        </Show>
      </div>
      </Show>
    </div>
  )
}
