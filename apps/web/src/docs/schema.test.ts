import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docsRoute, publishedArticles, validateArticle, validateLinks, type Article } from './schema.ts'
import { readArticles, imageDimensions, publicArticleSource } from '../../scripts/docs-content.mjs'
const article = (overrides: Partial<Article> = {}): Article => ({
  slug: 'test-guide', category: 'reference', kind: 'reference', title: 'A guide', summary: 'An actual outcome.', status: 'draft', order: 1,
  benefit: 'Useful context.', outcome: 'A visible result.', sections: [{ id: 'start', title: 'Start', paragraphs: ['Instructions.'] }], related: [], ...overrides,
})
describe('public docs boundary', () => {
  it('selects only the entire docs path segment, including unknown deep links', () => {
    for (const path of ['/docs', '/docs/', '/docs/unknown', '/docs/a/b']) expect(docsRoute(path).isDocs).toBe(true)
    for (const path of ['/', '/docs-other', '/s/test', '/join/test', '/signup/test', '/reset/test', '/share']) expect(docsRoute(path).isDocs).toBe(false)
    expect(docsRoute('/docs/test-guide/').slug).toBe('test-guide')
  })
  it('requires explicit publication, valid metadata and nonempty sections', () => {
    for (const value of [article({ slug: '../private' }), article({ category: 'private' as never }), article({ status: undefined }), article({ order: NaN }), article({ summary: '' }), article({ sections: [] }), { ...article(), summery: 'typo' }]) expect(() => validateArticle(value)).toThrow()
    expect(() => validateArticle(article())).not.toThrow()
  })
  it('requires action/result/correction and actual screenshot metadata for published tasks', () => {
    const a = article({ status: 'published', kind: 'task' })
    expect(() => validateArticle(a)).toThrow(/flow and real screenshot/)
    a.sections[0].flow = { entry: 'Select cards.', steps: [{ action: 'Align top.', result: 'Tops match.' }], completion: 'Saved.', correction: 'Undo restores positions.' }
    a.sections[0].figures = [{ src: '/docs/assets/test-guide/aligned.png', alt: 'Aligned cards.', caption: 'The tops match.', width: 1440, height: 900 }]
    expect(() => validateArticle(a)).not.toThrow()
    a.sections[0].flow.correction = ''
    expect(() => validateArticle(a)).toThrow(/correction/)
  })
  it('rejects duplicate anchors, credential-bearing/private images and unsafe links', () => {
    const section = article().sections[0]
    expect(() => validateArticle(article({ sections: [section, section] }))).toThrow(/Duplicate heading/)
    for (const id of ['root', 'dn-theme', 'docs-main', 'docs-navigation']) expect(() => validateArticle(article({ sections: [{ ...section, id }] }))).toThrow(/Reserved heading/)
    for (const src of ['/api/assets/private?t=secret', '/docs/assets/test-guide/../../secret.png', 'https://example.com/x.png']) {
      expect(() => validateArticle(article({ sections: [{ ...section, figures: [{ src, alt: 'Test.', caption: 'Test.', width: 100, height: 100 }] }] }))).toThrow(/canonical/)
    }
    for (const href of ['javascript:alert(1)', '/api/sync', 'http://example.com', '/docs/foo?token=secret']) expect(() => validateArticle(article({ links: [{ label: 'Bad', href }] }))).toThrow(/Invalid links/)
  })
  it('checks published related links and anchors, without publishing draft references', () => {
    const published = article({ status: 'published', links: [{ label: 'Section', href: '/docs/test-guide#start' }] })
    expect(() => validateLinks([published])).not.toThrow()
    expect(() => validateLinks([{ ...published, related: ['draft-guide'] }, article({ slug: 'draft-guide' })])).toThrow(/not published/)
    expect(() => validateLinks([{ ...published, links: [{ label: 'Missing', href: '/docs/test-guide#missing' }] }])).toThrow(/unknown heading/)
    expect(publishedArticles([article({ title: 'Secret draft marker' }), published])).toEqual([published])
  })
  it('fails missing assets even in drafts, and verifies actual dimensions', () => {
    const root = mkdtempSync(join(tmpdir(), 'doggynote-docs-'))
    try {
      mkdirSync(`${root}/docs/assets/test-guide`, { recursive: true })
      const a = article()
      a.sections[0].figures = [{ src: '/docs/assets/test-guide/example.png', alt: 'Synthetic test fixture.', caption: 'Validator fixture, not QA evidence.', width: 1, height: 1 }]
      const content = `${root}/content`; mkdirSync(content)
      writeFileSync(`${content}/test-guide.json`, JSON.stringify(a))
      expect(() => readArticles(content, root)).toThrow(/ENOENT/)
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64')
      writeFileSync(`${root}${a.sections[0].figures[0].src}`, png)
      expect(imageDimensions(png)).toEqual([1,1])
      expect(readArticles(content, root)).toHaveLength(1)
      a.sections[0].figures[0].width = 2
      writeFileSync(`${content}/test-guide.json`, JSON.stringify(a))
      expect(() => readArticles(content, root)).toThrow(/Wrong dimensions/)
      // A dark variant must exist, and match the light one's size.
      a.sections[0].figures[0].width = 1
      a.sections[0].figures[0].darkSrc = '/docs/assets/test-guide/example-dark.png'
      writeFileSync(`${content}/test-guide.json`, JSON.stringify(a))
      expect(() => readArticles(content, root)).toThrow(/ENOENT/)
      writeFileSync(`${root}/docs/assets/test-guide/example-dark.png`, png)
      expect(readArticles(content, root)).toHaveLength(1)
      a.sections[0].figures[0].darkSrc = a.sections[0].figures[0].src
      expect(() => validateArticle(a)).toThrow(/darkSrc/)
      a.sections[0].figures[0].darkSrc = 'https://example.com/x.png'
      expect(() => validateArticle(a)).toThrow(/darkSrc/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('filters drafts before returning article source to the public bundler', () => {
    const source = publicArticleSource([article({ title: 'PRIVATE DRAFT MARKER' }), article({ slug: 'published-guide', status: 'published' })])
    expect(source).not.toContain('PRIVATE DRAFT MARKER')
    expect(source).not.toContain('test-guide')
    const emitted = JSON.parse(source.replace(/^export default /, '')) as Article[]
    expect(emitted).toHaveLength(1)
    expect(emitted.every(a => a.status === 'published')).toBe(true)
  })
})
