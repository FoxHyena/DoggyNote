import { For, Show, createSignal } from 'solid-js'
import { INK_PALETTE, INK_WIDTHS, SKETCH_PAPERS, normalizeSwatchHex } from '@doggynote/core'
import { IconButton, ToolIcons } from '../ui/icons.tsx'
import { Popover } from '../ui/Popover.tsx'
import { inkColor, inkTool, inkWidth, setInkColor, setInkTool, setInkWidth, type DrawingTool } from '../state/drawing.ts'
import './ink.css'

/** The width dots grow by eye, not to scale: the finest line still needs a visible dot. */
const DOT_SIZES = [4, 8, 14]
const TOOLS: { id: DrawingTool; label: string; icon: keyof typeof ToolIcons }[] = [
  { id: 'pen', label: 'Pen', icon: 'pen' },
  { id: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
]

/**
 * Pen, highlighter and eraser, the ink colours and the line widths, as one row
 * of icons and dots. Shared by the sketch editor and drawing on the board. Ink
 * and paper colours are document data; everything around them is theme.
 */
export function InkTools(props: { onTool?: () => void; paper?: { value: string; onChange: (hex: string) => void } }) {
  const pick = (tool: DrawingTool) => {
    props.onTool?.()
    setInkTool(tool)
  }
  // The eraser has no colour or width: those controls step aside while it's in hand.
  const inking = () => inkTool() !== 'eraser'
  return (
    <div class="ink-tools" role="toolbar" aria-label="Drawing tools">
      <div class="ink-group" role="group" aria-label="Tool">
        <For each={TOOLS}>{(t) => <IconButton testid={`ink-${t.id}`} icon={ToolIcons[t.icon]} label={t.label} pressed={inkTool() === t.id} onClick={() => pick(t.id)} />}</For>
      </div>
      <Show when={inking()}>
        <div class="ink-group ink-colours" role="group" aria-label="Ink colour">
          <For each={INK_PALETTE}>
            {(c) => <button type="button" class="ink-dot" classList={{ on: inkColor() === c.hex }} style={{ '--ink-dot': c.hex }} data-testid="ink-colour" data-hex={c.hex} aria-label={c.name} data-tip={c.name} aria-pressed={inkColor() === c.hex} onClick={() => setInkColor(c.hex)} />}
          </For>
        </div>
        <div class="ink-group" role="group" aria-label="Line width">
          <For each={INK_WIDTHS}>
            {(w, i) => (
              <button type="button" class="bar-btn ink-width" classList={{ on: inkWidth() === w.width }} data-testid={`ink-width-${w.width}`} aria-label={`${w.name} line`} data-tip={`${w.name} line`} aria-pressed={inkWidth() === w.width} onClick={() => setInkWidth(w.width)}>
                <span class="ink-width-dot" style={{ width: `${DOT_SIZES[i()]}px`, height: `${DOT_SIZES[i()]}px` }} />
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.paper}>{(paper) => <PaperPicker value={paper().value} onChange={paper().onChange} />}</Show>
    </div>
  )
}

/** The sketch's paper colour: a button showing it, opening the presets and a custom colour. */
function PaperPicker(props: { value: string; onChange: (hex: string) => void }) {
  let button!: HTMLButtonElement
  const [open, setOpen] = createSignal(false)
  const custom = () => !SKETCH_PAPERS.some((p) => p.hex === props.value)
  return (
    <div class="ink-group">
      <button ref={button} type="button" class="bar-btn ink-paper-button" data-testid="sketch-paper-button" aria-label="Paper colour" data-tip="Paper colour" aria-haspopup="dialog" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <span class="ink-paper-swatch" style={{ '--ink-dot': props.value }} />
      </button>
      <Show when={open()}>
        <Popover anchor={() => button} label="Paper colour" testid="sketch-paper-panel" class="ink-paper-panel" close={() => setOpen(false)}>
          <div class="ink-paper-dots" role="group" aria-label="Paper colours">
            <For each={SKETCH_PAPERS}>
              {(p) => <button type="button" class="ink-dot" classList={{ on: props.value === p.hex }} style={{ '--ink-dot': p.hex }} data-testid="sketch-paper" data-hex={p.hex} aria-label={`${p.name} paper`} data-tip={p.name} aria-pressed={props.value === p.hex} onClick={() => props.onChange(p.hex)} />}
            </For>
            <label class="ink-dot ink-paper-custom" classList={{ on: custom() }} data-tip="Custom colour" style={{ '--ink-dot': custom() ? props.value : 'transparent' }}>
              <input type="color" data-testid="sketch-paper-custom" aria-label="Custom paper colour" value={props.value.toLowerCase()} onInput={(e) => { const hex = normalizeSwatchHex(e.currentTarget.value); if (hex) props.onChange(hex) }} />
            </label>
          </div>
        </Popover>
      </Show>
    </div>
  )
}
