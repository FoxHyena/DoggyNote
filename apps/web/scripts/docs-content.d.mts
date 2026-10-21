import type { Plugin } from 'vite'
import type { Article } from '../src/docs/schema.ts'
export const contentDirectory: string
export function imageDimensions(bytes: Buffer): [number, number]
export function readArticles(directory?: string, publicDirectory?: string): Article[]
export function publicArticleSource(articles: Article[]): string
export function docsContentPlugin(): Plugin
