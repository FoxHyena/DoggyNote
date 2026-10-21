import { test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

/** Optional real-flow captures; review images before copying any into public docs. */
export async function captureSyncedFlow(page: Page, state: string, caption: string) {
  if (!process.env.SYNC_SHOTS) return
  const info = test.info()
  const path = info.outputPath(`${state}.png`)
  await page.screenshot({ path, scale: 'css', animations: 'disabled' })
  writeFileSync(info.outputPath(`${state}.json`), JSON.stringify({
    state, caption, path, testedRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    project: info.project.name, viewport: page.viewportSize(), captureMethod: 'Playwright screenshot after real-input workflow assertions',
    approval: 'Pending visual review and MAIN-chat delivery; not a manual QA round.',
  }, null, 2) + '\n')
}
