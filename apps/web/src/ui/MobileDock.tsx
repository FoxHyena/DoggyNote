import { SheetGrip } from './SheetGrip.tsx'
import { armedSticker, suggestions, openStickers, setStickerTrayOpen, stickerTrayOpen } from '../state/stickers.ts'
import { For, Show, createSignal } from 'solid-js'
import { COPY } from '@doggynote/theme'
import { LOD_ZOOM, zoomAt, type CardType } from '@doggynote/core'
import { createCard } from '../state/actions.ts'
import { camera, connectMode, setCamera, setConnectMode, setPaletteOpen, setTrashOpen, trashOpen, viewport } from '../state/ui.ts'
import { addAnyFiles, addImages } from '../canvas/paste.ts'
import { BoardNavigation } from './BoardNavigation.tsx'
import { ToyboxButton } from './ToyboxPanel.tsx'
import { PRIMARY_TOOLS, MORE_TOOLS, centrePlacement } from './Toolbar.tsx'
import { Icon } from './icons.tsx'
import { installMenu } from './menu.ts'

// Phones: the creation rail becomes a thumb-height dock. ＋ opens a sheet of
// everything you can add; Boards, Fetch, Inbox and Buried bones sit around it.

export function MobileDock(props: { readOnly: boolean }) {
  return (
    <nav class="mobile-dock" aria-label="Quick actions" data-testid="mobile-dock">
      <BoardNavigation />
      <button class="icon-btn" data-testid="open-fetch" aria-label={COPY.search} onClick={() => setPaletteOpen(true)}>
        <Icon name="search" />
        <span class="icon-btn-label">{COPY.search}</span>
      </button>
      <Show when={!props.readOnly} fallback={<span class="dock-gap" />}>
        <AddButton />
      </Show>
      <ToyboxButton />
      <Show when={!props.readOnly} fallback={<span class="dock-gap" />}>
        <button class="icon-btn" classList={{ on: trashOpen() }} data-testid="tool-trash" aria-label={COPY.trash} aria-expanded={trashOpen()} onClick={() => setTrashOpen(!trashOpen())}>
          <Icon name="bury" />
          <span class="icon-btn-label">{COPY.trashShort}</span>
        </button>
      </Show>
    </nav>
  )
}

export function MobileStickerButton() {
  return <Show when={!armedSticker()}><button class="mobile-sticker-launcher" data-testid="mobile-stickers" aria-label="Stickers" aria-expanded={stickerTrayOpen()} aria-controls="sticker-tray" aria-description={suggestions.length ? suggestions.length === 1 ? 'Pack found in Telegram' : `${suggestions.length} packs found in Telegram` : undefined} onClick={() => stickerTrayOpen() ? setStickerTrayOpen(false) : openStickers()}><Icon size={25} name="sticker" /><Show when={suggestions.length}><span class="sticker-found-dot" data-testid="sticker-found-badge" aria-hidden="true" /></Show></button></Show>
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
        <Icon size={26} name="plus" />
      </button>
      <Show when={open()}>
        <div class="menu add-sheet" role="menu" aria-label="Add to this board" data-testid="add-sheet">
          <SheetGrip onDismiss={() => { setOpen(false); trigger.focus() }} />
          <div class="nav-menu-head"><strong>Add to this board</strong></div>
          <div class="add-grid add-primary" role="group" aria-label="Create">
            <For each={PRIMARY_TOOLS}>
              {(t) => (
                <button class="add-tile" classList={{ "add-primary-note": t.id === "note" }} role="menuitem" data-testid={`add-${t.id}`} onClick={() => add(t.id)}>
                  <span class="add-tile-icon"><Icon size={24} name={t.icon} /></span>
                  {t.label}
                </button>
              )}
            </For>
          </div>
          <div class="add-group-label">More</div>
          <div class="add-grid add-secondary" role="group" aria-label="More things to add">
            <For each={MORE_TOOLS}>{(t) => <button class="add-tile" role="menuitem" data-testid={`add-${t.id}`} onClick={() => add(t.id)}><span class="add-tile-icon"><Icon size={20} name={t.icon} /></span>{t.label}</button>}</For>
            <button class="add-tile" role="menuitem" data-testid="add-stickers" onClick={() => { setOpen(false); openStickers() }}><span class="add-tile-icon"><Icon size={24} name="sticker" /></span>Stickers</button>
            <button class="add-tile" role="menuitem" data-testid="add-photo" onClick={() => pick(photo)}>
              <span class="add-tile-icon"><Icon size={24} name="image" /></span>
              Photo
            </button>
            <button class="add-tile" role="menuitem" data-testid="add-camera" onClick={() => pick(camInput)}>
              <span class="add-tile-icon"><Icon size={24} name="camera" /></span>
              Camera
            </button>
            <button class="add-tile" role="menuitem" data-testid="add-file" onClick={() => pick(files)}>
              <span class="add-tile-icon"><Icon size={24} name="upload" /></span>
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
