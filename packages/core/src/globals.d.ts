// The few runtime globals core uses. They exist in browsers, Workers and Node,
// and declaring them here keeps the DOM lib (and DOM APIs) out of this package.
declare const crypto: { randomUUID(): string }
declare class URL {
  constructor(url: string, base?: string)
  readonly href: string
  readonly protocol: string
  readonly hostname: string
  readonly pathname: string
}
declare function structuredClone<T>(v: T): T
