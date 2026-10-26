import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { COPY } from '@doggynote/theme'
import articles from 'virtual:docs-content'
import { categories, docsRoute, type Article, type DocLink, type Section } from './schema.ts'
import { createTheme } from '../theme.ts'
import { ThemeToggle } from '../ThemeToggle.tsx'
import { Icon } from '../ui/icons.tsx'
import '../state/device.ts'
import './docs.css'

const href = (article: Article) => `/docs/${article.slug}`
const kinds = { task: 'How-to', explanation: 'Explanation', reference: 'Reference' }

function Links(props: { links: DocLink[] }) {
  return <ul class="docs-links"><For each={props.links}>{link => <li><a href={link.href}>{link.label}</a></li>}</For></ul>
}

function ArticleSection(props: { section: Section }) {
  const s = () => props.section
  return <section class="docs-section" aria-labelledby={s().id}>
    <h2 id={s().id} tabindex="-1"><a href={`#${s().id}`}>{s().title}<span class="docs-anchor" aria-hidden="true"> #</span></a></h2>
    <For each={s().paragraphs}>{paragraph => <p>{paragraph}</p>}</For>
    <Show when={s().flow}>{flow => <div class="docs-flow">
      <p><strong>Start here.</strong> {flow().entry}</p>
      <ol><For each={flow().steps}>{step => <li><p class="docs-action">{step.action}</p><p>{step.result}</p></li>}</For></ol>
      <div class="docs-flow-end"><p><strong>When you’re done.</strong> {flow().completion}</p><p><strong>Change your mind?</strong> {flow().correction}</p></div>
    </div>}</Show>
    <Show when={s().callout}>{callout => <aside class="docs-callout"><strong>{callout().title}</strong><p>{callout().text}</p></aside>}</Show>
    <For each={s().figures}>{figure => <figure><img src={figure.src} alt={figure.alt} width={figure.width} height={figure.height} loading="lazy" decoding="async" /><figcaption>{figure.caption}</figcaption></figure>}</For>
    <Show when={s().links?.length}><Links links={s().links!} /></Show>
  </section>
}

/** The public guides: plain pages, no sign-in, no board and no /api requests. */
export default function Docs() {
  const appearance = createTheme()
  const route = docsRoute(location.pathname)
  const article = articles.find(a => a.slug === route.slug)
  const notFound = !!route.slug && !article
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const results = createMemo(() => articles.filter(a => `${a.title} ${a.summary}`.toLocaleLowerCase().includes(query().trim().toLocaleLowerCase())))
  let trigger!: HTMLButtonElement
  let shell!: HTMLDivElement
  let header!: HTMLElement
  let navigation!: HTMLElement
  const groups = Object.entries(categories).filter(([key]) => articles.some(a => a.category === key))
  const closeMenu = () => { setMenuOpen(false); trigger.focus({ preventScroll: true }) }
  const toggleMenu = () => {
    if (menuOpen()) { closeMenu(); return }
    setMenuOpen(true)
    // Safari doesn't focus a button on click. Move focus into the list it opened.
    queueMicrotask(() => {
      if (menuOpen()) navigation.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true })
    })
  }
  onMount(() => {
    document.documentElement.classList.add('docs-page')
    const previousTitle = document.title
    document.title = `${article?.title ?? (notFound ? 'Guide not found' : 'Guides')} · ${COPY.appName}`
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menuOpen()) { event.preventDefault(); closeMenu() } }
    document.addEventListener('keydown', escape)
    const outside = (event: Event) => {
      if (menuOpen() && event.target instanceof Node && !header.contains(event.target) && !navigation.contains(event.target)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    const sizeHeader = () => shell.style.setProperty('--docs-header-height', `${header.getBoundingClientRect().height}px`)
    sizeHeader()
    const observer = new ResizeObserver(sizeHeader)
    observer.observe(header)
    const mobile = matchMedia('(max-width: 800px)')
    const resize = () => { if (!mobile.matches) setMenuOpen(false) }
    mobile.addEventListener('change', resize)
    if (location.hash) { try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView() } catch { /* a malformed anchor just doesn't scroll */ } }
    onCleanup(() => { document.documentElement.classList.remove('docs-page'); document.title = previousTitle; document.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); observer.disconnect(); mobile.removeEventListener('change', resize) })
  })
  return <div class="docs-shell" ref={shell} data-testid="guides">
    <a class="docs-skip" href="#docs-main">Skip to content</a>
    <header class="docs-header" ref={header}>
      <a class="docs-brand" href="/docs" aria-label={`${COPY.appName} guides home`}><Icon name="guides" size={26} /><span>{COPY.appName}<small>Guides</small></span></a>
      <div class="docs-header-actions">
        <a class="docs-open-app" href="/">Open {COPY.appName}</a>
        <ThemeToggle mode={appearance.mode()} onThemeChange={appearance.setMode} class="docs-theme" />
        <button class="docs-menu-toggle" type="button" ref={trigger} aria-expanded={menuOpen()} aria-controls="docs-navigation" onClick={toggleMenu}><span aria-hidden={menuOpen()} style={{ visibility: menuOpen() ? 'hidden' : 'visible' }}>Browse guides</span><span aria-hidden={!menuOpen()} style={{ visibility: menuOpen() ? 'visible' : 'hidden' }}>Close guides</span></button>
      </div>
    </header>
    <div class="docs-layout">
      <aside ref={navigation} class="docs-sidebar" classList={{ 'is-open': menuOpen() }} id="docs-navigation">
        <nav aria-label="Guides">
          <a class="docs-home-link" href="/docs" aria-current={!route.slug ? 'page' : undefined}>All guides</a>
          <For each={groups}>{([key, label]) => <div class="docs-nav-group"><h2>{label}</h2><ul><For each={articles.filter(a => a.category === key)}>{a => <li><a href={href(a)} aria-current={article?.slug === a.slug ? 'page' : undefined}>{a.title}</a></li>}</For></ul></div>}</For>
        </nav>
      </aside>
      <main id="docs-main" class="docs-main" tabindex="-1">
        <Show when={!route.slug}>
          <div class="docs-landing">
            <h1>{COPY.guides.heading}</h1>
            <p class="docs-lead">Short, practical guides for making yourself at home in {COPY.appName}.</p>
            <label class="docs-search"><span>{COPY.guides.search}</span><input type="search" placeholder="Search titles and summaries…" value={query()} onInput={e => setQuery(e.currentTarget.value)} /></label>
            <div class="docs-section-label"><h2>{query().trim() ? 'Search results' : 'All guides'}</h2><span role="status" aria-live="polite">{results().length} {results().length === 1 ? 'guide' : 'guides'}</span></div>
            <Show when={results().length}><ul class="docs-guide-list"><For each={results()}>{a => <li><a class="docs-guide-row" href={href(a)}><h3>{a.title}</h3><span class="docs-meta">{kinds[a.kind]}</span><p>{a.summary}</p></a></li>}</For></ul></Show>
            <Show when={!results().length}><div class="docs-empty"><h3>{COPY.guides.noMatch}</h3><p>Nothing matches “{query()}”. Try a shorter word, or browse every guide.</p><button type="button" onClick={() => setQuery('')}>Clear search</button></div></Show>
          </div>
        </Show>
        <Show when={article}>{a => <>
          <nav class="docs-breadcrumb" aria-label="Breadcrumb"><a href="/docs">Guides</a><span aria-hidden="true">/</span><span>{categories[a().category]}</span></nav>
          <div class="docs-article-layout"><article class="docs-article">
            <h1>{a().title}</h1><p class="docs-lead">{a().summary}</p>
            <div class="docs-outcome"><p>{a().benefit}</p><p><strong>What you’ll end up with.</strong> {a().outcome}</p></div>
            <Show when={a().prerequisites?.length}><aside class="docs-prerequisites"><h2>Before you start</h2><ul><For each={a().prerequisites}>{p => <li>{p}</li>}</For></ul></aside></Show>
            <nav class="docs-toc docs-toc-inline" aria-label="On this page"><h2>On this page</h2><ol><For each={a().sections}>{s => <li><a href={`#${s.id}`}>{s.title}</a></li>}</For></ol></nav>
            <For each={a().sections}>{s => <ArticleSection section={s} />}</For>
            <Show when={a().links?.length}><Links links={a().links!} /></Show>
            <Show when={a().related.length}><nav class="docs-related" aria-label="Related guides"><h2>Keep exploring</h2><For each={a().related.map(slug => articles.find(p => p.slug === slug)!)}>{related => <a href={href(related)}><strong>{related.title}</strong><span>{related.summary}</span></a>}</For></nav></Show>
          </article><nav class="docs-toc docs-toc-side" aria-label="On this page"><h2>On this page</h2><ol><For each={a().sections}>{s => <li><a href={`#${s.id}`}>{s.title}</a></li>}</For></ol></nav></div>
        </>}</Show>
        <Show when={notFound}><div class="docs-not-found"><h1>{COPY.guides.notFound}</h1><p class="docs-lead">It may have moved, or the address may be incomplete.</p><a class="docs-back-link" href="/docs">Browse all guides</a></div></Show>
        <footer class="docs-footer"><span>{COPY.appName} guides</span><a href="/docs">All guides</a><a href="/">Open {COPY.appName}</a></footer>
      </main>
    </div>
  </div>
}
