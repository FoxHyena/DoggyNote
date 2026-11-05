/** Browser/extension-worker image processing. No persistence or network side effects. */
export const SIZES = { thumb: 256, small: 640, medium: 1024, full: 4096 } as const
export type AssetSize = keyof typeof SIZES
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

let webpOk: Promise<boolean> | undefined
export async function processImage(file: Blob) {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = bitmap
    if (!width || !height || width * height > 80_000_000) throw new Error('This image is too large to process. Choose a smaller version.')
    webpOk ??= new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/webp' }).then((b) => b.type === 'image/webp').catch(() => false)
    const type = /jpe?g|heic|heif/i.test(file.type) ? 'image/jpeg' : await webpOk ? 'image/webp' : 'image/png'
    const renditions: { size: AssetSize; blob: Blob }[] = []
    for (const [size, max] of Object.entries(SIZES) as [AssetSize, number][]) {
      if (size === 'full' && file.type === 'image/gif') {
        if (file.size > MAX_IMAGE_BYTES) throw new Error('This GIF exceeds the 15 MB image limit.')
        renditions.push({ size, blob: file }); continue
      }
      const scale = Math.min(1, max / Math.max(width, height))
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await canvas.convertToBlob({ type, quality: size === 'thumb' ? 0.8 : 0.88 })
      if (blob.size > MAX_IMAGE_BYTES) throw new Error('This image exceeds the 15 MB image limit.')
      renditions.push({ size, blob })
    }
    return { width, height, renditions }
  } finally { bitmap.close() }
}
