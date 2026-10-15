import { isAbsolute } from 'node:path'
import { DEFAULT_CATALOG_COMMIT, DEFAULT_ENGINE_REV, EnvError, parseEnv } from './env.js'

const base = {
  DATABASE_URL: 'postgresql://tcg:tcg@127.0.0.1:5433/tcg',
  SESSION_SECRET: 'x'.repeat(32),
}
/** Production requires a verified connection to the database. */
const production = { ...base, NODE_ENV: 'production', DATABASE_URL: `${base.DATABASE_URL}?sslmode=verify-full` }

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base)
    expect(env.nodeEnv).toBe('development')
    expect(env.trackerCollectionAnonKey).toBe('')
    expect(env.port).toBe(3000)
    expect(env.catalogCommit).toBe(DEFAULT_CATALOG_COMMIT)
    expect(env.engineRev).toBe(DEFAULT_ENGINE_REV)
    expect(env.cookieSecure).toBe(false)
    expect(env.trustProxy).toBe(1)
    expect(env.logLevel).toBe('debug')
    expect(isAbsolute(env.webDist)).toBe(true)
    expect(env.webDist.replace(/\\/g, '/')).toMatch(/apps\/web\/dist$/)
  })

  it('defaults COOKIE_SECURE to true in production and lets the variable override it', () => {
    expect(parseEnv(production).cookieSecure).toBe(true)
    expect(parseEnv({ ...production, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false)
    expect(parseEnv({ ...base, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true)
    expect(parseEnv(base).backupCron).toBe(false)
    expect(parseEnv(production).backupCron).toBe(true)
    expect(parseEnv({ ...production, BACKUP_CRON: 'false' }).backupCron).toBe(false)
    expect(parseEnv({ ...base, BACKUP_CRON: 'true' }).backupCron).toBe(true)
  })

  it('in production only with sslmode=verify-full, unless DATABASE_TLS=off (trying the image)', () => {
    for (const mode of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=prefer', '?sslmode=disable']) {
      expect(() => parseEnv({ ...production, DATABASE_URL: `${base.DATABASE_URL}${mode}` })).toThrow(
        /sslmode=verify-full/,
      )
      expect(parseEnv({ ...base, DATABASE_URL: `${base.DATABASE_URL}${mode}` }).isProduction).toBe(false)
    }
    expect(parseEnv(production).databaseUrl).toContain('sslmode=verify-full')
    expect(parseEnv({ ...production, DATABASE_URL: base.DATABASE_URL, DATABASE_TLS: 'off' }).isProduction).toBe(true)
    expect(() => parseEnv({ ...base, DATABASE_TLS: 'on' })).toThrow(EnvError)
  })

  it('treats empty strings as unset', () => {
    expect(parseEnv({ ...base, PORT: '', LOG_LEVEL: '' }).port).toBe(3000)
  })

  it('keeps absolute WEB_DIST and resolves relative ones from apps/api', () => {
    const abs = process.platform === 'win32' ? 'C:\\srv\\web' : '/srv/web'
    expect(parseEnv({ ...base, WEB_DIST: abs }).webDist).toBe(abs)
    expect(parseEnv({ ...base, WEB_DIST: 'public' }).webDist.replace(/\\/g, '/')).toMatch(/apps\/api\/public$/)
  })

  it('fails fast with one readable line per problem', () => {
    let error: unknown
    try {
      parseEnv({ DATABASE_URL: 'mysql://x', SESSION_SECRET: 'short', PORT: 'abc', CATALOG_COMMIT: 'abc' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(EnvError)
    const issues = (error as EnvError).issues
    expect(issues.some((line) => line.startsWith('DATABASE_URL:'))).toBe(true)
    expect(issues.some((line) => line.startsWith('SESSION_SECRET:'))).toBe(true)
    expect(issues.some((line) => line.startsWith('PORT:'))).toBe(true)
    expect(issues.some((line) => line.startsWith('CATALOG_COMMIT:'))).toBe(true)
    expect((error as EnvError).message).toContain('Invalid environment')
  })

  it('requires DATABASE_URL and SESSION_SECRET', () => {
    expect(() => parseEnv({})).toThrow(EnvError)
  })
})
