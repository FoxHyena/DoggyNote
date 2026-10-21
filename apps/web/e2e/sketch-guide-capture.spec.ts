import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MOD, canvasBox, dragBy, freshBoard, waitForSync } from './helpers.ts'

// Opt-in evidence capture, not manual QA. Run isolated under the heavy lease:
// SKETCH_SHOTS=1 pnpm exec playwright test sketch-guide-capture --project=chromium
test.skip(!process.env.SKETCH_SHOTS, 'only when capturing reviewed guide figures')
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, headless: true })
test.setTimeout(180_000)

type Point = [number, number]
const editor = (page: Page) => page.getByTestId('stroke-editor')
const sketch = (page: Page) => page.locator('[data-type="sketch"]').last()

/** Normalized logical-paper points, converted only through the visible surface. */
async function stroke(page: Page, points: Point[]) {
  const surface = editor(page).getByTestId('ink-surface')
  const box = (await surface.boundingBox())!
  await page.mouse.move(box.x + points[0]![0] * box.width, box.y + points[0]![1] * box.height)
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 })
  await page.mouse.up()
}
const rectangle = (x: number, y: number, w: number, h: number): Point[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
const circle = (x: number, y: number, r: number): Point[] => Array.from({ length: 25 }, (_, i) => [x + Math.cos(i * Math.PI / 12) * r, y + Math.sin(i * Math.PI / 12) * r])

async function placeTool(page: Page, tool: string, x: number, y: number) {
  const from = (await page.getByTestId(`tool-${tool}`).boundingBox())!
  const canvas = await canvasBox(page)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width * x, canvas.y + canvas.height * y, { steps: 20 })
  await page.mouse.up()
}
async function finish(page: Page, title: string) {
  await editor(page).getByTestId('sketch-title-field').fill(title)
  await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(editor(page)).toHaveCount(0)
  const card = sketch(page)
  const id = (await card.getAttribute('data-card-id'))!
  return page.locator(`[data-card-id="${id}"]`)
}
async function appearance(page: Page, theme: 'Light' | 'Dark') {
  await page.getByTestId('account').click()
  await page.getByRole('radio', { name: theme, exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase())
}

test('capture populated storyboard and editable interface guide flows', async ({ page, browserName }, info) => {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const captures: { file: string; caption: string; width: number; height: number }[] = []
  const capture = async (file: string, caption: string) => {
    await waitForSync(page)
    await page.mouse.move(3, 895)
    await page.screenshot({ path: info.outputPath(file) })
    const size = page.viewportSize()!
    captures.push({ file, caption, ...size })
  }
  await freshBoard(page, 'Walk planner — storyboard')
  await appearance(page, 'Light')
  await placeTool(page, 'note', .15, .16)
  await expect(page.getByTestId('note-editor')).toBeVisible()
  await page.keyboard.insertText('## Walk planner\nHelp someone start a walk in two taps.\n\n- Keep the next action clear\n- Show route and duration\n- Confirm when ready')
  await page.keyboard.press('Escape')

  // Three genuinely drawn frames, followed by a real independent copy.
  const frames: Locator[] = []
  await placeTool(page, 'sketch', .44, .16)
  await expect(editor(page)).toBeVisible()
  await editor(page).getByRole('button', { name: 'Red', exact: true }).click()
  await stroke(page, rectangle(.2, .08, .6, .82))
  await stroke(page, [[.27, .19], [.65, .19]])
  await stroke(page, rectangle(.27, .3, .46, .17))
  await stroke(page, rectangle(.27, .55, .46, .17))
  await stroke(page, [[.32, .38], [.63, .38]])
  await editor(page).getByRole('button', { name: 'Highlighter', exact: true }).click()
  await editor(page).getByRole('button', { name: 'Yellow', exact: true }).click()
  await stroke(page, [[.29, .63], [.7, .63]])
  frames.push(await finish(page, '01 — Choose a walk'))

  await placeTool(page, 'sketch', .72, .16)
  await expect(editor(page)).toBeVisible()
  await stroke(page, rectangle(.1, .12, .8, .76))
  await stroke(page, [[.2, .7], [.33, .6], [.45, .65], [.53, .4], [.72, .3], [.8, .42]])
  await stroke(page, circle(.2, .7, .04)); await stroke(page, circle(.8, .42, .04))
  await stroke(page, [[.18, .2], [.5, .2]])
  frames.push(await finish(page, '02 — Check the route'))

  await placeTool(page, 'sketch', .44, .58)
  await expect(editor(page)).toBeVisible()
  await stroke(page, rectangle(.2, .08, .6, .82))
  await stroke(page, circle(.5, .4, .15))
  await stroke(page, [[.4, .4], [.47, .5], [.62, .28]])
  await stroke(page, [[.3, .7], [.7, .7]])
  frames.push(await finish(page, '03 — Ready to go'))

  await placeTool(page, 'column', .72, .58)
  await page.getByTestId('column-title-input').fill('Keep for the next review')
  await page.getByTestId('column-title-input').press('Enter')
  const column = page.locator('[data-type="column"]')
  const from = (await frames[2]!.getByTestId('sketch-paper').boundingBox())!
  const to = (await column.getByTestId('column-body').boundingBox())!
  await page.mouse.move(from.x + 20, from.y + 20); await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + 15, { steps: 20 }); await page.mouse.up()
  await expect(column.locator('[data-type="sketch"]')).toHaveCount(1)

  await frames[0]!.getByTestId('sketch-paper').click()
  await page.getByTestId('duplicate-selection').click()
  const copy = sketch(page)
  await copy.getByRole('textbox', { name: 'Sketch title' }).fill('Alternative — start immediately')
  await copy.getByRole('textbox', { name: 'Sketch title' }).press('Enter')
  await dragBy(page, copy.getByTestId('sketch-paper'), -410, 330, { steps: 20 })
  await copy.getByTestId('sketch-paper').dblclick()
  await editor(page).getByRole('button', { name: 'Blue', exact: true }).click()
  await stroke(page, [[.45, .79], [.7, .79], [.64, .74], [.7, .79], [.64, .84]])
  await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(copy.locator('[data-stroke-id]')).toHaveCount(7)
  await expect(frames[0]!.locator('[data-stroke-id]')).toHaveCount(6)
  await page.keyboard.press(`${MOD}+1`)
  await capture('storyboard-board-light.png', 'Three editable frames beside requirements, one in a column, with an independent alternative.')
  await appearance(page, 'Dark')
  await capture('storyboard-board-dark.png', 'The same populated storyboard keeps deliberate paper and themed board controls in dark appearance.')
  await frames[0]!.getByTestId('sketch-paper').dblclick()
  await expect(editor(page)).toBeVisible()
  await capture('interface-editor-dark.png', 'Reopen a frame to edit its pen outline and translucent highlight using the shared drawing tools.')
  await editor(page).getByRole('button', { name: 'Done', exact: true }).click()
  await appearance(page, 'Light')
  await frames[0]!.getByTestId('sketch-paper').dblclick()
  await capture('interface-editor-light.png', 'The completed interface stays editable on deliberate paper in light appearance.')
  await writeFile(info.outputPath('capture-provenance.json'), JSON.stringify({ revision, platform: browserName, method: 'isolated headless real-pointer workflow; supplementary evidence, not manual QA', boardUrl: page.url(), captures }, null, 2))
})
