import { COPY } from '@doggynote/theme'
import { isFavourite, setFavourite } from '../state/boardPrefs.ts'
import { Icon } from './icons.tsx'

/** A star that adds a board to Favourites, or takes it out again. */
export function FavouriteButton(props: { boardId: string; class?: string; size?: number; onChange?: () => void }) {
  const on = () => isFavourite(props.boardId)
  const label = () => on() ? COPY.boards.unfavourite : COPY.boards.favourite
  return <button class={`icon-btn favourite-btn ${props.class ?? ''}`} data-testid="favourite-board" aria-pressed={on()} aria-label={label()} data-tooltip={label()} onClick={(e) => { e.stopPropagation(); setFavourite(props.boardId, !on()); props.onChange?.() }}><Icon size={props.size ?? 16} name={on() ? 'starFilled' : 'star'} /></button>
}
