import { test } from '@playwright/test'

/** Observe only an already-failed original case; never change its interaction. */
export function installImageMetadataFailureDiagnostics() {
  if (process.env.IMAGE_METADATA_FAILURE_DIAGNOSTICS !== '1') return
  test.afterEach(async ({ page }, info) => {
    if (info.project.name !== 'webkit' || info.title !== 'image metadata remains readable at four widths in Light'
      || !['failed', 'timedOut', 'interrupted'].includes(info.status ?? '')) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let observations: unknown
    try {
      observations = await Promise.race([
        page.evaluate(() => {
          const identify = (el: Element | null) => el ? {
            tag: el.tagName, testId: el.getAttribute('data-testid'),
            className: el.getAttribute('class'), label: el.getAttribute('aria-label'),
          } : null
          const bounds = (el: Element) => {
            const r = el.getBoundingClientRect(), css = getComputedStyle(el)
            return { x: r.x, y: r.y, width: r.width, height: r.height,
              position: css.position, zIndex: css.zIndex, pointerEvents: css.pointerEvents,
              overflow: css.overflow, display: css.display, visibility: css.visibility }
          }
          const selectors = {
            card: '.card-image', footer: '.card-image > .image-metadata',
            footerEdit: 'button[aria-label="Edit image caption and source"]',
            toolbarEdit: '[data-testid="edit-image-metadata"]',
            toolbar: '[data-testid="selection-bar"]', controls: '[data-testid="canvas-controls"]',
            editor: '[role="dialog"][aria-label="Image caption and source"]',
          }
          const elements = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
            const el = document.querySelector(selector)
            return [name, el ? { element: identify(el), bounds: bounds(el) } : null]
          }))
          const target = document.querySelector(selectors.footerEdit)
          const r = target?.getBoundingClientRect()
          const points = r ? [
            { name: 'center', x: r.x + r.width / 2, y: r.y + r.height / 2 },
            { name: 'top-left-inside', x: r.x + Math.min(2, r.width / 2), y: r.y + Math.min(2, r.height / 2) },
            { name: 'bottom-right-inside', x: r.right - Math.min(2, r.width / 2), y: r.bottom - Math.min(2, r.height / 2) },
          ].map(point => {
            const inViewport = point.x >= 0 && point.x < innerWidth && point.y >= 0 && point.y < innerHeight
            const stack = inViewport ? document.elementsFromPoint(point.x, point.y) : []
            return { ...point, inViewport, targetReceivesPoint: !!stack[0] && (stack[0] === target || target!.contains(stack[0])),
              frontToBack: stack.slice(0, 8).map(identify) }
          }) : []
          return { viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
            visualViewport: visualViewport && { width: visualViewport.width, height: visualViewport.height,
              offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop },
            active: identify(document.activeElement), elements, footerEditHitPoints: points,
            observationTiming: 'After original failure only; no causal claim about earlier geometry' }
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Passive failure observation exceeded 2 seconds')), 2000) }),
      ])
    } catch (error) {
      observations = { unavailable: String(error), noEmptyOrSuccessfulInference: true }
    } finally {
      if (timer) clearTimeout(timer)
    }
    try {
      await info.attach('metadata-footer-after-failure', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' })
    } catch {
      // The original failure remains authoritative even if its context closed.
      console.log('metadata-footer-after-failure', JSON.stringify(observations))
    }
  })
}
