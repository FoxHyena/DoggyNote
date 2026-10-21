import { imageSourceUrl } from '@doggynote/core'

/** Only associate unambiguous clipboard HTML with one imported image. Never use filenames. */
export function capturedImageSource(dt: DataTransfer): string | null {
  if (dt.files.length !== 1) return null
  const html = dt.getData('text/html')
  if (html) {
    // Template content is inert and never attached: parsing attribution must
    // not fetch clipboard images or execute pasted markup.
    const template = document.createElement('template')
    template.innerHTML = html
    const fragment = template.content
    const images = fragment.querySelectorAll('img')
    if (images.length !== 1) return null
    const img = images[0]
    // getAttribute, not .href/.src: relative paths cannot be reliably attributed
    // to the original page and must never resolve against DoggyNote's origin.
    return imageSourceUrl(img.closest('a')?.getAttribute('href')) ?? imageSourceUrl(img.getAttribute('src'))
  }
  // A browser image drag may supply its web address without an HTML fragment.
  const uris = dt.getData('text/uri-list').split(/\r?\n/).filter((line) => line && !line.startsWith('#'))
  return uris.length === 1 ? imageSourceUrl(uris[0]) : null
}
