import { cellDisplay, cellKey, isTableField, readCell, tableColumns, tableRows, tableTitle, type Card } from '@doggynote/core'

// A table card zoomed out (below 35%), drawn on the overview canvas instead of
// as DOM: the header band, grid lines, and a short bar where a cell has text.
// Geometry matches table.css (title 42px, rows at least 32px) so the card does
// not seem to change when it turns into DOM; a row that wraps is only an
// approximation, which is fine at this size.

const TITLE_H = 42
const ROW_H = 32

type Pal = Record<string, string>

/** Read every table field, so the overview redraws when any cell, row or column changes. */
export function trackTable(card: Card) {
  const fields = card as unknown as Record<string, unknown>
  for (const key of Object.keys(fields)) if (isTableField(key)) void fields[key]
  void card.content
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

export function drawTable(
  ctx: CanvasRenderingContext2D, pal: Pal, card: Card,
  x: number, y: number, w: number, h: number, z: number,
  tint: { bg: string; text: string } | null, writable: boolean,
) {
  const bg = tint?.bg ?? pal.card
  const ink = tint?.text ?? pal.muted
  const radius = 6 * z
  ctx.fillStyle = bg
  roundRect(ctx, x, y, w, h, radius)
  ctx.fill()
  ctx.save()
  roundRect(ctx, x, y, w, h, radius)
  ctx.clip()

  const title = tableTitle(card)
  const titleH = title || writable ? TITLE_H * z : 0
  if (title) {
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.6
    ctx.fillRect(x + 14 * z, y + 15 * z, Math.min(w * 0.4, title.length * 8 * z), Math.max(1, 8 * z))
    ctx.globalAlpha = 1
  }

  const cols = tableColumns(card)
  const rows = tableRows(card)
  if (cols.length) {
    const total = cols.reduce((sum, c) => sum + c.w, 0) || 1
    const edges: number[] = [x]
    for (const c of cols) edges.push(edges[edges.length - 1]! + (c.w / total) * w)
    const gridTop = y + titleH
    const rowH = ROW_H * z
    // Header band.
    ctx.fillStyle = pal.panel
    ctx.fillRect(x, gridTop, w, Math.min(rowH, h - titleH * 1))
    ctx.fillStyle = pal.muted
    ctx.globalAlpha = 0.7
    cols.forEach((c, i) => {
      if (c.n) ctx.fillRect(edges[i]! + 10 * z, gridTop + rowH / 2 - 3 * z, Math.max(1, Math.min(edges[i + 1]! - edges[i]! - 20 * z, c.n.length * 6 * z)), Math.max(1, 6 * z))
    })
    ctx.globalAlpha = 1

    // Only the rows that can be on screen.
    const bottom = Math.min(y + h, ctx.canvas.height)
    const first = Math.max(0, Math.floor((0 - gridTop) / rowH) - 1)
    const last = Math.min(rows.length, Math.ceil((bottom - gridTop) / rowH))
    ctx.strokeStyle = pal.border
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let r = Math.max(0, first); r <= last; r++) {
      const ly = Math.round(gridTop + (r + 1) * rowH) + 0.5 - 1
      if (ly < y + h) { ctx.moveTo(x, ly); ctx.lineTo(x + w, ly) }
    }
    for (let i = 1; i < cols.length; i++) {
      const lx = Math.round(edges[i]!) + 0.5
      ctx.moveTo(lx, gridTop)
      ctx.lineTo(lx, Math.min(y + h, gridTop + (rows.length + 1) * rowH))
    }
    ctx.stroke()

    // A bar where a cell has text; skipped when the whole table is a few pixels wide.
    if (z >= 0.06) {
      const fields = card as unknown as Record<string, unknown>
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.45
      for (let r = first; r < last; r++) {
        const row = rows[r]!
        const cy = gridTop + (r + 1) * rowH + rowH / 2 - 3 * z
        if (cy > y + h) break
        cols.forEach((col, i) => {
          const text = cellDisplay(col, readCell(fields[cellKey(row.id, col.id)]))
          if (!text) return
          const room = edges[i + 1]! - edges[i]! - 20 * z
          const len = Math.max(1, Math.min(room, text.length * 7 * z))
          // Numbers sit on the right, like the cells.
          const left = col.t === 'number' ? edges[i + 1]! - 10 * z - len : edges[i]! + 10 * z
          ctx.fillRect(left, cy, len, Math.max(1, 6 * z))
        })
      }
      ctx.globalAlpha = 1
    }
  }
  ctx.restore()
}
