import { outlineAlpha } from './stickerOutlineMask.ts'

// Rasterise once, off the UI thread. There are no live filters on the result.
const worker = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; blob: Blob; color: [number, number, number] }>) => void
  postMessage: (message: { id: number; blob?: Blob; error?: string }) => void
}

worker.onmessage = async ({ data: { id, blob, color } }) => {
  let image: ImageBitmap | undefined
  try {
    image = await createImageBitmap(blob)
    // Sticker assets are at most 512px; also bound unexpected legacy images.
    const scale = Math.min(1, 512 / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale))
    const radius = Math.max(1, Math.round(Math.max(width, height) * .012))
    // Padding keeps artwork that touches the original edge from being clipped.
    const out = new OffscreenCanvas(width + radius * 2, height + radius * 2)
    const ctx = out.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, radius, radius, width, height)
    const pixels = ctx.getImageData(0, 0, out.width, out.height)
    const alpha = outlineAlpha(pixels.data, out.width, out.height, radius)
    for (let i = 0; i < alpha.length; i++) {
      pixels.data[i * 4] = color[0]; pixels.data[i * 4 + 1] = color[1]; pixels.data[i * 4 + 2] = color[2]
      pixels.data[i * 4 + 3] = alpha[i]
    }
    ctx.putImageData(pixels, 0, 0)
    ctx.drawImage(image, radius, radius, width, height)
    worker.postMessage({ id, blob: await out.convertToBlob({ type: 'image/png' }) })
  } catch {
    worker.postMessage({ id, error: 'Static sticker outline unavailable' })
  } finally {
    image?.close()
  }
}

export {}
