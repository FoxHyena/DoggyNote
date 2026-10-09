import { COPY } from '@doggynote/theme'

/** A wagging tail. */
export function Loader(props: { label?: string }) {
  return (
    <div class="loader" role="status" data-testid="loader">
      <svg viewBox="0 0 64 40" width="72" height="45" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 30c4-10 14-14 26-14h10c6 0 10 4 10 10v4" />
          <path d="M14 30v6M24 30v6M42 30v6M52 30v6" />
          <path class="tail" d="M8 30C4 24 4 16 9 11" />
        </g>
      </svg>
      <span>{props.label ?? COPY.loading}</span>
    </div>
  )
}
