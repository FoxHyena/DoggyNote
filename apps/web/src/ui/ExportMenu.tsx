import { SheetGrip } from './SheetGrip.tsx'
import { For, Show, createSignal, onCleanup, onMount, type Accessor, type JSX } from 'solid-js'
import { exportPng, type ExportOptions } from '../state/export.ts'
import { selection } from '../state/ui.ts'
import { Icon } from './icons.tsx'
import { agentDialogKeys } from './agentDialog.ts'
import './export.css'

type Choice<K extends keyof ExportOptions> = { value: ExportOptions[K]; label: string }

function Segmented<K extends keyof ExportOptions>(props: { name: K; label: string; options: Choice<K>[]; value: ExportOptions[K]; onChange: (v: ExportOptions[K]) => void; disabled?: (v: ExportOptions[K]) => boolean }) {
  return (
    <div class="export-row">
      <span class="export-label">{props.label}</span>
      <div class="segmented" role="radiogroup" aria-label={props.label}>
        <For each={props.options}>
          {(o) => (
            <button
              role="radio"
              aria-checked={props.value === o.value}
              classList={{ on: props.value === o.value }}
              data-testid={`export-${props.name}-${o.value}`}
              disabled={props.disabled?.(o.value)}
              onClick={() => props.onChange(o.value)}
            >
              {o.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

/** Top-bar "Export": the board or the selection as a PNG. */
export type ExportTrigger = { open: (returnFocus?: HTMLElement) => void; close: (restoreFocus?: boolean) => void; isOpen: Accessor<boolean> }
export function ExportButton(props: { renderTrigger?: (controls: ExportTrigger) => JSX.Element } = {}) {
  const [open, setOpen] = createSignal(false)
  const [scope, setScope] = createSignal<ExportOptions['scope']>('board')
  const [scale, setScale] = createSignal<ExportOptions['scale']>(2)
  const [background, setBackground] = createSignal<ExportOptions['background']>('theme')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let root!: HTMLDivElement
  let panel: HTMLDivElement | undefined
  let returnFocus: HTMLElement | undefined
  const placePanel = () => {
    if (!open() || !panel?.isConnected) return
    const anchor = root.getBoundingClientRect(), width = panel.getBoundingClientRect().width
    const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))
    panel.style.right = 'auto'; panel.style.left = `${left - anchor.left}px`
  }

  const close = (restoreFocus = true) => { setOpen(false); if (restoreFocus) queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus() }) }
  const show = (target?: HTMLElement) => {
    returnFocus = target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
    setError(null)
    // Default to the selection when there is one.
    setScope(selection().size ? 'selection' : 'board')
    setOpen(true)
  }
  onMount(() => {
    const escape = (event: KeyboardEvent) => {
      if (!open() || event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close()
    }
    const outside = (event: PointerEvent) => { if (open() && !root.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('keydown', escape, true)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('resize', placePanel)
    const observer = new ResizeObserver(placePanel)
    observer.observe(root)
    onCleanup(() => { observer.disconnect(); window.removeEventListener('keydown', escape, true); window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', placePanel) })
  })

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await exportPng({ scope: scope(), scale: scale(), background: background() })
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="zoom" ref={root}>
      {props.renderTrigger ? props.renderTrigger({ open: show, close, isOpen: open }) : <button class="icon-btn" data-testid="export" title="Export as PNG" aria-haspopup="dialog" aria-expanded={open()} onClick={(e) => open() ? close() : show(e.currentTarget)}>
        <Icon name="download" />
        <span class="icon-btn-label">Export</span>
      </button>}
      <Show when={open()}>
        <div class="menu export-panel" data-testid="export-panel" role="dialog" aria-label="Export as PNG" onKeyDown={agentDialogKeys} onPointerDown={(e) => e.stopPropagation()} ref={(el) => { panel = el; queueMicrotask(() => { placePanel(); el.querySelector<HTMLButtonElement>('button')?.focus() }) }}><SheetGrip onDismiss={() => close()} />
          <div class="export-head">
            <strong>Export as PNG</strong>
            <button class="icon-btn" title="Close" onClick={() => close()}>
              <Icon size={16} name="close" />
            </button>
          </div>
          <Segmented
            name="scope"
            label="What"
            value={scope()}
            onChange={setScope}
            disabled={(v) => v === 'selection' && !selection().size}
            options={[
              { value: 'board', label: 'Whole board' },
              { value: 'selection', label: 'Selection' },
            ]}
          />
          <Segmented
            name="scale"
            label="Size"
            value={scale()}
            onChange={setScale}
            options={[
              { value: 1, label: '1×' },
              { value: 2, label: '2× (sharp)' },
            ]}
          />
          <Segmented
            name="background"
            label="Background"
            value={background()}
            onChange={setBackground}
            options={[
              { value: 'theme', label: 'Canvas' },
              { value: 'transparent', label: 'Transparent' },
            ]}
          />
          <p class="export-label">Columns export as currently shown. Areas do too. Expand them first to include hidden contents.</p>
          <Show when={error()}>
            <p class="export-error" data-testid="export-error">
              {error()}
            </p>
          </Show>
          <button class="primary-btn" data-testid="export-go" disabled={busy()} onClick={() => void go()}>
            {busy() ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </Show>
    </div>
  )
}
