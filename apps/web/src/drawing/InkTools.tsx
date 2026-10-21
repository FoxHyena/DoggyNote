import { For, Show } from 'solid-js'
import { cardColors } from '@doggynote/theme'
import { INK_PALETTE, INK_WIDTHS, SKETCH_PAPERS, sketchPaperColor, type InkTool, type SketchBackground } from '@doggynote/core'
import { IconButton, ToolIcons } from '../ui/icons.tsx'
import './ink.css'

export type DrawingTool = InkTool | 'eraser'
export type InkToolsProps = {
  tool: DrawingTool; setTool: (tool: DrawingTool) => void
  color: string; setColor: (color: string) => void
  width: number; setWidth: (width: number) => void
  /** Board drawing mode finishes from the toolbar; the sketch editor has Done in its header. */
  onDone?: () => void
  /** Sketches only: the paper colour, from presets or a custom pick. */
  paper?: { value: SketchBackground; onChange: (background: SketchBackground) => void }
}
const names = ['Red', 'Blue', 'Green', 'Yellow', 'Charcoal', 'White']
const WIDTH_NAMES = ['Fine', 'Medium', 'Bold']
const TOOLS = [
  { id: 'pen', label: 'Pen', icon: ToolIcons.draw },
  { id: 'highlighter', label: 'Highlighter', icon: ToolIcons.highlighter },
  { id: 'eraser', label: 'Eraser', icon: ToolIcons.eraser },
] as const
/** Tool settings are document ink, while the surrounding controls use theme tokens. */
export function InkTools(props: InkToolsProps) {
  return <div class="ink-tools" role="toolbar" aria-label="Drawing tools">
    <div class="ink-tool-group" role="group" aria-label="Tool"><For each={TOOLS}>{(t) => <IconButton testid={`ink-${t.id}`} icon={t.icon} label={t.label} pressed={props.tool === t.id} onClick={() => props.setTool(t.id)} />}</For></div>
    <div class="ink-tool-group" role="group" aria-label="Ink colour"><For each={INK_PALETTE}>{(c, i) => <button class="ink-swatch" style={{ '--ink-color': c }} aria-label={names[i()]} data-tip={names[i()]} aria-pressed={props.color === c} onClick={() => props.setColor(c)} />}</For></div>
    <div class="ink-tool-group ink-width" role="group" aria-label="Stroke width"><For each={INK_WIDTHS}>{(w, i) => <button class="bar-btn ink-width-choice" aria-label={WIDTH_NAMES[i()]} data-tip={WIDTH_NAMES[i()]} aria-pressed={props.width === w} onClick={() => props.setWidth(w)}><span class="ink-width-dot" style={{ width: `${w + 2}px`, height: `${w + 2}px` }} /></button>}</For></div>
    <Show when={props.paper}>{(paper) => <div class="ink-tool-group" role="group" aria-label="Paper colour">
      <For each={SKETCH_PAPERS}>{(p) => <button class="ink-swatch ink-paper-swatch" classList={{ 'ink-paper-none': p.value === 'transparent' }} style={{ '--ink-color': sketchPaperColor(p.value, cardColors.light.none.bg) ?? 'transparent' }} aria-label={`${p.name} paper`} data-tip={`${p.name} paper`} aria-pressed={paper().value === p.value} onClick={() => paper().onChange(p.value)} />}</For>
      <label class="ink-swatch ink-custom-paper" data-tip="Custom paper colour" aria-pressed={!SKETCH_PAPERS.some((p) => p.value === paper().value)}><input type="color" aria-label="Custom paper colour" value={paper().value.startsWith('#') ? paper().value : '#ffffff'} onInput={(e) => paper().onChange(e.currentTarget.value.toUpperCase() as SketchBackground)} /></label>
    </div>}</Show>
    <Show when={props.onDone}><IconButton testid="ink-tools-done" icon={ToolIcons.check} label="Done" title="Done drawing (Escape)" onClick={() => props.onDone!()} /></Show>
  </div>
}
