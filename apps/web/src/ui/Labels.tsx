import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { LABEL_PRESETS, MAX_LABEL_NAME, inkFor, normalizeLabelName, normalizeSwatchHex, pickLabelColor, type Card, type Label, type LabelColor } from '@doggynote/core'
import { cardColors } from '@doggynote/theme'
import { theme } from '../theme.ts'
import * as doc from '../state/doc.ts'
import { createLabel, findLabel, hasLabel, labelNameProblem, labelUsage, labelsFor, labelsOn, recolorLabel, removeLabel, renameLabel, restoreLabel, setLabelOn } from '../state/labels.ts'
import { showToast } from '../state/toast.ts'
import { Icon, IconButton, ToolIcons } from './icons.tsx'
import { Popover } from './Popover.tsx'
import './labels.css'

const isHex = (c: LabelColor): c is `#${string}` => c.startsWith('#')
const colorName = (c: LabelColor) => (isHex(c) ? c : c[0]!.toUpperCase() + c.slice(1))

/**
 * A label's colours. Presets paint with the theme's card colours (light and
 * dark); a custom colour is document data. The text is black or white,
 * whichever has more contrast on the colour actually drawn.
 */
export function labelStyle(c: LabelColor): JSX.CSSProperties {
  const bg = isHex(c) ? c : cardColors[theme()][c].bg
  return { '--label-bg': isHex(c) ? c : `var(--dn-card-${c}-bg)`, '--label-text': inkFor(bg), '--label-dot': isHex(c) ? c : `var(--dn-card-${c}-bg)` }
}

/** A label as a chip: on cards, in the popover and in search results. */
export function LabelChip(props: { label: Label; title?: boolean }) {
  return <span class="label-chip" style={labelStyle(props.label.color)} data-color={props.label.color} title={props.title ? props.label.name : undefined}>{props.label.name}</span>
}

/** The labels on a card, as chips along its foot. Content, so it's in exports too. */
export function CardLabels(props: { card: Card }) {
  const labels = () => labelsFor(props.card)
  return (
    <Show when={labels().length}>
      <ul class="card-labels" aria-label="Labels" data-testid="card-labels">
        <For each={labels()}>{(label) => <li><LabelChip label={label} title /></li>}</For>
      </ul>
    </Show>
  )
}

/** Selection bar: the labels icon and its popover. */
export function LabelsButton(props: { cards: Card[]; labelled?: boolean }) {
  const [open, setOpen] = createSignal(false)
  let trigger!: HTMLButtonElement
  return (
    <>
      {/* Docked on touch, an icon over its label like the other actions (glass has no hover tips). */}
      <Show when={props.labelled} fallback={<IconButton ref={(el) => (trigger = el)} testid="labels-button" icon={ToolIcons.label} label="Labels" popup expanded={open()} onClick={() => setOpen(!open())} />}>
        <button ref={(el) => (trigger = el)} class="bar-btn" data-testid="labels-button" aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}>
          <Icon size={18}>{ToolIcons.label()}</Icon>
          <span class="bar-btn-label">Labels</span>
        </button>
      </Show>
      <Show when={open()}>
        <LabelsPopover cards={props.cards} anchor={() => trigger} close={() => setOpen(false)} />
      </Show>
    </>
  )
}

/** Preset dots, then the system colour wheel in the last slot. */
function ColorDots(props: { label: string; value: LabelColor; onPick: (c: LabelColor) => void; live?: boolean }) {
  const custom = () => isHex(props.value)
  const pick = (value: string) => {
    const hex = normalizeSwatchHex(value)
    if (hex) props.onPick(hex as LabelColor)
  }
  return (
    <div class="label-dots" role="group" aria-label={props.label}>
      <For each={LABEL_PRESETS}>
        {(c) => (
          <button
            type="button"
            class="label-dot"
            classList={{ on: props.value === c }}
            style={labelStyle(c)}
            data-testid="label-color"
            data-color={c}
            aria-label={colorName(c)}
            data-tip={colorName(c)}
            aria-pressed={props.value === c}
            onClick={() => props.onPick(c)}
          />
        )}
      </For>
      <label class="label-dot label-custom" classList={{ on: custom() }} style={custom() ? labelStyle(props.value) : undefined} data-tip="Custom colour">
        <Show when={!custom()}>
          <Icon size={14}>{ToolIcons.plus()}</Icon>
        </Show>
        <input
          type="color"
          data-testid="label-custom-color"
          aria-label="Custom colour"
          value={custom() ? props.value.toLowerCase() : '#3e63dd'}
          // The wheel fires input on every drag step: a new label follows it, an existing one saves once on close.
          onInput={(e) => props.live && pick(e.currentTarget.value)}
          onChange={(e) => pick(e.currentTarget.value)}
        />
      </label>
    </div>
  )
}

/**
 * A combobox over the board's labels. Typing filters and highlights the first
 * match; arrows move the highlight; Enter toggles it, or creates the typed name
 * when Create is highlighted (only when nothing matches, or arrowed to). Each
 * row renames in place; Remove offers Undo in a toast.
 */
function LabelsPopover(props: { cards: Card[]; anchor: () => HTMLElement; close: () => void }) {
  const boardId = props.cards[0]?.boardId ?? ''
  const [query, setQuery] = createSignal('')
  // Each new label starts on a random preset the board isn't using; rolled when typing starts, so it doesn't flicker per key.
  const [newColor, setNewColor] = createSignal<LabelColor>(pickLabelColor(labelsOn(boardId)))
  const [picked, setPicked] = createSignal<string | null>(null)
  const [renaming, setRenaming] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [renameError, setRenameError] = createSignal('')
  const [recoloring, setRecoloring] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  let listbox: HTMLUListElement | undefined
  const rows = new Map<string, HTMLButtonElement>()
  // The toggle that the first click of a double-click made, so the double-click can take it back.
  let lastToggle: { id: string; at: number } | null = null

  const cards = createMemo(() => props.cards.map((c) => doc.getCard(c.id)).filter((c): c is Card => !!c && c.boardId === boardId && !c.deletedAt && !c.purged))
  const writable = () => doc.canWriteObject(doc.getBoard(boardId)) && cards().length > 0 && cards().every((c) => doc.canWriteObject(c))
  const labels = () => labelsOn(boardId)
  const q = () => normalizeLabelName(query())
  const shown = createMemo(() => labels().filter((l) => !q() || normalizeLabelName(l.name).includes(q())).map((l) => l.id))
  const exact = () => (query().trim() ? findLabel(boardId, query()) : undefined)
  const canCreate = () => writable() && !!query().trim() && !exact()
  const options = createMemo(() => [...shown(), ...(canCreate() ? [CREATE] : [])])
  // While typing, the exact name or else the first match is highlighted; Create only when nothing matches.
  const active = createMemo(() => {
    const p = picked()
    if (p && options().includes(p)) return p
    if (!query().trim()) return null
    return exact()?.id ?? options()[0] ?? null
  })
  const optionId = (key: string) => `label-option-${key}`
  const count = (id: string) => cards().filter((c) => hasLabel(c, id)).length
  const state = (id: string) => (count(id) === 0 ? false : count(id) === cards().length ? true : 'mixed')
  const toggle = (id: string) => setLabelOn(boardId, id, cards(), count(id) < cards().length)

  createEffect(() => { if (!cards().length) props.close() })
  // Someone else removed the label mid-rename: drop the edit rather than resurrect it.
  createEffect(() => { const id = renaming(); if (id && !labels().some((l) => l.id === id)) setRenaming(null) })
  createEffect(() => { const a = active(); if (a) queueMicrotask(() => listbox?.querySelector(`#${optionId(a)}`)?.scrollIntoView({ block: 'nearest' })) })

  const create = () => {
    const problem = labelNameProblem(boardId, query())
    if (problem) return setError(problem)
    createLabel(boardId, query(), newColor(), cards())
    reset()
  }
  const reset = () => { setQuery(''); setPicked(null); setError('') }
  const choose = (key: string) => {
    if (key === CREATE) return create()
    if (writable()) toggle(key)
    reset()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const list = options()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!list.length) return
      const at = list.indexOf(active() ?? '')
      setPicked(list[e.key === 'ArrowDown' ? Math.min(at + 1, list.length - 1) : Math.max(at - 1, 0)]!)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const key = active()
      if (key) choose(key)
    }
  }

  const onToggleClick = (id: string, e: MouseEvent) => {
    // The second click of a double-click belongs to rename.
    if (e.detail > 1) return
    toggle(id)
    lastToggle = { id, at: performance.now() }
  }
  const onChipDblClick = (id: string, e: MouseEvent) => {
    e.stopPropagation()
    if (lastToggle?.id === id && performance.now() - lastToggle.at < 1000) doc.undo()
    lastToggle = null
    startRename(id)
  }

  const startRename = (id: string) => {
    const label = labels().find((l) => l.id === id)
    if (!label || !writable()) return
    setRecoloring(null)
    setRenameError('')
    setDraft(label.name)
    setRenaming(id)
  }
  const endRename = (save: boolean) => {
    const id = renaming()
    if (!id) return
    if (save) {
      const problem = labelNameProblem(boardId, draft(), id)
      if (problem && draft().trim()) return setRenameError(problem)
      if (!problem) renameLabel(boardId, id, draft())
    }
    setRenaming(null)
    setRenameError('')
    queueMicrotask(() => rows.get(id)?.focus())
  }

  const remove = (id: string) => {
    const label = labels().find((l) => l.id === id)
    if (!label) return
    const used = labelUsage(boardId, id)
    removeLabel(boardId, id)
    showToast(used ? `Removed “${label.name}” from ${used} ${used === 1 ? 'card' : 'cards'}` : `Removed “${label.name}”`, 6000, { label: 'Undo', run: () => restoreLabel(boardId, id, label.name) })
  }

  return (
    <Popover anchor={props.anchor} label="Labels" testid="labels-popover" class="labels-panel" align="start" close={props.close}>
      <input
        class="labels-input"
        data-testid="labels-input"
        data-autofocus
        role="combobox"
        aria-label={writable() ? 'Find or create a label' : 'Find a label'}
        aria-expanded={options().length > 0}
        aria-controls="labels-listbox"
        aria-autocomplete="list"
        aria-activedescendant={active() ? optionId(active()!) : undefined}
        aria-invalid={!!error() || undefined}
        aria-describedby={error() ? 'labels-error' : undefined}
        placeholder={writable() ? 'Find or create a label' : 'Find a label'}
        autocomplete="off"
        maxLength={MAX_LABEL_NAME}
        value={query()}
        onInput={(e) => {
          if (!query().trim() && e.currentTarget.value.trim()) setNewColor(pickLabelColor(labels()))
          setQuery(e.currentTarget.value); setPicked(null); setError('')
        }}
        onKeyDown={onKeyDown}
      />
      <Show when={options().length}>
        <ul ref={listbox} id="labels-listbox" class="labels-list" role="listbox" aria-label="Labels on this board" aria-multiselectable="true">
          <For each={shown()}>
            {(id) => {
              const label = () => labels().find((l) => l.id === id)
              return (
                <Show when={label()}>
                  {(l) => (
                    <li
                      id={optionId(id)}
                      role="option"
                      aria-selected={state(id) === true}
                      class="label-row"
                      classList={{ renaming: renaming() === id, active: active() === id }}
                      data-testid="label-row"
                      data-label={l().name}
                    >
                      <Show
                        when={renaming() === id}
                        fallback={
                          <>
                            <button
                              ref={(el) => rows.set(id, el)}
                              type="button"
                              tabIndex={-1}
                              class="label-toggle"
                              data-testid="label-toggle"
                              aria-pressed={state(id)}
                              aria-label={l().name}
                              disabled={!writable()}
                              onClick={(e) => onToggleClick(id, e)}
                            >
                              <Check state={state(id)} />
                              <span class="label-chip" style={labelStyle(l().color)} data-testid="label-chip" onDblClick={(e) => onChipDblClick(id, e)}>{l().name}</span>
                            </button>
                            <Show when={writable()}>
                              <span class="label-actions">
                                <button type="button" class="label-action" data-testid="label-recolor" aria-label={`Colour of ${l().name}`} data-tip="Colour" data-tip-place="below" aria-expanded={recoloring() === id} onClick={() => setRecoloring(recoloring() === id ? null : id)}>
                                  <Icon size={16}>{ToolIcons.droplet()}</Icon>
                                </button>
                                <button type="button" class="label-action" data-testid="label-rename" aria-label={`Rename ${l().name}`} data-tip="Rename" data-tip-place="below" onClick={() => startRename(id)}>
                                  <Icon size={16}>{ToolIcons.edit()}</Icon>
                                </button>
                                <button type="button" class="label-action label-remove" data-testid="label-remove" aria-label={`Remove ${l().name} from this board (on ${labelUsage(boardId, id)} ${labelUsage(boardId, id) === 1 ? 'card' : 'cards'})`} data-tip="Remove label" data-tip-place="below" onClick={() => remove(id)}>
                                  <Icon size={16}>{ToolIcons.labelOff()}</Icon>
                                </button>
                              </span>
                            </Show>
                          </>
                        }
                      >
                        <span class="label-toggle label-toggle-static" aria-hidden="true"><Check state={state(id)} /></span>
                        <input
                          ref={(el) => queueMicrotask(() => { el.focus(); el.select() })}
                          class="labels-input label-rename"
                          data-testid="label-rename-input"
                          data-local-escape
                          aria-label={`Rename ${l().name}`}
                          aria-invalid={!!renameError() || undefined}
                          aria-describedby={renameError() ? 'label-rename-error' : undefined}
                          maxLength={MAX_LABEL_NAME}
                          value={draft()}
                          onInput={(e) => { setDraft(e.currentTarget.value); setRenameError('') }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); endRename(true) }
                            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endRename(false) }
                          }}
                          onBlur={() => endRename(!renameError())}
                        />
                        <Show when={renameError()}>
                          <p id="label-rename-error" class="labels-error label-rename-error" role="alert" data-testid="labels-error">{renameError()}</p>
                        </Show>
                      </Show>
                      <Show when={recoloring() === id && renaming() !== id}>
                        <ColorDots label={`Colour of ${l().name}`} value={l().color} onPick={(c) => { recolorLabel(boardId, id, c); setRecoloring(null) }} />
                      </Show>
                    </li>
                  )}
                </Show>
              )
            }}
          </For>
          <Show when={canCreate()}>
            <li id={optionId(CREATE)} role="option" aria-selected={false} class="label-row label-create-row" classList={{ active: active() === CREATE }}>
              <button type="button" tabIndex={-1} class="label-toggle label-create" data-testid="label-create" onClick={create}>
                <span class="label-check label-plus" aria-hidden="true"><Icon size={16}>{ToolIcons.plus()}</Icon></span>
                <span class="label-create-text">Create</span>
                <span class="label-chip" style={labelStyle(newColor())}>{query().trim()}</span>
              </button>
            </li>
          </Show>
        </ul>
      </Show>
      <Show when={canCreate()}>
        <ColorDots label="Colour for the new label" value={newColor()} live onPick={setNewColor} />
      </Show>
      <Show when={!writable() && query().trim() && !shown().length}>
        <p class="labels-empty" data-testid="labels-empty">No labels match</p>
      </Show>
      <Show when={error()}>
        <p id="labels-error" class="labels-error" role="alert" data-testid="labels-error">{error()}</p>
      </Show>
    </Popover>
  )
}

const CREATE = 'create'

function Check(props: { state: boolean | 'mixed' }) {
  return (
    <span class="label-check" aria-hidden="true">
      <Show when={props.state === true}><Icon size={14}>{ToolIcons.check()}</Icon></Show>
      <Show when={props.state === 'mixed'}><Icon size={14}>{ToolIcons.minus()}</Icon></Show>
    </span>
  )
}
