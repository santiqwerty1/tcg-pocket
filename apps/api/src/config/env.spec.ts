import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { API_ROOT } from './dotenv.js'
import { DEFAULT_CATALOG_COMMIT, DEFAULT_ENGINE_REV, EnvError, parseEnv } from './env.js'

const base = {
  DATABASE_URL: 'postgresql://tcg:tcg@127.0.0.1:5433/tcg',
  SESSION_SECRET: 'x'.repeat(32),
}

describe('the engine pin (D-031, review of #115)', () => {
  const repo = (path: string) => readFileSync(resolve(API_ROOT, '..', '..', path), 'utf8')

  it('DEFAULT_ENGINE_REV is the deckgym rev of both Cargo.toml, of the golden games and of the texts that name it', () => {
    for (const manifest of ['engine/Cargo.toml', 'engine/wasm/Cargo.toml']) {
      expect(/^deckgym = \{[^}]*rev = "([0-9a-f]{40})"/m.exec(repo(manifest))?.[1]).toBe(DEFAULT_ENGINE_REV)
    }
    for (const golden of ['engine/games-rev.json', 'engine/wasm/games-wasm.json']) {
      expect(JSON.parse(repo(golden)).engineRev).toBe(DEFAULT_ENGINE_REV)
    }
    expect(repo('apps/web/src/pages/mas/AboutPage.tsx')).toContain(`>${DEFAULT_ENGINE_REV.slice(0, 7)}</code>`)
    expect(repo('docs/LICENCIAS.md')).toContain(DEFAULT_ENGINE_REV)
  })
})

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
    expect(parseEnv({ ...base, NODE_ENV: 'production' }).cookieSecure).toBe(true)
    expect(parseEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookieSecure).toBe(false)
    expect(parseEnv({ ...base, COOKIE_SECURE: 'true' }).cookieSecure).toBe(true)
    expect(parseEnv(base).backupCron).toBe(false)
    expect(parseEnv({ ...base, NODE_ENV: 'production' }).backupCron).toBe(true)
    expect(parseEnv({ ...base, NODE_ENV: 'production', BACKUP_CRON: 'false' }).backupCron).toBe(false)
    expect(parseEnv({ ...base, BACKUP_CRON: 'true' }).backupCron).toBe(true)
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
