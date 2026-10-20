import { COPY } from '@doggynote/theme'
import { DogMark } from './icons.tsx'

/** A wagging tail. */
export function Loader(props: { label?: string }) {
  return (
    <div class="loader" role="status" data-testid="loader">
      <DogMark wag />
      <span>{props.label ?? COPY.loading}</span>
    </div>
  )
}
