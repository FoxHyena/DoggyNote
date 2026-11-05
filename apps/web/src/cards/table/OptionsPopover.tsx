import { For, Show, createSignal } from 'solid-js'
import { CARD_COLORS, COPY, type PresetColor } from '@doggynote/theme'
import { TABLE_CAPS, findOption, type SelectOption, type TableColumn } from '@doggynote/core'
import { Icon } from '../../ui/icons.tsx'
import { Popover } from '../../ui/Popover.tsx'
import { ColorDots } from '../../ui/ColorDots.tsx'

// Editing a tag column's options: rename, recolour (the preset dots only), reorder
// and delete, then add a new one. Every change is its own step, saved as it is made.
// The same panel language as Labels: a popover on a desktop, a sheet on a phone.

export function OptionsPopover(props: {
  anchor: () => HTMLElement
  column: () => TableColumn | undefined
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onRecolor: (id: string, color: PresetColor) => void
  onMove: (id: string, to: number) => void
  onRemove: (id: string) => void
  close: () => void
}) {
  const options = () => props.column()?.opts ?? []
  const [colouring, setColouring] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  const [draft, setDraft] = createSignal('')
  const full = () => options().length >= TABLE_CAPS.options

  function rename(o: SelectOption, el: HTMLInputElement) {
    const name = el.value.replace(/\s+/g, ' ').trim()
    if (name === o.n) return setError('')
    const clash = findOption(options(), name)
    if (!name || (clash && clash.id !== o.id)) {
      el.value = o.n
      return setError(name ? COPY.table.optionTaken : '')
    }
    setError('')
    props.onRename(o.id, name)
  }
  function add() {
    const name = draft().trim()
    if (!name) return
    if (findOption(options(), name)) return setError(COPY.table.optionTaken)
    setError('')
    props.onAdd(name)
    setDraft('')
  }
  // Escape puts a half-typed name back; with nothing changed it closes the panel.
  const escape = (e: KeyboardEvent, el: HTMLInputElement, saved: string) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (el.value === saved) props.close()
    else el.value = saved
  }

  return (
    <Popover anchor={props.anchor} label={COPY.table.editOptions} testid="table-options-popover" class="labels-panel table-pop table-options" align="start" close={props.close}>
      <div class="nav-menu-head sheet-only" aria-hidden="true"><strong>{COPY.table.editOptions}</strong></div>
      <Show when={options().length} fallback={<p class="labels-empty" data-testid="table-options-empty">{COPY.table.noOptions}</p>}>
        <ul class="labels-list table-options-list" aria-label={COPY.table.editOptions}>
          <For each={options()}>
            {(o, i) => (
              <li class="label-row table-option-row" data-testid="table-option-row" data-option={o.n}>
                <button
                  type="button"
                  class="table-option-dot"
                  data-testid="table-option-colour"
                  style={chipDot(o.c)}
                  aria-label={COPY.table.optionColour(o.n)}
                  data-tip={COPY.table.optionColour(o.n)}
                  data-tip-place="below"
                  aria-expanded={colouring() === o.id}
                  onClick={() => setColouring(colouring() === o.id ? null : o.id)}
                />
                <input
                  class="labels-input table-option-name"
                  data-testid="table-option-name"
                  data-local-escape
                  aria-label={COPY.table.optionName}
                  maxLength={TABLE_CAPS.name}
                  value={o.n}
                  onChange={(e) => rename(o, e.currentTarget)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(o, e.currentTarget); e.currentTarget.blur() } else escape(e, e.currentTarget, o.n) }}
                />
                <span class="table-option-tools">
                  <button type="button" class="label-action" data-testid="table-option-up" aria-label={COPY.table.moveOptionUp} data-tip={COPY.table.moveOptionUp} data-tip-place="below" disabled={i() === 0} onClick={() => props.onMove(o.id, i() - 1)}><Icon size={16} name="arrowUp" /></button>
                  <button type="button" class="label-action" data-testid="table-option-down" aria-label={COPY.table.moveOptionDown} data-tip={COPY.table.moveOptionDown} data-tip-place="below" disabled={i() === options().length - 1} onClick={() => props.onMove(o.id, i() + 1)}><Icon size={16} name="arrowDown" /></button>
                  <button type="button" class="label-action" data-testid="table-option-delete" aria-label={COPY.table.deleteOption} data-tip={COPY.table.deleteOption} data-tip-place="below" onClick={() => props.onRemove(o.id)}><Icon size={16} name="trash" /></button>
                </span>
                <Show when={colouring() === o.id}>
                  <ColorDots
                    class="label-dots table-option-dots"
                    label={COPY.table.optionColour(o.n)}
                    dots={CARD_COLORS.map((c) => ({ value: c, name: COPY.colorNames[c] ?? c, paint: c === 'none' ? 'transparent' : `var(--dn-card-${c}-bg)`, testid: `table-option-colour-${c}`, none: c === 'none' }))}
                    value={o.c}
                    onPick={(c) => { props.onRecolor(o.id, c as PresetColor); setColouring(null) }}
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={error()}><p class="labels-error" role="alert" data-testid="table-options-error">{error()}</p></Show>
      <Show when={!full()} fallback={<p class="labels-empty">{COPY.table.optionsFull}</p>}>
        <input
          class="labels-input"
          data-testid="table-option-add"
          data-local-escape
          data-autofocus
          aria-label={COPY.table.addOption}
          placeholder={COPY.table.addOption}
          autocomplete="off"
          maxLength={TABLE_CAPS.name}
          value={draft()}
          onInput={(e) => { setDraft(e.currentTarget.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (draft()) { setDraft(''); setError('') } else props.close() } }}
        />
      </Show>
    </Popover>
  )
}

const chipDot = (c: PresetColor) => ({ '--dot': c === 'none' ? 'transparent' : `var(--dn-card-${c}-bg)` })
