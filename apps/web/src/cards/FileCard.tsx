import { Show, createResource } from 'solid-js'
import { fileKind, formatBytes, type FileKind } from '@doggynote/core'
import { assetUrl, fileUrl } from '../state/api.ts'
import type { CardProps } from '../canvas/CardView.tsx'

const LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  doc: 'DOC',
  sheet: 'SHEET',
  slides: 'SLIDES',
  zip: 'ZIP',
  audio: 'AUDIO',
  video: 'VIDEO',
  image: 'IMAGE',
  text: 'TEXT',
  other: 'FILE',
}

/** A file: kind, name and size; the name downloads it. PDFs show their first page. */
export function FileCard(props: CardProps<'file'>) {
  const c = () => props.card.content
  const kind = () => fileKind(c().mime, c().name)
  const [href] = createResource(
    () => (c().status ?? 'ok') === 'ok' && c().assetId,
    (id) => fileUrl(id),
  )
  const [preview] = createResource(
    () => !props.lod && c().thumb && c().assetId,
    (id) => assetUrl(id, 'thumb'),
  )
  const meta = () => {
    const s = c().status ?? 'ok'
    if (s === 'uploading') return 'Uploading…'
    if (s === 'error') return c().error || 'Upload failed'
    return `${LABEL[kind()]} · ${formatBytes(c().size)}`
  }

  return (
    <Show when={!props.lod} fallback={<div class="lod-box" style={{ height: `${Math.max(24, props.card.h - 24)}px` }} />}>
      <div class="file-card" data-status={c().status ?? 'ok'} data-testid="file-card">
        <Show when={preview()}>
          <img
            class="file-preview"
            data-testid="file-preview"
            src={preview()}
            alt=""
            draggable={false}
            style={{ 'aspect-ratio': `${c().thumb!.width} / ${c().thumb!.height}` }}
          />
        </Show>
        <div class="file-row">
          <span class="file-kind" data-kind={kind()}>
            {LABEL[kind()]}
          </span>
          <div class="file-info">
            <Show when={href()} fallback={<span class="file-name">{c().name}</span>}>
              <a class="file-name" href={href()} download={c().name} target="_blank" rel="noopener" data-nodrag data-testid="file-download" title="Download">
                {c().name}
              </a>
            </Show>
            <span class="file-meta" data-testid="file-meta">
              {meta()}
            </span>
          </div>
        </div>
      </div>
    </Show>
  )
}
