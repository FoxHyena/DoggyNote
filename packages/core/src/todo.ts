// To-do list rules: ticking stamps the time, done tasks sink below open ones,
// and a short "done today" label says when. Pure, so the server and tests share it.

import type { TodoItem } from './model.ts'

/** Tick or untick one task, stamping when it was done. */
export function toggleItem(items: TodoItem[], id: string, now: number): TodoItem[] {
  return items.map((i) => (i.id === id ? { ...i, done: !i.done, doneAt: i.done ? null : now } : i))
}

/**
 * Open tasks first, then done ones, each keeping its order. A task ticked from
 * the open section lands at the top of the done section; one unticked from the
 * done section lands at the end of the open ones.
 */
export function settleItems(items: TodoItem[]): TodoItem[] {
  return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)]
}

export const sameOrder = (a: TodoItem[], b: TodoItem[]) => a.length === b.length && a.every((i, n) => i.id === b[n].id)

export const clearDone = (items: TodoItem[]) => items.filter((i) => !i.done)

const DAY = 86_400_000
const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "today", "yesterday", "Oct 20", or "Oct 20, 2025" from another year. */
export function doneLabel(doneAt: number, now: number, locale?: string): string {
  const days = Math.round((startOfDay(now) - startOfDay(doneAt)) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  const sameYear = new Date(doneAt).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(doneAt)
}
