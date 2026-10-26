import { test } from '@playwright/test'
import { areaTouchFlow } from './area-touch-flow.ts'
test('areas collapse and move mixed members with touch while preserving readable world sizes',async({page},info)=>areaTouchFlow(page,info))
