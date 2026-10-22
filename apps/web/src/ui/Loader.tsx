import { COPY } from '@doggynote/theme'
import { DogMark } from './icons.tsx'

/** A quiet loading pulse; reduced motion keeps the dog still. */
export function Loader(props: { label?: string }) {
  return (
    <div class="loader" role="status" data-testid="loader">
      <DogMark />
      <span>{props.label ?? COPY.loading}</span>
    </div>
  )
}
