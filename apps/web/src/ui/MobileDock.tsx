import { For, Show, createSignal } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { LOD_ZOOM, zoomAt, type CardType } from '@doggynote/core'
import { createCard } from '../state/actions.ts'
import { camera, connectMode, setCamera, setConnectMode, setPaletteOpen, setTrashOpen, trashOpen, viewport } from '../state/ui.ts'
import { addAnyFiles, addImages } from '../canvas/paste.ts'
import { BoardNavigation } from './BoardNavigation.tsx'
import { ToyboxButton } from './ToyboxPanel.tsx'
import { TOOLS, centrePlacement } from './Toolbar.tsx'
import { Icon, ToolIcons } from './icons.tsx'
import { installMenu } from './menu.ts'

// Phones: the creation rail becomes a thumb-height dock. ＋ opens a sheet of
// everything you can add; Boards, Fetch, Inbox and Buried bones sit around it.

export function MobileDock(props: { readOnly: boolean }) {
  return (
    <nav class="mobile-dock" aria-label="Quick actions" data-testid="mobile-dock">
      <BoardNavigation />
      <button class="icon-btn" data-testid="open-fetch" aria-label={COPY.search} onClick={() => setPaletteOpen(true)}>
        <Icon>{ToolIcons.search()}</Icon>
        <span class="icon-btn-label">{COPY.search}</span>
      </button>
      <Show when={!props.readOnly} fallback={<span class="dock-gap" />}>
        <AddButton />
      </Show>
      <ToyboxButton />
      <Show when={!props.readOnly} fallback={<span class="dock-gap" />}>
        <button class="icon-btn" classList={{ on: trashOpen() }} data-testid="tool-trash" aria-label={COPY.trash} aria-expanded={trashOpen()} onClick={() => setTrashOpen(!trashOpen())}>
          <Icon>{ToolIcons.trash()}</Icon>
          <span class="icon-btn-label">{COPY.trashShort}</span>
        </button>
      </Show>
    </nav>
  )
}

function AddButton() {
  const [open, setOpen] = createSignal(false)
  let root!: HTMLDivElement, trigger!: HTMLButtonElement, photo!: HTMLInputElement, camInput!: HTMLInputElement, files!: HTMLInputElement
  installMenu(open, () => setOpen(false), () => root, () => trigger)

  // Zoomed out there's no card DOM to type into; come in to 100% first.
  const comeClose = () => {
    if (camera().zoom >= LOD_ZOOM) return
    const v = viewport()
    setCamera(zoomAt(camera(), { x: v.width / 2, y: v.height / 2.6 }, 1))
  }
  const add = (type: CardType | 'line') => {
    setOpen(false)
    if (type === 'line') return setConnectMode(connectMode() ? null : { from: null })
    comeClose()
    // Synchronous, inside the tap, so a new note's editor gets the keyboard on iOS.
    createCard(type, centrePlacement(type))
  }
  const pick = (input: HTMLInputElement) => {
    setOpen(false)
    input.click()
  }
  const take = (list: FileList | null, images: boolean) => {
    const picked = [...(list ?? [])]
    const p = centrePlacement(images ? 'image' : 'file')
    if (!picked.length || !('at' in p)) return
    if (images) void addImages(picked, p.at)
    else addAnyFiles(picked, p.at)
  }

  return (
    <div class="dock-add-wrap" ref={root}>
      <button ref={trigger} class="dock-add" data-testid="dock-add" aria-label="Add to this board" aria-haspopup="menu" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <Icon size={26}>{ToolIcons.plus()}</Icon>
      </button>
      <Show when={open()}>
        <div class="menu add-sheet" role="menu" aria-label="Add to this board" data-testid="add-sheet">
          <div class="add-grid">
            <For each={TOOLS}>
              {(t) => (
                <button class="add-tile" role="menuitem" data-testid={`add-${t.id}`} onClick={() => add(t.id)}>
                  <span class="add-tile-icon"><Icon size={24}>{t.icon()}</Icon></span>
                  {t.label}
                </button>
              )}
            </For>
            <button class="add-tile" role="menuitem" data-testid="add-photo" onClick={() => pick(photo)}>
              <span class="add-tile-icon"><Icon size={24}>{ToolIcons.image()}</Icon></span>
              Photo
            </button>
            <button class="add-tile" role="menuitem" data-testid="add-camera" onClick={() => pick(camInput)}>
              <span class="add-tile-icon"><Icon size={24}>{ToolIcons.camera()}</Icon></span>
              Camera
            </button>
            <button class="add-tile" role="menuitem" data-testid="add-file" onClick={() => pick(files)}>
              <span class="add-tile-icon"><Icon size={24}>{ToolIcons.upload()}</Icon></span>
              File
            </button>
          </div>
        </div>
      </Show>
      <input ref={photo} type="file" accept="image/*" multiple hidden data-testid="image-input" onChange={(e) => { take(e.currentTarget.files, true); e.currentTarget.value = '' }} />
      <input ref={camInput} type="file" accept="image/*" capture="environment" hidden data-testid="camera-input" onChange={(e) => { take(e.currentTarget.files, true); e.currentTarget.value = '' }} />
      <input ref={files} type="file" multiple hidden data-testid="upload-input" onChange={(e) => { take(e.currentTarget.files, false); e.currentTarget.value = '' }} />
    </div>
  )
}
