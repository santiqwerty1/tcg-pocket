/**
 * Process configuration, validated once at startup (fail fast with a readable message).
 * `.env` at the repo root is loaded outside production by `loadEnv()` (see dotenv.ts); production uses `fly secrets`.
 */
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { API_ROOT, loadDotEnv } from './dotenv.js'

export const DEFAULT_CATALOG_COMMIT = '3ab58f1cec6a03e3e85455cf7aade3bb8561f92e'
export const DEFAULT_ENGINE_REV = 'fb792ebfbaca995af9750c28101ce92a51282825'

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
  /** Express `trust proxy` hops (Fly sits one proxy in front of the app). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  /** Overrides the package.json version reported by /healthz (e.g. the image tag). */
  APP_VERSION: z.string().optional(),
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
  trustProxy: number
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  version: string
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
    trustProxy: raw.TRUST_PROXY,
    logLevel: raw.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
    version: raw.APP_VERSION ?? packageVersion(),
  }
}

/** Loads `.env` (non-production) and validates `process.env`. */
export function loadEnv(): Env {
  loadDotEnv()
  return parseEnv(process.env)
}

/** Nest injection token for the validated `Env`. */
export const ENV = 'ENV'
