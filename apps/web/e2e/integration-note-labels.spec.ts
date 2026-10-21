import { expect, test } from '@playwright/test'
import { MOD, addNote, freshBoard, postSync, pullAllObjects, waitForSync } from './helpers.ts'

for (const linked of [false, true]) for (const reuse of [false, true]) {
  test(`${linked ? 'linked' : 'independent'} note copy ${reuse ? 'reuses' : 'creates'} destination labels with atomic Undo and persistence`, async ({ page }) => {
    await freshBoard(page, 'Labelled source brief')
    const sourceBoardId = decodeURIComponent(page.url().split('#/b/')[1]!)
    const sourceUrl = page.url()
    const note = await addNote(page, 'A labelled brief copied across boards')
    const sourceId = (await note.getAttribute('data-card-id'))!
    await waitForSync(page)
    const destinationId = crypto.randomUUID(), sourceToken = crypto.randomUUID().replaceAll('-', ''), targetToken = crypto.randomUUID().replaceAll('-', '')
    const response = await postSync(page.request, { data: { changes: [
      { id: sourceBoardId, patch: { [`labelName${sourceToken}`]: 'Lighting', [`labelColor${sourceToken}`]: 'gold' } },
      { id: sourceId, patch: { [`label${sourceToken}`]: true } },
      { id: destinationId, patch: { id: destinationId, kind: 'board', parentId: sourceBoardId, title: 'Labelled destination', icon: 'paw', color: 'none', createdAt: Date.now(), ...(reuse ? { [`labelName${targetToken}`]: ' lighting ', [`labelColor${targetToken}`]: 'sky' } : {}) } },
    ] } })
    expect(response.ok(), await response.text()).toBe(true)
    await page.reload()
    const source = page.locator(`[data-card-id="${sourceId}"]`)
    await expect(source.locator('.label-chip')).toHaveText('Lighting')
    await source.dblclick()
    await expect(page.getByTestId('note-editor')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('note-editor')).toHaveCount(0)
    await page.getByTestId('note-copies').click()
    await page.getByRole('combobox', { name: 'Destination board' }).selectOption(destinationId)
    await page.getByTestId(linked ? 'create-synced-copy' : 'create-independent-copy').click()
    await expect(page.getByTestId('board-name')).toHaveText('Labelled destination')
    const copy = page.getByTestId('card').filter({ hasText: 'A labelled brief copied across boards' })
    await expect(copy.locator('.label-chip')).toHaveText(reuse ? ' lighting ' : 'Lighting')
    const copyId = (await copy.getAttribute('data-card-id'))!
    await waitForSync(page)
    const saved = (await pullAllObjects(page.request)).objects
    const original = saved.find((o: { id: string }) => o.id === sourceId)
    const copied = saved.find((o: { id: string }) => o.id === copyId)
    expect(copied[`label${sourceToken}`]).toBeNull()
    expect(original[`label${sourceToken}`]).toBe(true)
    expect(copied.noteGroupId ?? null).toBe(linked ? original.noteGroupId : null)
    if (reuse) expect(copied[`label${targetToken}`]).toBe(true)
    // Copy creation and any new destination label are one user history action.
    await page.keyboard.press(`${MOD}+z`)
    await expect(copy).toHaveCount(0)
    await page.keyboard.press(`${MOD}+Shift+z`)
    await expect(copy.locator('.label-chip')).toHaveText(reuse ? ' lighting ' : 'Lighting')
    await waitForSync(page); await page.reload()
    await expect(copy.locator('.label-chip')).toHaveText(reuse ? ' lighting ' : 'Lighting')
    await page.goto(sourceUrl)
    await expect(source.locator('.label-chip')).toHaveText('Lighting')
    await expect(source).toContainText('A labelled brief copied across boards')
  })
}
