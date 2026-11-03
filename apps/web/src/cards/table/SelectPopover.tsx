import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { TABLE_CAPS, findOption, type SelectOption } from '@doggynote/core'
import { Icon } from '../../ui/icons.tsx'
import { Popover } from '../../ui/Popover.tsx'
import { chipVars } from './chip.ts'

// Picking a tag: a filter box over the column's options. Typing narrows them,
// arrows move, Enter picks (or creates the typed name when nothing matches).
// The same panel as Labels (a popover on a desktop, a sheet on a phone).

const CREATE = 'create'
const optionDomId = (key: string) => `table-option-${key}`

export function SelectPopover(props: {
  anchor: () => HTMLElement
  follow: () => unknown
  options: () => SelectOption[]
  /** The option the cell has now, if any. */
  value: () => string | null
  query: string
  onPick: (id: string | null) => void
  onCreate: (name: string) => void
  close: () => void
}) {
  const [query, setQuery] = createSignal(props.query)
  const [picked, setPicked] = createSignal<string | null>(null)
  let list: HTMLUListElement | undefined
  const q = () => query().trim().toLowerCase()
  const shown = createMemo(() => props.options().filter((o) => !q() || o.n.toLowerCase().includes(q())))
  const exact = () => (q() ? findOption(props.options(), query()) : undefined)
  const full = () => props.options().length >= TABLE_CAPS.options
  const canCreate = () => !!query().trim() && !exact() && !full()
  const keys = createMemo(() => [...shown().map((o) => o.id), ...(canCreate() ? [CREATE] : [])])
  // While typing, the exact name or else the first match is highlighted; Create only when nothing matches.
  const active = createMemo(() => {
    const p = picked()
    if (p && keys().includes(p)) return p
    if (!q()) return props.value() && keys().includes(props.value()!) ? props.value() : null
    return exact()?.id ?? keys()[0] ?? null
  })
  createEffect(() => { const a = active(); if (a) queueMicrotask(() => list?.querySelector(`#${optionDomId(a)}`)?.scrollIntoView({ block: 'nearest' })) })

  const choose = (key: string) => (key === CREATE ? props.onCreate(query().trim()) : props.onPick(key))
  const onKeyDown = (e: KeyboardEvent) => {
    const all = keys()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!all.length) return
      const at = all.indexOf(active() ?? '')
      setPicked(all[e.key === 'ArrowDown' ? Math.min(at + 1, all.length - 1) : Math.max(at - 1, 0)]!)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const key = active()
      if (key) choose(key)
    }
  }

  return (
    <Popover anchor={props.anchor} label={COPY.table.types.select} testid="table-select-popover" class="labels-panel table-pop table-select" align="start" close={props.close} follow={props.follow}>
      <div class="nav-menu-head sheet-only" aria-hidden="true"><strong>{COPY.table.types.select}</strong></div>
      <input
        class="labels-input"
        data-testid="table-select-input"
        data-autofocus
        role="combobox"
        aria-label={COPY.table.findOption}
        aria-expanded={keys().length > 0}
        aria-controls="table-select-list"
        aria-autocomplete="list"
        aria-activedescendant={active() ? optionDomId(active()!) : undefined}
        placeholder={COPY.table.findOption}
        autocomplete="off"
        maxLength={TABLE_CAPS.name}
        value={query()}
        onInput={(e) => { setQuery(e.currentTarget.value); setPicked(null) }}
        onKeyDown={onKeyDown}
      />
      <Show when={keys().length} fallback={<p class="labels-empty" data-testid="table-select-empty">{full() ? COPY.table.optionsFull : COPY.table.noOptions}</p>}>
        <ul ref={list} id="table-select-list" class="labels-list" role="listbox" aria-label={COPY.table.types.select}>
          <For each={shown()}>
            {(o) => (
              <li id={optionDomId(o.id)} role="option" aria-selected={props.value() === o.id} class="label-row" classList={{ active: active() === o.id }} data-testid="table-option" data-option={o.n}>
                <button type="button" tabIndex={-1} class="label-toggle" aria-label={o.n} onClick={() => choose(o.id)}>
                  <span class="label-check table-tick" aria-hidden="true"><Show when={props.value() === o.id}><Icon size={12} name="check" /></Show></span>
                  <span class="table-chip" data-none={o.c === 'none' ? '' : undefined} style={chipVars(o.c)}>{o.n}</span>
                </button>
              </li>
            )}
          </For>
          <Show when={canCreate()}>
            <li id={optionDomId(CREATE)} role="option" aria-selected={false} class="label-row label-create-row" classList={{ active: active() === CREATE }}>
              <button type="button" tabIndex={-1} class="label-toggle label-create" data-testid="table-option-create" onClick={() => choose(CREATE)}>
                <span class="label-check label-plus" aria-hidden="true"><Icon size={16} name="plus" /></span>
                <span class="label-create-text">{COPY.table.createOption(query().trim())}</span>
              </button>
            </li>
          </Show>
        </ul>
      </Show>
      <Show when={props.value()}>
        <button type="button" class="table-pop-clear" data-testid="table-select-clear" onClick={() => props.onPick(null)}><Icon size={16} name="eraser" />{COPY.table.clearValue}</button>
      </Show>
    </Popover>
  )
}
