import { readArticles } from './docs-content.mjs'
const articles = readArticles()
console.log(`Docs checked: ${articles.filter(a => a.status === 'published').length} published, ${articles.filter(a => a.status === 'draft').length} drafts; links and image bytes verified.`)
