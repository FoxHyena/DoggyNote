import './shortcut-sheet.css'
import { For } from 'solid-js'
import { setShortcutsOpen } from '../state/ui.ts'
import { Popover } from './Popover.tsx'
import { IconButton } from './icons.tsx'
import { SHORTCUT_GROUPS, chordLabel, keyLabel, orderedKeys } from './shortcutList.ts'

// "?" or Account → Keyboard shortcuts: every shortcut on one compact panel,
// under the account button. Escape, "?" again or a click outside closes it.

export function ShortcutSheet() {
  const close = () => setShortcutsOpen(false)
  const anchor = () => document.querySelector<HTMLElement>('[data-testid="account"]') ?? document.body
  return (
    <Popover anchor={anchor} label="Keyboard shortcuts" testid="shortcut-sheet" class="shortcut-sheet" close={close}>
      {/* Focus lands on the sheet itself: nothing here needs a ring the moment it opens. */}
      <div class="shortcut-sheet-inner" tabIndex={-1} data-autofocus onKeyDown={(e) => { if (e.key === '?') { e.preventDefault(); close() } }}>
        <div class="shortcut-sheet-head">
          <h2 id="shortcut-sheet-title">Keyboard shortcuts</h2>
          <IconButton testid="shortcut-sheet-close" icon="close" label="Close" title="Close (Esc)" onClick={close} />
        </div>
        <div class="shortcut-groups">
          <For each={SHORTCUT_GROUPS}>
            {(group) => (
              <section class="shortcut-group" aria-label={group.title}>
                <h3>{group.title}</h3>
                <dl>
                  <For each={group.items}>
                    {(item) => (
                      <div class="shortcut-row" data-testid="shortcut-row">
                        <dt>{item.label}</dt>
                        <dd data-keys={chordLabel(item.keys)}>
                          <span class="shortcut-keys-text">{chordLabel(item.keys)}</span>
                          <For each={orderedKeys(item.keys)}>{(k) => <kbd aria-hidden="true">{keyLabel(k)}</kbd>}</For>
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
              </section>
            )}
          </For>
        </div>
        <p class="shortcut-sheet-foot">Single keys work when you aren’t typing.</p>
      </div>
    </Popover>
  )
}
