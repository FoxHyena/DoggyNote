// Rasterise once, off the UI thread. There are no live filters on the result.
const worker = self as unknown as {
  onmessage: (event: MessageEvent<{ id: number; blob: Blob }>) => void
  postMessage: (message: { id: number; blob?: Blob; error?: string }) => void
}

worker.onmessage = async ({ data: { id, blob } }) => {
  let image: ImageBitmap | undefined
  try {
    image = await createImageBitmap(blob)
    // Sticker assets are at most 512px; also bound unexpected legacy images.
    const scale = Math.min(1, 512 / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale))
    const radius = Math.max(1, Math.round(Math.max(width, height) * .012))
    // Padding keeps artwork that touches the original edge from being clipped.
    const mask = new OffscreenCanvas(width + radius * 2, height + radius * 2)
    const ctx = mask.getContext('2d')!
    ctx.drawImage(image, radius, radius, width, height)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, mask.width, mask.height)
    const out = new OffscreenCanvas(mask.width, mask.height), result = out.getContext('2d')!
    result.drawImage(mask, 0, 0)
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8
      result.drawImage(mask, Math.cos(angle) * radius, Math.sin(angle) * radius)
    }
    result.drawImage(image, radius, radius, width, height)
    worker.postMessage({ id, blob: await out.convertToBlob({ type: 'image/png' }) })
  } catch {
    worker.postMessage({ id, error: 'Static sticker outline unavailable' })
  } finally {
    image?.close()
  }
}

export {}
