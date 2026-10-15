import { resolve } from 'node:path'
import { migrationUrl } from '../../prisma.config.js'

/** The migrations' URL: Prisma's engine reads neither `verify-full` nor `NODE_EXTRA_CA_CERTS`. */
describe('the URL of the migrations', () => {
  const ca = resolve('/app/apps/api/certs/supabase-prod-ca-2021.crt')
  // The pooler's shape (a dotted user), on a host for tests.
  const pooler = 'postgresql://postgres.ref:clave@pooler.test:5432/postgres'

  it('turns verify-full into what Prisma checks: strict, with the CA', () => {
    const url = new URL(migrationUrl(`${pooler}?sslmode=verify-full`, ca))
    expect(url.searchParams.get('sslmode')).toBe('require')
    expect(url.searchParams.get('sslaccept')).toBe('strict')
    expect(url.searchParams.get('sslcert')).toBe(ca)
    expect(url.host).toBe('pooler.test:5432')
    expect(url.username).toBe('postgres.ref')
    expect(url.password).toBe('clave')
    expect(url.pathname).toBe('/postgres')
  })

  it('stays strict without a CA file: the system roots, so a private CA fails instead of being accepted', () => {
    const url = new URL(migrationUrl(`${pooler}?sslmode=verify-full`, undefined))
    expect(url.searchParams.get('sslaccept')).toBe('strict')
    expect(url.searchParams.has('sslcert')).toBe(false)
  })

  it('keeps the other parameters of the URL', () => {
    const url = new URL(migrationUrl(`${pooler}?sslmode=verify-full&connect_timeout=10`, ca))
    expect(url.searchParams.get('connect_timeout')).toBe('10')
  })

  it('takes the CA of the URL (sslrootcert) before NODE_EXTRA_CA_CERTS, and makes a relative one absolute', () => {
    const own = resolve('/certs/own.crt')
    const url = new URL(migrationUrl(`${pooler}?sslmode=verify-full&sslrootcert=${encodeURIComponent(own)}`, ca))
    expect(url.searchParams.get('sslcert')).toBe(own)
    expect(url.searchParams.has('sslrootcert')).toBe(false)
    const relative = new URL(migrationUrl(`${pooler}?sslmode=verify-full`, 'apps/api/certs/ca.crt'))
    expect(relative.searchParams.get('sslcert')).toBe(resolve('apps/api/certs/ca.crt'))
  })

  it('in production only verify-full: anything else throws, unless DATABASE_TLS=off (trying the image)', () => {
    for (const mode of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=prefer', '?sslmode=disable']) {
      expect(() => migrationUrl(`${pooler}${mode}`, ca, true)).toThrow(/sslmode=verify-full/)
    }
    expect(migrationUrl(`${pooler}?sslmode=verify-full`, ca, true)).toContain('sslaccept=strict')
    expect(migrationUrl(pooler, ca, true, true)).toBe(pooler)
    expect(() => migrationUrl('not a url', ca, true)).toThrow(/sslmode=verify-full/)
  })

  it('is what the default config gives Prisma (DATABASE_URL, NODE_EXTRA_CA_CERTS, NODE_ENV, DATABASE_TLS)', async () => {
    vi.stubEnv('DATABASE_URL', `${pooler}?sslmode=verify-full`)
    vi.stubEnv('NODE_EXTRA_CA_CERTS', ca)
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DATABASE_TLS', '')
    try {
      vi.resetModules()
      const config = (await import('../../prisma.config.js')).default
      const url = new URL(String(config.datasource?.url))
      expect(url.searchParams.get('sslaccept')).toBe('strict')
      expect(url.searchParams.get('sslcert')).toBe(ca)
      vi.stubEnv('DATABASE_URL', pooler)
      vi.resetModules()
      await expect(import('../../prisma.config.js')).rejects.toThrow(/sslmode=verify-full/)
      vi.stubEnv('DATABASE_TLS', 'off')
      vi.resetModules()
      expect((await import('../../prisma.config.js')).default.datasource?.url).toBe(pooler)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('leaves any other URL as it is (local, tests, the build’s placeholder)', () => {
    for (const url of [
      'postgresql://tcg:tcg@127.0.0.1:5433/tcg',
      `${pooler}?sslmode=require`,
      'postgresql://unset:unset@localhost:5432/unset',
      'not a url',
    ]) {
      expect(migrationUrl(url, ca)).toBe(url)
    }
  })
})
