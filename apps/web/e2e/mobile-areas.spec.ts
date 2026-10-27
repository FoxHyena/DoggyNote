import { test } from '@playwright/test'
import { areaTouchFlow } from './area-touch-flow.ts'
import { areaHeaderFlow } from './area-header-flow.ts'
test('areas collapse and move mixed members with touch while preserving readable world sizes',async({page},info)=>areaTouchFlow(page,info))
test('area headers stay attached through horizontal panning and zoom', async ({ page }, info) => {
  test.setTimeout(60_000)
  await areaHeaderFlow(page, info)
})
