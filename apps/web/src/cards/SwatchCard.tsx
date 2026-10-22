import { Show, createSignal } from 'solid-js'
import { SWATCH_PRESETS, normalizeSwatchHex, swatchHex, swatchName, type Card } from '@doggynote/core'
import { COPY } from '@doggynote/theme'
import type { CardProps } from '../canvas/CardView.tsx'
import { Popover } from '../ui/Popover.tsx'
import { ColorDots } from '../ui/ColorDots.tsx'
import { camera, endEdit } from '../state/ui.ts'
import { exporting } from '../state/export.ts'
import * as doc from '../state/doc.ts'
import './swatch.css'

/** A colour card: the colour, its name and its HEX. The colour is document data, not a theme colour. */
export function SwatchCard(props: CardProps<'swatch'>) {
  const hex = () => swatchHex(props.card)
  const name = () => swatchName(props.card)
  let root!: HTMLDivElement
  return (
    <div class="swatch-card" ref={root}>
      <div class="swatch-paint" data-testid="colour-paint" role="img" aria-label={`Colour ${hex()}`} style={{ background: hex() }} />
      <div class="swatch-meta">
        <Show when={name()}>
          <p class="swatch-name" data-testid="colour-name">{name()}</p>
        </Show>
        <code class="swatch-hex" data-testid="colour-hex">{hex()}</code>
      </div>
      <Show when={props.editing && !props.readOnly && !props.lod && !exporting()}>
        <SwatchPanel card={props.card} anchor={() => root.closest<HTMLElement>('.card') ?? root} />
      </Show>
    </div>
  )
}

/** Arrow keys walk the seven-wide grid of dots (Safari's Tab skips buttons by default). */
function moveAmongDots(e: KeyboardEvent & { currentTarget: HTMLElement }) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
  if (!step) return
  const dots = [...e.currentTarget.querySelectorAll<HTMLElement>('button.color-dot, .color-custom input')]
  const at = dots.findIndex((d) => d === document.activeElement)
  const next = dots[at + step]
  if (at < 0 || !next) return
  e.preventDefault()
  next.focus()
}


/**
 * Edits the colour right beside the card: preset dots, the system colour
 * picker, HEX and name. Everything applies as you go through the card's edit
 * session (state/ui.ts), so leaving is one undo step and peers see it live.
 */
function SwatchPanel(props: { card: Card<'swatch'>; anchor: () => HTMLElement }) {
  const hex = () => swatchHex(props.card)
  const set = (fields: Partial<Card<'swatch'>['content']>) =>
    doc.transient(props.card.id, { content: { ...props.card.content, hex: hex(), ...fields } } as Partial<Card>)
  // What's typed in the HEX field; it only becomes the colour once it's a real HEX.
  const [draft, setDraft] = createSignal<string | null>(null)
  const custom = () => !SWATCH_PRESETS.includes(hex() as (typeof SWATCH_PRESETS)[number])
  const done = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    endEdit()
  }
  return (
    <Popover
      anchor={props.anchor}
      label="Edit colour"
      testid="colour-panel"
      class="swatch-panel"
      align="start"
      close={endEdit}
      follow={() => (camera(), props.card.x, props.card.y, props.card.w, props.card.h)}
    >
      {/* Seven columns: thirteen presets, then the custom picker in the last slot. */}
      <ColorDots
        class="swatch-presets"
        label="Colours"
        onKeyDown={moveAmongDots}
        dots={SWATCH_PRESETS.map((p) => ({ value: p, name: p, paint: p, data: { 'data-hex': p } }))}
        value={hex()}
        autofocus
        onPick={(p) => {
          setDraft(null)
          set({ hex: p })
        }}
        dotTestId="colour-preset"
        custom={{ value: custom() ? hex() : null, fallback: hex(), testid: 'colour-picker', autofocus: custom(), onPick: (v) => { setDraft(null); set({ hex: v }) } }}
      />
      <div class="swatch-fields">
        <input
          class="swatch-input swatch-hex-input"
          data-testid="colour-hex-input"
          aria-label="HEX"
          spellcheck={false}
          autocomplete="off"
          maxLength={9}
          aria-invalid={draft() !== null && !normalizeSwatchHex(draft())}
          value={draft() ?? hex()}
          onInput={(e) => {
            const raw = e.currentTarget.value
            setDraft(raw)
            const v = normalizeSwatchHex(raw)
            if (v && v !== hex()) set({ hex: v })
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={done}
        />
        <input
          class="swatch-input swatch-name-input"
          data-testid="colour-name-input"
          aria-label="Name"
          maxLength={1000}
          placeholder={COPY.swatchNamePlaceholder}
          value={swatchName(props.card)}
          onInput={(e) => set({ name: e.currentTarget.value })}
          onKeyDown={done}
        />
      </div>
    </Popover>
  )
}
