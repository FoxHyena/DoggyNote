import { expect, test } from 'vitest'
import { requestPool } from './requestPool.ts'

test('one budget covers independent callers and a failed request releases its slot', async () => {
  const run = requestPool(2), signal = new AbortController().signal
  let active = 0, peak = 0
  const started: number[] = [], finish: (() => void)[] = []
  const jobs = Array.from({ length: 5 }, (_, i) => run(async () => {
    started.push(i); active++; peak = Math.max(peak, active)
    await new Promise<void>((resolve) => finish.push(resolve))
    active--
    if (i === 0) throw new Error('upstream failed')
    return i
  }, signal))
  const results = Promise.allSettled(jobs)
  await Promise.resolve()
  expect(started).toEqual([0, 1])
  for (let i = 0; i < 5; i++) {
    await expect.poll(() => finish.length).toBeGreaterThan(i)
    finish[i]()
  }
  expect((await results).map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
  expect(peak).toBe(2)
})

test('cancelling queued requests removes them without blocking the next account', async () => {
  const run = requestPool(1), previous = new AbortController(), next = new AbortController()
  let release!: () => void, cancelledStarted = false, nextStarted = false
  const first = run(() => new Promise<void>((resolve) => { release = resolve }), previous.signal)
  const queued = run(async () => { cancelledStarted = true }, previous.signal)
  const settled = Promise.allSettled([queued])
  const later = run(async () => { nextStarted = true }, next.signal)
  previous.abort()
  await Promise.resolve()
  expect((await settled)[0].status).toBe('rejected')
  expect(nextStarted).toBe(false)
  release(); await first; await later
  expect(cancelledStarted).toBe(false)
  expect(nextStarted).toBe(true)
  await expect(run(async () => { cancelledStarted = true }, previous.signal)).rejects.toThrow()
  expect(cancelledStarted).toBe(false)
})
