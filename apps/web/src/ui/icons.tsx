import type { BoardIcon } from '@doggynote/core'
import { ICONS, type IconName } from './iconAssets.ts'
export type { IconName } from './iconAssets.ts'

// Stored IDs and picker order are document/agent contracts, independent of artwork.
const BOARD_ICON_NAMES = {
  paw: 'paw', bone: 'bone', ball: 'ball', collar: 'collar',
  kennel: 'kennel', bowl: 'bowl', star: 'star', heart: 'heart',
} as const satisfies Record<BoardIcon, IconName>
export const BOARD_ICONS = Object.keys(BOARD_ICON_NAMES) as BoardIcon[]

/** Phosphor's native geometry, shared by every decorative interface icon. */
export function Icon(props: { name: IconName; size?: number; class?: string }) {
  return <svg class={`dn-icon${props.class ? ` ${props.class}` : ''}`} data-icon={props.name}
    viewBox="0 0 256 256" width={props.size ?? 20} height={props.size ?? 20}
    fill="currentColor" aria-hidden="true" innerHTML={ICONS[props.name]} />
}

export function BoardIconSvg(props: { icon: BoardIcon; size?: number; filled?: boolean }) {
  const name = (): IconName => Object.hasOwn(BOARD_ICON_NAMES, props.icon)
    ? props.icon === 'star' && props.filled ? 'starFilled' : BOARD_ICON_NAMES[props.icon]
    : 'paw'
  return <Icon name={name()} size={props.size} />
}

/** Phosphor Dog within the former illustration's layout footprint. */
export function DogMark(props: { size?: number }) {
  const height = () => (props.size ?? 88) * 64 / 88
  return <span class="dog-mark" style={{ width: `${props.size ?? 88}px`, height: `${height()}px` }} aria-hidden="true"><Icon name="dog" size={height()} /></span>
}

/** A compact selection-bar action: icon only, named by its tooltip and accessible label. */
export function IconButton(props: { testid: string; icon: IconName; label: string; title?: string; pressed?: boolean; disabled?: boolean; onClick: (e: MouseEvent & { currentTarget: HTMLButtonElement }) => void; ref?: (el: HTMLButtonElement) => void; popup?: boolean; expanded?: boolean }) {
  return (
    <button ref={props.ref} class="bar-btn bar-icon" data-testid={props.testid} aria-label={props.label} data-tip={props.title ?? props.label} aria-pressed={props.pressed} aria-haspopup={props.popup ? 'dialog' : undefined} aria-expanded={props.popup ? !!props.expanded : undefined} disabled={props.disabled} onClick={(e) => props.onClick(e)}>
      <Icon size={18} name={props.icon} />
    </button>
  )
}
