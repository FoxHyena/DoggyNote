import { For, Show, createSignal } from 'solid-js'
import { exportPng, type ExportOptions } from '../state/export.ts'
import { selection } from '../state/ui.ts'
import { Icon, ToolIcons } from './icons.tsx'

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
export function ExportButton() {
  const [open, setOpen] = createSignal(false)
  const [scope, setScope] = createSignal<ExportOptions['scope']>('board')
  const [scale, setScale] = createSignal<ExportOptions['scale']>(2)
  const [background, setBackground] = createSignal<ExportOptions['background']>('theme')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const toggle = () => {
    setError(null)
    // Default to the selection when there is one.
    setScope(selection().size ? 'selection' : 'board')
    setOpen(!open())
  }

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await exportPng({ scope: scope(), scale: scale(), background: background() })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="zoom">
      <button class="icon-btn" data-testid="export" title="Export as PNG" onClick={toggle}>
        <Icon>{ToolIcons.download()}</Icon>
        <span class="icon-btn-label">Export</span>
      </button>
      <Show when={open()}>
        <div class="menu share-panel export-panel" data-testid="export-panel" onPointerDown={(e) => e.stopPropagation()}>
          <div class="share-head">
            <strong>Export as PNG</strong>
            <button class="icon-btn" title="Close" onClick={() => setOpen(false)}>
              <Icon size={16}>{ToolIcons.close()}</Icon>
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
          <Show when={error()}>
            <p class="share-error" data-testid="export-error">
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
