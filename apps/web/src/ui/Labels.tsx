import { For, Show, createEffect, createSignal } from 'solid-js'
import { MAX_LABEL_NAME, type Card } from '@doggynote/core'
import { CARD_COLORS, type CardColor } from '@doggynote/theme'
import * as doc from '../state/doc.ts'
import { applyLabel, createLabel, labelNameError, labelsFor, labelsOn, labelUsage, recolorLabel, removeLabel, renameLabel } from '../state/labels.ts'
import { canReadBoard } from '../state/access.ts'
import { boardId } from '../state/ui.ts'
import { Popover } from './Popover.tsx'
import { Icon, IconButton, ToolIcons } from './icons.tsx'
import './labels.css'

/** Content, included in PNG exports. No editing controls live on the card. */
export function CardLabels(props: { card: Card }) {
  return <Show when={labelsFor(props.card).length}><div class="card-labels" aria-label="Labels"><For each={labelsFor(props.card)}>{(label) => <span class="label-chip" title={label.name} style={{ background: `var(--dn-card-${label.color}-bg)`, color: `var(--dn-card-${label.color}-text)` }}>{label.name}</span>}</For></div></Show>
}

export function LabelsButton(props: { cards: Card[] }) {
  const [open, setOpen] = createSignal(false)
  let trigger!: HTMLButtonElement
  return <><IconButton ref={(el) => (trigger = el)} testid="labels-button" icon={ToolIcons.label} label="Labels" popup expanded={open()} disabled={!props.cards.length} onClick={() => setOpen(!open())} /><Show when={open()}><LabelsMenu cards={props.cards} anchor={trigger} close={() => setOpen(false)} /></Show></>
}

const colorName = (c: CardColor) => c === 'none' ? 'Neutral' : c[0]!.toUpperCase() + c.slice(1)
const chipStyle = (c: CardColor) => ({ background: `var(--dn-card-${c}-bg)`, color: `var(--dn-card-${c}-text)` })

function ColorDots(props: { label: string; value: CardColor; disabled?: boolean; onPick: (c: CardColor) => void }) {
  return <div class="label-dots" role="group" aria-label={props.label}><For each={CARD_COLORS}>{(c) => <button type="button" class="label-dot" style={{ background: `var(--dn-card-${c}-bg)` }} aria-label={colorName(c)} data-tip={colorName(c)} aria-pressed={props.value === c} disabled={props.disabled} onClick={() => props.onPick(c)} />}</For></div>
}

/**
 * Type to find a label, click to apply it, or press Enter to create a new one.
 * Colour, rename and remove sit on each row; nothing needs a full dialog.
 */
function LabelsMenu(props: { cards: Card[]; anchor: HTMLElement; close: () => void }) {
  const currentBoard = boardId()
  const [name, setName] = createSignal('')
  const [color, setColor] = createSignal<CardColor>('sky')
  const [editing, setEditing] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [recolor, setRecolor] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  let input!: HTMLInputElement
  const writable = () => doc.canWriteObject(doc.getBoard(currentBoard)) && props.cards.every((card) => doc.canWriteObject(doc.getCard(card.id)))
  const cards = () => props.cards.map((c) => doc.getCard(c.id)).filter((c): c is Card => !!c && c.boardId === currentBoard && !c.deletedAt && !c.purged)
  const labels = () => labelsOn(currentBoard)
  const query = () => name().trim().toLowerCase()
  const shown = () => labels().filter((l) => !query() || l.name.toLowerCase().includes(query()))
  const exact = () => labels().find((l) => l.name.trim().toLowerCase() === query())
  createEffect(() => { if (!doc.isReadOnly() && !canReadBoard(currentBoard)) props.close() })
  // A remote removal must not let Save resurrect a stale definition.
  createEffect(() => { if (editing() && !labels().some((label) => label.id === editing())) { setEditing(null); setError('This label was removed in another session.') } })
  const reset = () => { setName(''); setError('') }
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const match = exact()
    if (match) {
      const all = !!cards().length && cards().every((c) => c[`label${match.id}`] === true)
      applyLabel(currentBoard, match, cards(), !all)
      reset(); input.focus(); return
    }
    const problem = labelNameError(currentBoard, name())
    if (problem) { setError(problem); return }
    createLabel(currentBoard, name(), color(), cards())
    reset(); input.focus()
  }
  // Renaming happens in the label's own row: type, then Enter or the check.
  const startRename = (id: string, current: string) => { setRecolor(null); setEditing(id); setDraft(current); setError('') }
  const stopRename = () => { setEditing(null); setError('') }
  const saveRename = (event: SubmitEvent) => {
    event.preventDefault()
    const problem = labelNameError(currentBoard, draft(), editing()!)
    if (problem) { setError(problem); return }
    renameLabel(currentBoard, editing()!, draft())
    stopRename(); input.focus()
  }
  return <Popover anchor={props.anchor} label="Labels" testid="labels-dialog" class="labels-menu" close={props.close}>
    <form class="label-form" onSubmit={submit}>
      <input ref={input} aria-label="Label name" maxlength={MAX_LABEL_NAME} disabled={!writable()} value={name()} placeholder="Find or create a label" onInput={(e) => { setName(e.currentTarget.value); setError('') }} />
      <button type="button" class="bar-btn bar-icon" aria-label="Close labels" data-tip="Close" onClick={props.close}><Icon size={16}>{ToolIcons.close()}</Icon></button>
    </form>
    <Show when={!writable()}><p class="labels-hint">View only</p></Show>
    <div class="labels-list"><For each={shown().map((label) => label.id)} fallback={<Show when={!query()}><p class="labels-hint">No labels on this board yet. Type a name to create one.</p></Show>}>{(id) => {
      const initial = labels().find((item) => item.id === id)!
      const label = () => labels().find((item) => item.id === id) ?? initial
      const applied = () => cards().filter((c) => c[`label${label().id}`] === true).length
      const checked = () => !!cards().length && applied() === cards().length
      return <div class="label-row">
        <Show when={editing() === id} fallback={<>
        <label class="label-apply"><input type="checkbox" aria-label={`Apply ${label().name}`} disabled={!writable() || !cards().length} checked={checked()} ref={(el) => createEffect(() => { el.indeterminate = applied() > 0 && !checked() })} onChange={() => applyLabel(currentBoard, label(), cards(), !checked())} /><span class="label-chip" style={chipStyle(label().color)} title={label().name}>{label().name}</span><span class="label-count" data-tip="Uses on this board">{labelUsage(currentBoard, label().id)}</span></label>
        <button type="button" class="label-dot label-color" style={{ background: `var(--dn-card-${label().color}-bg)` }} aria-label={`Colour for ${label().name}`} data-tip="Colour" aria-expanded={recolor() === id} disabled={!writable()} onClick={() => { stopRename(); setRecolor(recolor() === id ? null : id) }} />
        <button type="button" class="bar-btn bar-icon" disabled={!writable()} aria-label={`Rename ${label().name}`} data-tip="Rename" onClick={() => startRename(id, label().name)}><Icon size={16}>{ToolIcons.edit()}</Icon></button>
        <button type="button" class="bar-btn bar-icon" disabled={!writable()} aria-label={`Remove ${label().name} from board`} data-tip="Remove from this board (Undo restores it)" onClick={() => removeLabel(currentBoard, label().id)}><Icon size={16}>{ToolIcons.trash()}</Icon></button>
        </>}>
          <form class="label-rename" onSubmit={saveRename}>
            <input data-local-escape ref={(el) => queueMicrotask(() => { el.focus(); el.select() })} aria-label={`New name for ${label().name}`} maxlength={MAX_LABEL_NAME} value={draft()} onInput={(e) => { setDraft(e.currentTarget.value); setError('') }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopRename() } }} />
            <button type="submit" class="bar-btn bar-icon" aria-label="Save name" data-tip="Save (Enter)" disabled={!draft().trim()}><Icon size={16}>{ToolIcons.check()}</Icon></button>
            <button type="button" class="bar-btn bar-icon" aria-label="Cancel rename" data-tip="Cancel (Escape)" onClick={stopRename}><Icon size={16}>{ToolIcons.close()}</Icon></button>
          </form>
        </Show>
        <Show when={recolor() === id}><ColorDots label={`Colours for ${label().name}`} value={label().color} disabled={!writable()} onPick={(c) => { recolorLabel(currentBoard, label().id, c); setRecolor(null) }} /></Show>
      </div>
    }}</For></div>
    <Show when={query() && !exact() && writable()}>
      <div class="label-create">
        <button type="button" class="popover-item" aria-label="Create" onClick={() => input.form?.requestSubmit()}><span class="label-chip" style={chipStyle(color())}>{name().trim()}</span><span>Create and apply</span></button>
        <ColorDots label="New label colour" value={color()} onPick={setColor} />
      </div>
    </Show>
    <Show when={error()}><p class="form-error" role="alert">{error()}</p></Show>
    <div class="label-history"><button class="bar-btn bar-icon" aria-label="Undo label change" data-tip="Undo" disabled={!writable() || !doc.canUndo()} onClick={() => doc.undo()}><Icon size={16}>{ToolIcons.undo()}</Icon></button><button class="bar-btn bar-icon" aria-label="Redo label change" data-tip="Redo" disabled={!writable() || !doc.canRedo()} onClick={() => doc.redo()}><Icon size={16}>{ToolIcons.redo()}</Icon></button><Show when={cards().length > 1}><span class="labels-hint">{cards().length} items</span></Show></div>
  </Popover>
}
