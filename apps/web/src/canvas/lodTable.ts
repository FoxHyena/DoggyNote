import { cellDisplay, cellKey, cellValue, effectiveAlign, isTableField, readCell, tableColumns, tableRows, tableTitle, unreadText, type Card } from '@doggynote/core'
import { isPresetColor } from '@doggynote/theme'

// A table card zoomed out (below 35%), drawn on the overview canvas instead of
// as DOM: the header band, grid lines, and a short bar where a cell has text.
// Geometry matches table.css (title 42px, rows at least 32px) so the card does
// not seem to change when it turns into DOM; a row that wraps is only an
// approximation, which is fine at this size.

const TITLE_H = 42
const ROW_H = 32

type Pal = Record<string, string>

/** A preset fill as canvas colours, the table's own (see tableFills); 'none' and anything unknown draw nothing. */
const fillOf = (pal: Pal, color: unknown): { bg: string; text: string } | null =>
  isPresetColor(color) && color !== 'none' && pal[`table-${color}-bg`] ? { bg: pal[`table-${color}-bg`]!, text: pal[`table-${color}-text`] ?? pal.muted! } : null

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
    // Header: no band, as drawn at full size (one rule under it, below).
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
    // Row and cell fills sit under the lines and the text bars: the cell's beats the row's.
    const fields = card as unknown as Record<string, unknown>
    for (let r = first; r < last; r++) {
      const row = rows[r]!
      const top = gridTop + (r + 1) * rowH
      if (top > y + h) break
      const rowFill = fillOf(pal, row.bg)
      if (rowFill) { ctx.fillStyle = rowFill.bg; ctx.fillRect(x, top, w, rowH) }
      cols.forEach((col, i) => {
        const bg = fillOf(pal, readCell(fields[cellKey(row.id, col.id)]).bg)
        if (bg) { ctx.fillStyle = bg.bg; ctx.fillRect(edges[i]!, top, edges[i + 1]! - edges[i]!, rowH) }
      })
    }
    // The soft full grid, as at full size: 70% of the border everywhere, and the rule under the header at full strength.
    ctx.strokeStyle = pal.border
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.7
    ctx.beginPath()
    for (let r = Math.max(1, first); r <= last; r++) {
      const ly = Math.round(gridTop + (r + 1) * rowH) + 0.5 - 1
      if (ly < y + h) { ctx.moveTo(x, ly); ctx.lineTo(x + w, ly) }
    }
    for (let i = 1; i < cols.length; i++) {
      const lx = Math.round(edges[i]!) + 0.5
      ctx.moveTo(lx, gridTop)
      ctx.lineTo(lx, Math.min(y + h, gridTop + (rows.length + 1) * rowH))
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    const rule = Math.round(gridTop + rowH) + 0.5 - 1
    if (rule < y + h) { ctx.beginPath(); ctx.moveTo(x, rule); ctx.lineTo(x + w, rule); ctx.stroke() }

    // A mark where a cell has something; skipped when the whole table is a few pixels wide.
    if (z >= 0.06) {
      for (let r = first; r < last; r++) {
        const row = rows[r]!
        const top = gridTop + (r + 1) * rowH
        if (top + rowH / 2 > y + h) break
        const mid = top + rowH / 2
        cols.forEach((col, i) => {
          const cell = readCell(fields[cellKey(row.id, col.id)])
          const cellFill = fillOf(pal, cell.bg ?? row.bg)
          // Ink that reads on this cell's own fill.
          const ink2 = cellFill?.text ?? ink
          const left = edges[i]! + 10 * z, right = edges[i + 1]! - 10 * z, room = right - left
          if (room <= 0) return
          const align = effectiveAlign(col, cell.a)
          const place = (len: number) => (align === 'r' ? right - len : align === 'c' ? left + (room - len) / 2 : left)
          ctx.fillStyle = ink2
          if (col.t === 'checkbox') {
            const on = cellValue(col, cell) === true
            const size = Math.min(room, 10 * z)
            const bx = place(size)
            ctx.globalAlpha = on ? 0.9 : Number(pal.emptyInk) || 0.7
            if (on) ctx.fillRect(bx, mid - size / 2, size, size)
            else { ctx.lineWidth = Math.max(1, z); ctx.strokeStyle = ink2; ctx.strokeRect(bx + 0.5, mid - size / 2 + 0.5, size, size) }
            ctx.globalAlpha = 1
            return
          }
          if (col.t === 'rating') {
            const n = (cellValue(col, cell) as number | null) ?? 0
            if (!n) return
            const d = Math.min(8 * z, room / 5), gap = d * 0.4
            const len = n * d + (n - 1) * gap
            ctx.globalAlpha = 0.7
            for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(place(Math.min(len, room)) + d / 2 + k * (d + gap), mid, d / 2, 0, Math.PI * 2); ctx.fill() }
            ctx.globalAlpha = 1
            return
          }
          if (col.t === 'select') {
            const v = cellValue(col, cell)
            const opt = col.opts.find((o) => o.id === v)
            if (!opt) return
            const len = Math.max(2, Math.min(room, (opt.n.length * 6 + 12) * z))
            const chip = fillOf(pal, opt.c)
            // A tag is a small tinted pill; one with no colour is a bar, like text.
            if (chip) {
              ctx.fillStyle = chip.bg
              roundRect(ctx, place(len), mid - 7 * z, len, 14 * z, 7 * z)
              ctx.fill()
              ctx.fillStyle = chip.text
              ctx.globalAlpha = 0.55
              const inner = Math.max(1, len - 12 * z)
              ctx.fillRect(place(len) + (len - inner) / 2, mid - 2 * z, inner, Math.max(1, 4 * z))
              ctx.globalAlpha = 1
              return
            }
          }
          const text = unreadText(col, cell) ?? cellDisplay(col, cell)
          if (!text) return
          const len = Math.max(1, Math.min(room, text.length * 7 * z))
          ctx.globalAlpha = unreadText(col, cell) !== null ? 0.28 : 0.45
          ctx.fillRect(place(len), mid - 3 * z, len, Math.max(1, 6 * z))
          ctx.globalAlpha = 1
        })
      }
    }
  }
  ctx.restore()
}
