import { For, Show } from 'solid-js'
import { COPY, boardDisplayTitle } from '@doggynote/theme'
import { Popover } from './Popover.tsx'
import { BoardIconSvg, Icon } from './icons.tsx'
import { centrePlacement } from './Toolbar.tsx'
import { boardFromTemplate, removeTemplate, templates } from '../state/copies.ts'
import { boardId } from '../state/ui.ts'
import './templates.css'

/**
 * Pick a template for a new board: one row each, the name to use it and an ×
 * to remove it. A small popover under the board "…" button, not a dialog.
 */
const saved = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export function TemplatePicker(props: { anchor: () => HTMLElement; boardId: string; close: () => void }) {
  const use = (id: string) => {
    props.close()
    const place = centrePlacement('board')
    boardFromTemplate(id, boardId(), 'at' in place ? place.at : undefined)
  }
  return (
    <Popover anchor={props.anchor} label={COPY.templates} testid="templates-popover" class="templates-popover" close={props.close}>
      <p class="templates-title">{COPY.templates}</p>
      <Show when={templates().length} fallback={<p class="templates-empty" data-testid="templates-empty">{COPY.templatesEmpty}</p>}>
        <ul class="templates-list">
          <For each={templates()}>
            {(t) => {
              const name = () => boardDisplayTitle(t, 'Untitled board')
              return (
                <li class="template-row" data-testid="template-row" data-name={name()}>
                  <button class="template-use" data-testid="template-use" onClick={() => use(t.id)}>
                    <BoardIconSvg icon={t.icon} size={18} />
                    <span class="template-name">{name()}</span>
                    <span class="template-date">{saved(t.createdAt)}</span>
                  </button>
                  <button class="icon-btn template-remove" data-testid="template-remove" aria-label={`Remove template ${name()}`} data-tip="Remove template" onClick={() => removeTemplate(t.id)}>
                    <Icon size={16} name="close" />
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </Popover>
  )
}
