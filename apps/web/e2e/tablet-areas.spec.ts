import { test } from '@playwright/test'
import { areaTouchFlow } from './area-touch-flow.ts'
test('tablet canvas areas support disclosure, header dragging and pinch',async({page},info)=>areaTouchFlow(page,info))
