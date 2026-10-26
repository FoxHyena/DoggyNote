/** Public content has no executable markup and no private application imports. */
export const categories = {
  'getting-started': 'Getting started',
  'working-on-boards': 'Working on boards',
  'research-media': 'Research & media',
  'writing-drawing': 'Writing & drawing',
  sharing: 'Sharing',
  reference: 'Reference',
} as const
export type DocLink = { label: string; href: string }
/** `darkSrc` is the same shot in the dark theme, at the same size; readers see the one matching their appearance. */
export type Figure = { src: string; darkSrc?: string; alt: string; caption: string; width: number; height: number }
export type Section = {
  id: string; title: string; paragraphs?: string[]; links?: DocLink[]
  callout?: { title: string; text: string }
  flow?: { entry: string; steps: { action: string; result: string }[]; completion: string; correction: string }
  figures?: Figure[]
}
export type Article = {
  slug: string; category: keyof typeof categories; kind: 'task' | 'explanation' | 'reference'
  title: string; summary: string; status: 'draft' | 'published'; order: number
  benefit: string; outcome: string; prerequisites?: string[]; keywords?: string[]; sections: Section[]; related: string[]; links?: DocLink[]
}
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const list = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0

/** Fail author mistakes at the boundary, before drafts or HTML can enter public data. */
export function validateArticle(value: unknown): asserts value is Article {
  function require(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
  require(record(value), 'Article must be an object')
  const fields = ['slug', 'category', 'kind', 'title', 'summary', 'status', 'order', 'benefit', 'outcome', 'prerequisites', 'keywords', 'sections', 'related', 'links']
  require(Object.keys(value).every(k => fields.includes(k)), 'Unknown article field')
  for (const key of ['slug', 'title', 'summary', 'benefit', 'outcome']) require(text(value[key]), `${key} is required`)
  require(slugPattern.test(value.slug as string), 'Invalid slug')
  require(Object.hasOwn(categories, value.category as string), 'Unknown category')
  require(['task', 'explanation', 'reference'].includes(value.kind as string), 'Unknown kind')
  require(['draft', 'published'].includes(value.status as string), 'Explicit draft/published status required')
  require(typeof value.order === 'number' && Number.isFinite(value.order), 'order must be finite')
  require((value.title as string).length <= 120 && (value.summary as string).length <= 240, 'Title/summary too long')
  const strings = (v: unknown) => list(v) && v.every(text)
  if (value.prerequisites !== undefined) require(strings(value.prerequisites), 'prerequisites must contain text')
  // Other words people search with, such as "color" or "photo"; never shown.
  if (value.keywords !== undefined) require(strings(value.keywords), 'keywords must contain text')
  const links = (v: unknown) => Array.isArray(v) && v.every(l => record(l) && text(l.label) && text(l.href) && (/^https:\/\/[^\s]+$/.test(l.href) || /^\/docs(?:\/[a-z0-9-]+)?(?:#[a-z0-9-]+)?$/.test(l.href)))
  if (value.links !== undefined) require(links(value.links), 'Invalid links (use /docs links or https)')
  require(Array.isArray(value.related) && value.related.every(s => text(s) && slugPattern.test(s)), 'related must contain slugs')
  require(list(value.sections), 'sections required')
  const ids = new Set<string>()
  let flows = 0, figures = 0
  for (const section of value.sections) {
    require(record(section) && text(section.id) && slugPattern.test(section.id) && text(section.title), 'Section id/title required')
    require(!['root', 'dn-theme', 'docs-main', 'docs-navigation'].includes(section.id), `Reserved heading id ${section.id}`)
    require(!ids.has(section.id), `Duplicate heading ${section.id}`); ids.add(section.id)
    require(Object.keys(section).every(k => ['id','title','paragraphs','links','callout','flow','figures'].includes(k)), 'Unknown section field')
    require(['paragraphs','links','callout','flow','figures'].some(k => section[k] !== undefined), 'Empty section')
    if (section.paragraphs !== undefined) require(strings(section.paragraphs), 'paragraphs must contain text')
    if (section.links !== undefined) require(links(section.links) && list(section.links), 'Section links must contain valid links')
    if (section.callout !== undefined) require(record(section.callout) && text(section.callout.title) && text(section.callout.text), 'Callout title/text required')
    if (section.flow !== undefined) {
      const f = section.flow
      require(record(f) && text(f.entry) && text(f.completion) && text(f.correction) && list(f.steps), 'Flow requires entry, steps, completion, correction')
      require(f.steps.every(s => record(s) && text(s.action) && text(s.result)), 'Every step needs action/result'); flows++
    }
    if (section.figures !== undefined) {
      require(list(section.figures), 'figures must not be empty')
      for (const f of section.figures) {
        const asset = new RegExp(`^/docs/assets/${value.slug}/[a-z0-9-]+\\.(png|webp)$`)
        require(record(f) && text(f.src) && asset.test(f.src), 'Figure must use canonical article asset path')
        require(Object.keys(f).every(k => ['src','darkSrc','alt','caption','width','height'].includes(k)), 'Unknown figure field')
        if (f.darkSrc !== undefined) require(text(f.darkSrc) && asset.test(f.darkSrc) && f.darkSrc !== f.src, 'darkSrc must be a separate canonical article asset')
        require(text(f.alt) && text(f.caption), 'Figure alt/caption required')
        require(Number.isInteger(f.width) && Number.isInteger(f.height) && (f.width as number) > 0 && (f.height as number) > 0 && (f.width as number) <= 1600, 'Figure dimensions required; max width 1600'); figures++
      }
    }
  }
  if (value.status === 'published' && value.kind === 'task') require(flows > 0 && figures > 0, 'Published task requires action/result flow and real screenshot')
}

export function publishedArticles(articles: Article[]) {
  return articles.filter(a => a.status === 'published').sort((a,b) => a.order - b.order || a.title.localeCompare(b.title))
}
export function validateLinks(articles: Article[]) {
  const published = publishedArticles(articles)
  for (const a of published) {
    for (const slug of a.related) if (!published.some(p => p.slug === slug)) throw new Error(`${a.slug}: related guide ${slug} is not published`)
    for (const link of [...a.links ?? [], ...a.sections.flatMap(s => s.links ?? [])]) {
      if (!link.href.startsWith('/docs')) continue
      const [path, anchor] = link.href.split('#')
      const target = path === '/docs' ? undefined : published.find(p => `/docs/${p.slug}` === path)
      if (path !== '/docs' && !target) throw new Error(`${a.slug}: broken internal link ${link.href}`)
      if (anchor && (!target || !target.sections.some(s => s.id === anchor))) throw new Error(`${a.slug}: unknown heading ${link.href}`)
    }
  }
}
export function docsRoute(path: string): { isDocs: boolean; slug?: string } {
  if (path !== '/docs' && !path.startsWith('/docs/')) return { isDocs: false }
  return { isDocs: true, slug: path.replace(/^\/docs\/?/, '').replace(/\/$/, '') || undefined }
}
