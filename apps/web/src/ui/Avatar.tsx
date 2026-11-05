import { Show, createResource, createSignal } from 'solid-js'
import { avatarUrl } from '../state/api.ts'
import { initials, personStyle } from '../state/realtime.ts'
import { user } from '../state/session.ts'
import './avatar.css'

/** Identity is always named alongside the decorative photo. */
export function Avatar(props: { userId: string; name: string; avatarId?: string | null; class?: string; title?: string; testid?: string }) {
  const id = () => props.userId === user()?.id ? user()?.avatarId : props.avatarId
  const [url] = createResource(() => id() ? [props.userId, id()!] as const : null, ([userId, avatarId]) => avatarUrl(userId, avatarId))
  const [failed, setFailed] = createSignal('')
  return <span class={`person-avatar ${props.class ?? ''}`} style={personStyle(props.userId)} title={props.title} aria-hidden="true" data-testid={props.testid}>
    <Show when={id() && !url.loading && !url.error && url() && failed() !== url()} fallback={initials(props.name)}>
      <img src={url()} alt="" draggable={false} onError={() => setFailed(url() ?? '')} />
    </Show>
  </span>
}
