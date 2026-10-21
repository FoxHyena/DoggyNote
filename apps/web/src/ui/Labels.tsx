import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { LABEL_PRESETS, MAX_LABEL_NAME, DEFAULT_LABEL_COLOR, normalizeLabelName, normalizeSwatchHex, type Card, type LabelColor } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { createLabel, findLabel, hasLabel, labelNameProblem, labelsFor, labelsOn, recolorLabel, removeLabel, renameLabel, setLabelOn } from '../state/labels.ts'
import { Icon, IconButton, ToolIcons } from './icons.tsx'
import { Popover } from './Popover.tsx'
import './labels.css'

const isHex = (c: LabelColor): c is `#${string}` => c.startsWith('#')
const colorName = (c: LabelColor) => (isHex(c) ? c : c[0]!.toUpperCase() + c.slice(1))

/** A label's colours. Presets are theme tokens (light and dark); a custom colour is document data, tinted for legible text. */
export function labelStyle(c: LabelColor): JSX.CSSProperties {
  return isHex(c)
    ? { '--label-bg': `color-mix(in srgb, ${c} 30%, var(--dn-card-none-bg))`, '--label-text': 'var(--dn-card-none-text)', '--label-edge': c, '--label-dot': c }
    : { '--label-bg': `var(--dn-card-${c}-bg)`, '--label-text': `var(--dn-card-${c}-text)`, '--label-dot': `var(--dn-card-${c}-bg)` }
}

/** The labels on a card, as chips along its foot. Content, so it's in exports too. */
export function CardLabels(props: { card: Card }) {
  const labels = () => labelsFor(props.card)
  return (
    <Show when={labels().length}>
      <ul class="card-labels" aria-label="Labels" data-testid="card-labels">
        <For each={labels()}>{(label) => <li class="label-chip" style={labelStyle(label.color)} title={label.name}>{label.name}</li>}</For>
      </ul>
    </Show>
  )
}

/** Selection bar: the labels icon and its popover. */
export function LabelsButton(props: { cards: Card[] }) {
  const [open, setOpen] = createSignal(false)
  let trigger!: HTMLButtonElement
  return (
    <>
      <IconButton ref={(el) => (trigger = el)} testid="labels-button" icon={ToolIcons.label} label="Labels" popup expanded={open()} onClick={() => setOpen(!open())} />
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
 * Type to find a label; click one to put it on (or take it off) the selection;
 * Enter or "Create" makes a new one. Each row renames in place.
 */
function LabelsPopover(props: { cards: Card[]; anchor: () => HTMLElement; close: () => void }) {
  const boardId = props.cards[0]?.boardId ?? ''
  const [query, setQuery] = createSignal('')
  const [newColor, setNewColor] = createSignal<LabelColor>(DEFAULT_LABEL_COLOR)
  const [renaming, setRenaming] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [recoloring, setRecoloring] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  let search!: HTMLInputElement
  const rows = new Map<string, HTMLButtonElement>()

  const cards = createMemo(() => props.cards.map((c) => doc.getCard(c.id)).filter((c): c is Card => !!c && c.boardId === boardId && !c.deletedAt && !c.purged))
  const writable = () => doc.canWriteObject(doc.getBoard(boardId)) && cards().length > 0 && cards().every((c) => doc.canWriteObject(c))
  const labels = () => labelsOn(boardId)
  const q = () => normalizeLabelName(query())
  const shown = createMemo(() => labels().filter((l) => !q() || normalizeLabelName(l.name).includes(q())).map((l) => l.id))
  const exact = () => (query().trim() ? findLabel(boardId, query()) : undefined)
  const canCreate = () => writable() && !!query().trim() && !exact()
  const count = (id: string) => cards().filter((c) => hasLabel(c, id)).length
  const toggle = (id: string) => setLabelOn(boardId, id, cards(), count(id) < cards().length)

  createEffect(() => { if (!cards().length) props.close() })
  // Someone else removed the label mid-rename: drop the edit rather than resurrect it.
  createEffect(() => { const id = renaming(); if (id && !labels().some((l) => l.id === id)) setRenaming(null) })

  const submit = (e: SubmitEvent) => {
    e.preventDefault()
    const match = exact()
    if (match) {
      if (writable()) toggle(match.id)
    } else {
      const problem = labelNameProblem(boardId, query())
      if (problem) return setError(problem)
      createLabel(boardId, query(), newColor(), cards())
    }
    setQuery('')
    setError('')
  }

  const startRename = (id: string) => {
    const label = labels().find((l) => l.id === id)
    if (!label || !writable()) return
    setRecoloring(null)
    setError('')
    setDraft(label.name)
    setRenaming(id)
  }
  const endRename = (save: boolean) => {
    const id = renaming()
    if (!id) return
    if (save) {
      const problem = labelNameProblem(boardId, draft(), id)
      if (problem && draft().trim()) return setError(problem)
      if (!problem) renameLabel(boardId, id, draft())
    }
    setRenaming(null)
    setError('')
    queueMicrotask(() => rows.get(id)?.focus())
  }

  return (
    <Popover anchor={props.anchor} label="Labels" testid="labels-popover" class="labels-panel" align="start" close={props.close}>
      <form class="labels-find" onSubmit={submit}>
        <input
          ref={search}
          class="labels-input"
          data-testid="labels-input"
          data-autofocus
          aria-label="Find or create a label"
          placeholder="Find or create a label"
          autocomplete="off"
          maxLength={MAX_LABEL_NAME}
          value={query()}
          onInput={(e) => { setQuery(e.currentTarget.value); setError('') }}
        />
      </form>
      <Show when={shown().length}>
        <ul class="labels-list" aria-label="Labels on this board">
          <For each={shown()}>
            {(id) => {
              const label = () => labels().find((l) => l.id === id)
              const n = () => count(id)
              const state = () => (n() === 0 ? false : n() === cards().length ? true : 'mixed')
              return (
                <Show when={label()}>
                  {(l) => (
                    <li class="label-row" classList={{ renaming: renaming() === id }} data-testid="label-row" data-label={l().name}>
                      <Show
                        when={renaming() === id}
                        fallback={
                          <>
                            <button
                              ref={(el) => rows.set(id, el)}
                              type="button"
                              class="label-toggle"
                              data-testid="label-toggle"
                              aria-pressed={state()}
                              aria-label={l().name}
                              disabled={!writable()}
                              onClick={() => toggle(id)}
                              onDblClick={() => startRename(id)}
                            >
                              <span class="label-check" aria-hidden="true">
                                <Show when={state() === true}><Icon size={14}>{ToolIcons.check()}</Icon></Show>
                                <Show when={state() === 'mixed'}><Icon size={14}>{ToolIcons.minus()}</Icon></Show>
                              </span>
                              <span class="label-chip" style={labelStyle(l().color)}>{l().name}</span>
                            </button>
                            <Show when={writable()}>
                              <span class="label-actions">
                                <button type="button" class="label-action label-action-color" data-testid="label-recolor" aria-label={`Colour of ${l().name}`} data-tip="Colour" aria-expanded={recoloring() === id} onClick={() => setRecoloring(recoloring() === id ? null : id)}>
                                  <span class="label-swatch" style={labelStyle(l().color)} />
                                </button>
                                <button type="button" class="label-action" data-testid="label-rename" aria-label={`Rename ${l().name}`} data-tip="Rename" onClick={() => startRename(id)}>
                                  <Icon size={16}>{ToolIcons.edit()}</Icon>
                                </button>
                                <button type="button" class="label-action" data-testid="label-remove" aria-label={`Remove ${l().name} from this board`} data-tip="Remove from board" onClick={() => removeLabel(boardId, id)}>
                                  <Icon size={16}>{ToolIcons.trash()}</Icon>
                                </button>
                              </span>
                            </Show>
                          </>
                        }
                      >
                        <input
                          ref={(el) => queueMicrotask(() => { el.focus(); el.select() })}
                          class="labels-input label-rename"
                          data-testid="label-rename-input"
                          data-local-escape
                          aria-label={`Rename ${l().name}`}
                          maxLength={MAX_LABEL_NAME}
                          value={draft()}
                          onInput={(e) => { setDraft(e.currentTarget.value); setError('') }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); endRename(true) }
                            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endRename(false) }
                          }}
                          onBlur={() => endRename(!error())}
                        />
                      </Show>
                      <Show when={recoloring() === id && renaming() !== id}>
                        <ColorDots label={`Colour of ${l().name}`} value={l().color} onPick={(c) => { recolorLabel(boardId, id, c); setRecoloring(null); rows.get(id)?.focus() }} />
                      </Show>
                    </li>
                  )}
                </Show>
              )
            }}
          </For>
        </ul>
      </Show>
      <Show when={canCreate()}>
        <div class="labels-create">
          <button type="button" class="label-toggle label-create" data-testid="label-create" onClick={() => search.form?.requestSubmit()}>
            <span class="label-check label-plus" aria-hidden="true"><Icon size={16}>{ToolIcons.plus()}</Icon></span>
            <span class="label-create-text">Create</span>
            <span class="label-chip" style={labelStyle(newColor())}>{query().trim()}</span>
          </button>
          <ColorDots label="Colour for the new label" value={newColor()} live onPick={setNewColor} />
        </div>
      </Show>
      <Show when={error()}>
        <p class="form-error labels-error" role="alert" data-testid="labels-error">{error()}</p>
      </Show>
    </Popover>
  )
}
