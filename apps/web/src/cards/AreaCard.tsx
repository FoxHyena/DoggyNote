import { For, Show, onMount } from 'solid-js'
import { AREA_HEADER, areaMembers, type CardType } from '@doggynote/core'
import * as doc from '../state/doc.ts'
import { endEdit } from '../state/ui.ts'
import { areaDropTarget, areaAddPoint, setAddingToArea, tidyArea, removeArea, buryArea } from '../state/areas.ts'
import { columnCollapsed, setColumnCollapsed } from '../state/columns.ts'
import { createCard } from '../state/actions.ts'
import { isPositionLocked } from '../state/position.ts'
import { addAnyFiles } from '../canvas/paste.ts'
import { beginBoardDrawing } from '../state/drawing.ts'
import { openStickers } from '../state/stickers.ts'
import { BarMenu } from '../ui/BarMenu.tsx'
import { Icon, type IconName } from '../ui/icons.tsx'
import type { CardProps } from '../canvas/CardView.tsx'
import './area.css'

const choices: { type: CardType; title: string; icon: IconName }[] = [
  { type: 'column', title: 'Column', icon: 'column' }, { type: 'note', title: 'Note', icon: 'note' },
  { type: 'todo', title: 'To-do', icon: 'todo' }, { type: 'board', title: 'Board', icon: 'board' },
  { type: 'link', title: 'Link', icon: 'link' }, { type: 'movie', title: 'Movie', icon: 'film' },
  { type: 'swatch', title: 'Colour', icon: 'swatch' }, { type: 'sketch', title: 'Sketch', icon: 'sketch' },
]
export function AreaCard(props: CardProps<'area'>) {
  let file!: HTMLInputElement
  const title = () => typeof props.card.content?.title === 'string' ? props.card.content.title : ''
  const collapsed = () => columnCollapsed(props.card)
  const add = (type: CardType) => {
    setAddingToArea(props.card.id)
    setColumnCollapsed(props.card.id, false)
    const at = areaAddPoint(type)!
    createCard(type, { at, areaId: props.card.id })
    setAddingToArea(null)
  }
  return <div class="area" classList={{ 'area-drop-active': areaDropTarget() === props.card.id }} style={{ '--area-header': `${AREA_HEADER}px` }}>
    <div class="area-edge area-edge-bottom" data-area-edge /><div class="area-edge area-edge-left" data-area-edge /><div class="area-edge area-edge-right" data-area-edge />
    <header class="area-head" data-area-header>
      <span class="area-grip" aria-hidden="true"><Icon name="grip" size={18} /></span>
      <button class="column-toggle" data-nodrag aria-label={collapsed() ? 'Expand area' : 'Collapse area'} aria-expanded={!collapsed()} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setColumnCollapsed(props.card.id, !collapsed(), props.readOnly) }}><Icon name={collapsed() ? 'open' : 'chevronDown'} size={16} /></button>
      <span class="area-title" data-edit-title><Show when={props.editing} fallback={<strong data-testid="area-title">{title() || 'Area'}</strong>}><input ref={el => onMount(() => el.focus())} class="column-title-input" aria-label="Area name" data-testid="area-title-input" value={title()} placeholder="Area" onInput={e => doc.transient(props.card.id, { content: { title: e.currentTarget.value } })} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); endEdit() } }} /></Show></span>
      <Show when={!props.readOnly && !props.lod}>
        <div class="area-actions" data-nodrag onPointerDown={e => e.stopPropagation()}>
          <button class="bar-btn" data-testid="area-tidy" disabled={isPositionLocked(props.card.id)} onClick={() => tidyArea(props.card.id)}><Icon name="tidy" size={16} />Tidy</button>
          <BarMenu label="Add to area" title="Add to area" testId="area-add" menuTestId="area-add-menu" icon={<Icon name="plus" size={16} />}>
            {close => <><For each={choices}>{choice => <button class="menu-item" role="menuitem" disabled={isPositionLocked(props.card.id)} onClick={() => { close(); add(choice.type) }}><Icon name={choice.icon} size={18} />{choice.title}</button>}</For>
              <button class="menu-item" role="menuitem" disabled={isPositionLocked(props.card.id)} onClick={() => { close(); file.click() }}><Icon name="upload" size={18} />Image or file</button>
              <button class="menu-item" role="menuitem" disabled={isPositionLocked(props.card.id)} onClick={() => { close(); setAddingToArea(props.card.id); openStickers() }}><Icon name="sticker" size={18} />Stickers</button>
              <button class="menu-item" role="menuitem" disabled={isPositionLocked(props.card.id)} onClick={() => { close(); setAddingToArea(props.card.id); beginBoardDrawing() }}><Icon name="draw" size={18} />Draw</button>
            </>}
          </BarMenu>
          <BarMenu label="" title="Area actions" testId="area-more" menuTestId="area-more-menu" icon={<Icon name="more" size={18} />}>
            {close => <><button class="menu-item" role="menuitem" disabled={isPositionLocked(props.card.id)} onClick={() => { close(); tidyArea(props.card.id) }}><Icon name="tidy" />Tidy area</button><button class="menu-item" role="menuitem" disabled={isPositionLocked(props.card.id)} onClick={() => { close(); removeArea(props.card.id) }}><Icon name="multi" />Remove area, keep contents</button><button class="menu-item" role="menuitem" disabled={isPositionLocked(props.card.id)} onClick={() => { close(); buryArea(props.card.id) }}><Icon name="bury" />Bury area and contents</button></>}
          </BarMenu>
          <input ref={file} class="area-file-input" type="file" multiple aria-label="Add images or files to area" onChange={e => { setAddingToArea(props.card.id); setColumnCollapsed(props.card.id, false); const at = areaAddPoint()!; addAnyFiles([...e.currentTarget.files ?? []], at, undefined, props.card.id); setAddingToArea(null); e.currentTarget.value = '' }} />
        </div>
      </Show>
    </header>
    <Show when={!collapsed() && !props.lod && !areaMembers(props.card, [...doc.cardsOn(props.card.boardId), ...doc.stickersOn(props.card.boardId)]).length}><div class="area-empty-hint" aria-hidden="true">Drop columns, notes, and other items here</div></Show>
  </div>
}
