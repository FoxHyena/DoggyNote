import { createSignal } from 'solid-js'
import * as doc from './doc.ts'
import { endEdit } from './ui.ts'
import { syncNow } from './sync.ts'
import { isTauri } from './platform.ts'

export const [exitSaveProblem, setExitSaveProblem] = createSignal(false)
let finishing = false

export async function saveBeforeLeaving() {
  endEdit()
  await doc.flush()
  await Promise.race([syncNow(), new Promise<void>((resolve) => setTimeout(resolve, 3000))])
  // A concurrent edit or permission refresh may have changed the local queue.
  await doc.flush()
}

export async function retryExitSave() {
  if (finishing) return
  finishing = true
  try {
    await saveBeforeLeaving()
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('finish_exit_save', { allow: true })
  } catch {
    setExitSaveProblem(true)
  } finally { finishing = false }
}

export async function cancelExitSave() {
  setExitSaveProblem(false)
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('finish_exit_save', { allow: false })
}

export async function installNativeSave() {
  if (!isTauri) return () => {}
  const [{ listen }, { invoke }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')])
  const unlisten = await listen('save-before-exit', () => void retryExitSave())
  await invoke('exit_save_ready')
  return unlisten
}
