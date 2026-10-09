export type Env = {
  DB: D1Database
  BUCKET: R2Bucket
  ASSETS?: Fetcher
  ALLOWED_ORIGINS?: string
  DEV_DIAG?: string
  /** HMAC key for image URL tokens (wrangler secret put ASSET_TOKEN_SECRET). */
  ASSET_TOKEN_SECRET?: string
  /** Set by CI on deploy (wrangler deploy --var APP_VERSION:x.y.z). */
  APP_VERSION?: string
  /** Oldest desktop version the API still supports; older apps must update. */
  MIN_CLIENT?: string
}

export type User = { id: string; username: string; isAdmin: boolean }

export type AppEnv = { Bindings: Env; Variables: { user: User; sessionHash: string } }
