import type { JSX } from 'solid-js'
import type { BoardIcon } from '@doggynote/core'

// Hand-drawn-ish 24px line icons. Colour comes from `currentColor`.

// Thunks, not elements: a Solid JSX node can only live in one place in the DOM.
const BOARD_ICON_PATHS: Record<BoardIcon, () => JSX.Element> = {
  paw: () => (
    <>
      <g fill="currentColor" stroke="none">
        <path d="M12 11.2c-2.1 0-3.1 2.8-4.6 4.4-1.3 1.4-1.1 3.5.5 4.1 1.5.6 2.7-.5 4.1-.5s2.7 1.1 4.1.5c1.6-.6 1.8-2.7.5-4.1-1.5-1.6-2.5-4.4-4.6-4.4Z" />
        <ellipse cx="5.6" cy="10.2" rx="1.85" ry="2.5" transform="rotate(-30 5.6 10.2)" />
        <ellipse cx="9.6" cy="6.7" rx="1.85" ry="2.5" transform="rotate(-10 9.6 6.7)" />
        <ellipse cx="14.4" cy="6.7" rx="1.85" ry="2.5" transform="rotate(10 14.4 6.7)" />
        <ellipse cx="18.4" cy="10.2" rx="1.85" ry="2.5" transform="rotate(30 18.4 10.2)" />
      </g>
    </>
  ),
  bone: () => <path d="M7 9.5a2.5 2.5 0 1 1 2.5-3.2L14.6 11a2.5 2.5 0 1 1 3.2 2.5 2.5 2.5 0 1 1-2.5 3.2L10.2 12a2.5 2.5 0 1 1-3.2-2.5z" />,
  ball: () => (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4.5 9.5c3 1 5 3.5 5.5 10.3M19.5 14.5c-3-1-5-3.5-5.5-10.3" />
    </>
  ),
  collar: () => (
    <>
      <ellipse cx="12" cy="9" rx="8" ry="4" />
      <path d="M4 9v2c0 2.2 3.6 4 8 4s8-1.8 8-4V9" />
      <circle cx="12" cy="18.5" r="2.2" />
    </>
  ),
  kennel: () => (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-4.5a2.5 2.5 0 0 1 5 0V20" />
    </>
  ),
  bowl: () => (
    <>
      <path d="M3 12h18l-2 6.5a2 2 0 0 1-1.9 1.5H6.9A2 2 0 0 1 5 18.5z" />
      <path d="M9 9.5a1.6 1.6 0 1 1 1.6-1.6M14 8.5a1.6 1.6 0 1 1 1.6 1.6" />
    </>
  ),
  star: () => <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  heart: () => <path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />,
}

export const BOARD_ICONS = Object.keys(BOARD_ICON_PATHS) as BoardIcon[]

export function Icon(props: { children: JSX.Element; size?: number; class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      width={props.size ?? 20}
      height={props.size ?? 20}
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

export function BoardIconSvg(props: { icon: BoardIcon; size?: number }) {
  return <Icon size={props.size}>{(Object.hasOwn(BOARD_ICON_PATHS, props.icon) ? BOARD_ICON_PATHS[props.icon] : BOARD_ICON_PATHS.paw)()}</Icon>
}

/** Friendly line drawing shared by loading and missing-board states. */
export function DogMark(props: { size?: number; wag?: boolean }) {
  return <svg viewBox="0 0 88 64" width={props.size ?? 88} height={(props.size ?? 88) * 64 / 88} fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path class={props.wag ? 'tail' : undefined} d="M22 32C11 29 9 18 14 13c1 9 7 9 10 12" />
    <path d="M26 48V37c0-5 5-9 12-9h17l3-13c1-4 5-6 9-4l6 7 8 3v8c0 4-3 6-7 6h-7l-3 14v6h-8V43H37v12h-9v-7Z" />
    <path d="M60 13c-5 1-7 8-4 14 2 3 6 2 7-1l3-12M70 27h9M35 43l-2-6" />
    <circle cx="72" cy="20" r="1.6" fill="currentColor" stroke="none" />
    <path d="m78 21 3 1v3h-3Z" fill="currentColor" stroke="none" />
  </svg>
}

export const ToolIcons: Record<string, () => JSX.Element> = {
  inbox: () => <><path d="m4 4-2 9v7h20v-7l-2-9Z" /><path d="M2 13h6l2 3h4l2-3h6" /></>,
  grid: () => (
    <>
      <circle cx="6" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </>
  ),
  note: () => (
    <>
      <path d="M5 4h14v16H5z" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
    </>
  ),
  link: () => (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  todo: () => (
    <>
      <path d="m4 7 1.6 1.6L8.5 5.5M4 15l1.6 1.6 2.9-3.1" />
      <path d="M11.5 7.5H20M11.5 15.5H20" />
    </>
  ),
  line: () => <path d="M5 19 19 5M19 5h-6M19 5v6" />,
  board: () => (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  column: () => (
    <>
      <rect x="6" y="3.5" width="12" height="17" rx="1.5" />
      <path d="M6 8h12M8.5 11.5h7M8.5 15h7" />
    </>
  ),
  image: () => (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20.5 16-5-5-8.5 8" />
    </>
  ),
  trash: () => (
    <>
      <path d="M4 20c2.5-4 5-5.5 8-5.5s5.5 1.5 8 5.5z" />
      <path d="M9 12.5 13.5 8M8 13a1.4 1.4 0 1 1-.4-2.4 1.4 1.4 0 1 1 2.4-.4M14.5 7.5a1.4 1.4 0 1 1 .4 2.4 1.4 1.4 0 1 1-2.4.4" />
    </>
  ),
  undo: () => <path d="M9 7 4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 10h-2" />,
  redo: () => <path d="m15 7 4.5 4.5L15 16M19 11.5h-9a5 5 0 0 0 0 10h2" />,
  share: () => (
    <>
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="m8.7 10.8 6.6-3.6M8.7 13.2l6.6 3.6" />
    </>
  ),
  search: () => (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  close: () => <path d="M6 6l12 12M18 6 6 18" />,
  plus: () => <path d="M12 5v14M5 12h14" />,
  minus: () => <path d="M5 12h14" />,
  edit: () => <path d="M15.5 5.5 18.5 8.5M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z" />,
  multi: () => <><rect x="3" y="7" width="11" height="11" rx="2" /><path d="M8 4h10a2 2 0 0 1 2 2v10" /><path d="m6 12.5 2 2 3.5-4" /></>,
  camera: () => <><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>,
  open: () => <path d="M9 6l6 6-6 6" />,
  fit: () => <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />,
  comment: () => <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  check: () => <path d="M5 12.5 10 17l9-10" />,
  download: () => <path d="M12 4v12M7 11l5 5 5-5M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />,
  upload: () => <path d="M12 16V4M7 9l5-5 5 5M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />,
  restore: () => <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4.5h4.5" />,
  external: () => <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  user: () => (
    <>
      <path d="M7 6 4 5 2.5 11c-.5 3 3 4 4.5 1M17 6l3-1 1.5 6c.5 3-3 4-4.5 1M7 6c3-2 7-2 10 0l1 8c.5 4-3 6-6 6s-6.5-2-6-6Z" />
      <path d="m10.5 13 1.5 1.5 1.5-1.5ZM12 15v2M8.5 10h.1M15.5 10h.1" />
    </>
  ),
}
