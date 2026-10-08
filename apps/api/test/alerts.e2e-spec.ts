import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TrackerUpstreamService } from '../src/alerts/alerts.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { todayInOwnerZone } from '../src/config/time-zone.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** Fase 8: the alerts (a new set in the tracker, a limited pack ending), with a fake tracker. */
const TYPES_INDEX = join(REPO_ROOT, 'packages/domain/test/fixtures/tracker/types.index.ts')

describe('alerts (e2e)', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)

  it('nothing to say by default (no upstream checks outside production)', async () => {
    const response = await get('/api/alerts')
    expect(response.status).toBe(200)
    expect(response.body.items.filter((item: { code: string }) => item.code === 'new_set')).toEqual([])
  })

  it('a set the tracker has and the catalog does not; a limited pack in its last week', async () => {
    const tracker = test.app.get(TrackerUpstreamService)
    test.env.trackerUpstreamCheck = true
    const source = readFileSync(TYPES_INDEX, 'utf8').replace(/expansionIds\s*=\s*\[/, "expansionIds = [\n  'B5',")
    let calls = 0
    tracker.fetchImpl = (async (url: string | URL) => {
      calls++
      expect(String(url)).toMatch(/\/main\/frontend\/src\/types\/index\.ts$/)
      return new Response(source, { status: 200 })
    }) as typeof fetch
    const today = todayInOwnerZone()
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000)
    await test.prisma.pack.update({
      where: { id: 'B4b/deluxepackmega' },
      data: { limited: true, available: true, limitedUntil: soon },
    })

    const items = (await get('/api/alerts')).body.items as {
      code: string
      level: string
      title: string
      link: string
    }[]
    expect(items.find((item) => item.code === 'new_set')).toMatchObject({
      level: 'warning',
      title: 'Set nuevo en el tracker: B5',
      link: '/mas/catalogo',
    })
    expect(items.find((item) => item.code === 'limited_pack')?.title).toMatch(/quedan 3 días$/)
    // Cached for 12 hours: one fetch.
    await get('/api/alerts')
    expect(calls).toBe(1)
    test.env.trackerUpstreamCheck = false
  })
})
