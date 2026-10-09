export type Env = {
  DB: D1Database
  BUCKET: R2Bucket
  ASSETS?: Fetcher
  ALLOWED_ORIGINS?: string
  DEV_DIAG?: string
}

export type User = { id: string; username: string; isAdmin: boolean }

export type AppEnv = { Bindings: Env; Variables: { user: User; sessionHash: string } }
