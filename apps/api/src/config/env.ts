/**
 * Process configuration, validated once at startup (fail fast with a readable message).
 * `.env` at the repo root is loaded outside production by `loadEnv()` (see dotenv.ts); production uses `fly secrets`.
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { API_ROOT, loadDotEnv } from './dotenv.js'

export const DEFAULT_CATALOG_COMMIT = '3ab58f1cec6a03e3e85455cf7aade3bb8561f92e'
export const DEFAULT_ENGINE_REV = '33ff2a5942dd4ce09d1ebc3041ffe48f604409e6'

const gitSha = z.string().regex(/^[0-9a-f]{40}$/, 'must be a full 40-character lowercase git sha')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection string'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters (random, base64)'),
  /** Built PWA directory; relative paths resolve from apps/api. */
  WEB_DIST: z.string().min(1).default('../web/dist'),
  CATALOG_COMMIT: gitSha.default(DEFAULT_CATALOG_COMMIT),
  ENGINE_REV: gitSha.default(DEFAULT_ENGINE_REV),
  /** Defaults to true in production (`__Host-session` cookie requires HTTPS). */
  COOKIE_SECURE: z.stringbool().optional(),
  /** Daily backup snapshot into `backup_blobs` (04:00); defaults to on in production only. */
  BACKUP_CRON: z.stringbool().optional(),
  /** Limitless tournament sync (backfill at start, then every 6 h); defaults to on in production only. */
  LIMITLESS_SYNC: z.stringbool().optional(),
  LIMITLESS_BASE_URL: z.url().default('https://play.limitlesstcg.com/api'),
  /** Look at deckgym-core's upstream `main` at most every 12 h (T-010); defaults to on in production only. */
  ENGINE_UPSTREAM_CHECK: z.stringbool().optional(),
  ENGINE_UPSTREAM_URL: z.url().default('https://api.github.com/repos/bcollazo/deckgym-core'),
  /**
   * Fase 39 (P-010): the S3-compatible bucket for the copy outside Supabase. The names are the ones
   * `flyctl storage create` (Tigris) sets as secrets; without the four of them the copy stays only in the database.
   */
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_ENDPOINT_URL_S3: z.url().optional(),
  AWS_REGION: z.string().min(1).default('auto'),
  BUCKET_NAME: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'must be a bucket name without dots (virtual-hosted URLs)')
    .optional(),
  /**
   * Fase 39: the daily cleanup of old replays (04:20). Off by default everywhere: it deletes for good, so it is turned
   * on (`flyctl secrets set RETENTION_CRON=true`) after the owner saw a dry run.
   */
  RETENTION_CRON: z.stringbool().optional(),
  /** Fase 38 (R-011): optional GitHub token for the API checks (5.000 calls an hour instead of 60 per shared IP). */
  GITHUB_TOKEN: z.string().min(10).optional(),
  /** Fase 8: look at the tracker's `main` for new sets (production by default). */
  TRACKER_UPSTREAM_CHECK: z.stringbool().optional(),
  TRACKER_UPSTREAM_URL: z.url().default('https://raw.githubusercontent.com/marcelpanse/tcg-pocket-collection-tracker'),
  /** Fase 40: the tracker on GitHub's API («Actualizar al último del tracker»). */
  TRACKER_API_URL: z.url().default('https://api.github.com/repos/marcelpanse/tcg-pocket-collection-tracker'),
  /** Fase 18: Web Push (VAPID). Without the keys the notifications are off. */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/)/, 'must be mailto: or https://')
    .default('https://tcg-pocket.fly.dev'),
  /** The 15-second check that sends the notifications; defaults to on outside tests. */
  NOTIFICATIONS_WATCH: z.stringbool().optional(),
  /** Express `trust proxy` hops (Fly sits one proxy in front of the app). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  /** Overrides the package.json version reported by /healthz (e.g. the image tag). */
  APP_VERSION: z.string().optional(),
  /** argon2id cost for new password hashes (OWASP minimum by default; the 512 MB machine cannot afford the library defaults). */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).max(1_048_576).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).max(20).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(8).default(1),
})

export interface Env {
  nodeEnv: 'development' | 'test' | 'production'
  isProduction: boolean
  isTest: boolean
  port: number
  databaseUrl: string
  sessionSecret: string
  /** Absolute path. */
  webDist: string
  catalogCommit: string
  engineRev: string
  cookieSecure: boolean
  backupCron: boolean
  limitlessSync: boolean
  limitlessBaseUrl: string
  engineUpstreamCheck: boolean
  trackerUpstreamCheck: boolean
  trackerUpstreamUrl: string
  trackerApiUrl: string
  engineUpstreamUrl: string
  /** Fase 38: sent to api.github.com when set. */
  githubToken: string | null
  /** Fase 39: the daily cleanup runs (off unless RETENTION_CRON=true). */
  retentionCron: boolean
  /** Fase 39: the bucket of the copy outside Supabase (null = off). */
  offsite: { accessKeyId: string; secretAccessKey: string; endpoint: string; region: string; bucket: string } | null
  trustProxy: number
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  version: string
  /** argon2id parameters for new password hashes (`memoryCost` in KiB). */
  argon2: { memoryCost: number; timeCost: number; parallelism: number }
  /** Fase 18: VAPID keys (null = notifications off) and whether the watcher runs. */
  vapid: { publicKey: string; privateKey: string; subject: string } | null
  notificationsWatch: boolean
}

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'EnvError'
  }
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(API_ROOT, 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Validates a raw environment (empty strings count as unset). Throws `EnvError` with one line per problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ''))
  const result = envSchema.safeParse(cleaned)
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`))
  }
  const raw = result.data
  const isProduction = raw.NODE_ENV === 'production'
  return {
    nodeEnv: raw.NODE_ENV,
    isProduction,
    isTest: raw.NODE_ENV === 'test',
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL,
    sessionSecret: raw.SESSION_SECRET,
    webDist: isAbsolute(raw.WEB_DIST) ? raw.WEB_DIST : resolve(API_ROOT, raw.WEB_DIST),
    catalogCommit: raw.CATALOG_COMMIT,
    engineRev: raw.ENGINE_REV,
    cookieSecure: raw.COOKIE_SECURE ?? isProduction,
    backupCron: raw.BACKUP_CRON ?? isProduction,
    limitlessSync: raw.LIMITLESS_SYNC ?? isProduction,
    limitlessBaseUrl: raw.LIMITLESS_BASE_URL.replace(/\/+$/, ''),
    engineUpstreamCheck: raw.ENGINE_UPSTREAM_CHECK ?? isProduction,
    trackerUpstreamCheck: raw.TRACKER_UPSTREAM_CHECK ?? isProduction,
    trackerUpstreamUrl: raw.TRACKER_UPSTREAM_URL.replace(/\/+$/, ''),
    trackerApiUrl: raw.TRACKER_API_URL.replace(/\/+$/, ''),
    engineUpstreamUrl: raw.ENGINE_UPSTREAM_URL.replace(/\/+$/, ''),
    githubToken: raw.GITHUB_TOKEN ?? null,
    retentionCron: raw.RETENTION_CRON ?? false,
    offsite:
      raw.AWS_ACCESS_KEY_ID && raw.AWS_SECRET_ACCESS_KEY && raw.AWS_ENDPOINT_URL_S3 && raw.BUCKET_NAME
        ? {
            accessKeyId: raw.AWS_ACCESS_KEY_ID,
            secretAccessKey: raw.AWS_SECRET_ACCESS_KEY,
            endpoint: raw.AWS_ENDPOINT_URL_S3.replace(/\/+$/, ''),
            region: raw.AWS_REGION,
            bucket: raw.BUCKET_NAME,
          }
        : null,
    trustProxy: raw.TRUST_PROXY,
    logLevel: raw.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    version: raw.APP_VERSION ?? packageVersion(),
    argon2: { memoryCost: raw.ARGON2_MEMORY_KIB, timeCost: raw.ARGON2_TIME_COST, parallelism: raw.ARGON2_PARALLELISM },
    vapid:
      raw.VAPID_PUBLIC_KEY && raw.VAPID_PRIVATE_KEY
        ? { publicKey: raw.VAPID_PUBLIC_KEY, privateKey: raw.VAPID_PRIVATE_KEY, subject: raw.VAPID_SUBJECT }
        : null,
    notificationsWatch: raw.NOTIFICATIONS_WATCH ?? raw.NODE_ENV !== 'test',
  }
}

/** Loads `.env` (non-production) and validates `process.env`. */
export function loadEnv(): Env {
  loadDotEnv()
  return parseEnv(process.env)
}

/** Nest injection token for the validated `Env`. */
export const ENV = 'ENV'
