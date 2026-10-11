import { createServer, type Server } from 'node:http'
import { gunzipSync } from 'node:zlib'
import webpush from 'web-push'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { TrackerClient } from '../src/collection/tracker-client.js'
import { TRACKER_SYNC_INTERVAL_MS, TrackerSync } from '../src/collection/tracker-sync.service.js'
import { PushSender } from '../src/notifications/notifications.service.js'
import { NotificationsWatcher } from '../src/notifications/notifications.watcher.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

const FRIEND = '5080397634069511'
type Row = { internal_id: number; amount_owned: number | null; collected: boolean | null }
describe('tracker collection sync (local HTTP tracker only)', () => {
  let test: TestApp
  let server: Server
  let cookie: string
  let remote: Row[] = []
  let countOverride: number | null = null
  let httpError = 0
  let pageCap = 500
  const calls: { method: string; url: URL; headers: Record<string, unknown> }[] = []
  const sent: { title: string; body: string }[] = []
  const row = (amount: number, id = 65600): Row => ({ internal_id: id, amount_owned: amount, collected: amount > 0 })
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const setting = (key: string, value: unknown) =>
    test.http().put(`/api/settings/${key}`).set('Cookie', cookie).send({ value })
  const preview = () => post('/api/collection/tracker-sync/preview').send({})
  const apply = (id: string) => post('/api/collection/tracker-sync/apply').send({ id })
  const seedStock = (amount: number) =>
    test.prisma.collectionStock.upsert({
      where: { cardId: 'A1-1' },
      create: { cardId: 'A1-1', amountOwned: amount, collected: true, source: 'manual' },
      update: { amountOwned: amount, collected: true },
    })

  beforeAll(async () => {
    const keys = webpush.generateVAPIDKeys()
    process.env.VAPID_PUBLIC_KEY = keys.publicKey
    process.env.VAPID_PRIVATE_KEY = keys.privateKey
    test = await createTestApp()
    test.env.notificationsWatch = false
    await seedOwner(test.app, { totp: false })
    cookie = await login(test)
    await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    test.app.get(PushSender).send = async (_subscription, payload) => {
      sent.push(JSON.parse(payload))
    }
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://tracker.test')
      calls.push({ method: req.method ?? '', url, headers: req.headers })
      if (httpError) {
        res.writeHead(httpError)
        res.end()
        return
      }
      if (req.method === 'HEAD') {
        res.setHeader('Content-Range', `*/${countOverride ?? remote.length}`)
        res.end()
        return
      }
      const after = Number(url.searchParams.get('internal_id')?.slice(3) ?? -1)
      const page = remote
        .filter((r) => r.internal_id > after)
        .slice(0, Math.min(pageCap, Number(url.searchParams.get('limit'))))
      res.writeHead(206, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(page))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no tracker port')
    test.env.trackerCollectionUrl = `http://127.0.0.1:${address.port}`
    test.env.trackerCollectionAnonKey = 'public-test-key'
  })
  beforeEach(async () => {
    remote = [row(3)]
    countOverride = null
    httpError = 0
    pageCap = 500
    calls.length = 0
    sent.length = 0
    await test.prisma.collectionStock.deleteMany()
    await test.prisma.collectionAdjustment.deleteMany()
    await test.prisma.collectionImport.deleteMany()
    await test.prisma.appSetting.deleteMany({ where: { key: { startsWith: 'tracker' } } })
    await setting('trackerFriendId', FRIEND)
  })
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await test.close()
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
  })

  it('requires authentication and validates the saved friend id and automatic switch', async () => {
    expect((await test.http().post('/api/collection/tracker-sync/preview')).status).toBe(401)
    expect((await setting('trackerFriendId', 'bad')).status).toBe(400)
    expect((await setting('trackerAutoSync', 'true')).status).toBe(400)
    expect((await get('/api/collection/tracker-sync/status')).body.enabled).toBe(false)
    await setting('trackerFriendId', '')
    expect((await preview()).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
  it('paginates 501 rows by internal_id, preserves twins, previews the common diff and applies that stored snapshot', async () => {
    const index = test.app.get(CatalogService).requireIndex()
    remote = index.catalog.stockUnits
      .slice(0, 501)
      .map((u) => row(1, index.cardById(u.id)?.internalId ?? -1))
      .sort((a, b) => a.internal_id - b.internal_id)
    remote.push(row(2, 2147483647))
    const response = await preview()
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      source: 'tracker',
      dedupTotal: 501,
      unknownIds: ['internal_id:2147483647'],
      summary: { newUnits: 501 },
    })
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET', 'GET', 'GET'])
    expect(calls[2]?.url.searchParams.get('internal_id')).toBe(`gt.${remote[499]?.internal_id}`)
    expect(calls[0]?.headers.prefer).toBe('count=exact')
    expect(calls[1]?.headers.apikey).toBe('public-test-key')
    expect(calls[1]?.headers.authorization).toBe('Bearer public-test-key')
    expect(calls[1]?.headers['user-agent']).toContain('tcg-pocket/')
    expect(calls.every((c) => c.url.searchParams.get('friend_id') === `eq.${FRIEND}`)).toBe(true)
    expect((await get('/api/collection/summary')).body.copies).toBe(0)
    remote = [] // Applying never fetches the remote again.
    const result = await apply(response.body.id)
    expect(result.status).toBe(200)
    expect(result.body.summary).toEqual(response.body.summary)
    expect(calls).toHaveLength(4)
    expect((await get('/api/collection/summary')).body.copies).toBe(501)
    expect((await test.prisma.collectionImport.findFirst())?.source).toBe('tracker')
    expect((await test.prisma.collectionStock.findFirst())?.source).toBe('tracker')
    expect((await apply(response.body.id)).status).toBe(409)
  })
  it('continues from the actual last id when the server caps a 206 page below 500', async () => {
    const index = test.app.get(CatalogService).requireIndex()
    remote = index.catalog.stockUnits
      .slice(0, 5)
      .map((u) => row(1, index.cardById(u.id)?.internalId ?? -1))
      .sort((a, b) => a.internal_id - b.internal_id)
    pageCap = 2
    expect((await preview()).status).toBe(200)
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET', 'GET', 'GET', 'GET'])
  })
  it('aborts incomplete counts before creating a revision or changing the collection, with an alert', async () => {
    await seedStock(100)
    countOverride = 2
    const response = await preview()
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('tracker_count')
    expect(await test.prisma.collectionImport.count()).toBe(0)
    expect((await get('/api/collection/summary')).body.copies).toBe(100)
    expect((await get('/api/alerts')).body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'tracker_sync' })]),
    )
  })
  it('surfaces a changed public key (401) without retrying, and leaves CSV import usable', async () => {
    httpError = 401
    const response = await preview()
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('tracker_auth')
    expect(calls).toHaveLength(1)
    const csv = await post('/api/collection/imports').send({
      csv: 'Id,InternalId,NumberOwned,Collected\nA1-1,65600,2,TRUE',
    })
    expect(csv.status).toBe(201)
    expect((await post(`/api/collection/imports/${csv.body.id}/apply`)).status).toBe(200)
    expect((await get('/api/collection/summary')).body.copies).toBe(2)
  })
  it('bounds transient HTTP retries to three attempts', async () => {
    httpError = 500
    expect((await preview()).body.error.code).toBe('tracker_network')
    expect(calls).toHaveLength(3)
  })

  it('bounds network/timeout retries and sends an abort signal on every attempt', async () => {
    const client = test.app.get(TrackerClient)
    const original = client.fetchImpl
    const signals: AbortSignal[] = []
    client.fetchImpl = async (_input, init) => {
      if (!(init?.signal instanceof AbortSignal)) throw new Error('missing timeout signal')
      signals.push(init.signal)
      throw new DOMException('simulated timeout', 'TimeoutError')
    }
    try {
      expect((await preview()).body.error.code).toBe('tracker_network')
      expect(signals).toHaveLength(3)
      expect(await test.prisma.collectionImport.count()).toBe(0)
    } finally {
      client.fetchImpl = original
    }
  })

  it('serializes manual previews across instances without making a second tracker request', async () => {
    const client = test.app.get(TrackerClient)
    const original = client.fetchImpl
    let started: () => void = () => undefined
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    client.fetchImpl = async (input, init) => {
      started()
      await gate
      return original(input, init)
    }
    const first = preview().then((response) => response)
    try {
      await waiting
      expect((await preview()).body.error.code).toBe('tracker_busy')
      expect(calls).toHaveLength(0)
      release()
      expect((await first).status).toBe(200)
    } finally {
      release()
      client.fetchImpl = original
    }
  })

  it('rejects duplicate/unordered internal ids instead of allowing a cursor loop', async () => {
    remote = [row(1, 65600), row(2, 65600)]
    expect((await preview()).body.error.code).toBe('tracker_data')
    expect(calls).toHaveLength(2)
    expect(await test.prisma.collectionImport.count()).toBe(0)
  })
  it('zeroes missing rows and shows increases/decreases; manual apply accepts a reviewed large drop', async () => {
    await seedStock(100)
    remote = []
    const response = await preview()
    expect(response.body).toMatchObject({
      summary: { zeroedUnits: 1 },
      tracker: { decreased: 1, removedCopies: 100, requiresReview: true },
    })
    expect((await apply(response.body.id)).status).toBe(200)
    expect((await get('/api/collection/summary')).body.copies).toBe(0)
  })
  it('refuses a stale preview after manual/MCP stock writes or adjustment changes', async () => {
    const response = await preview()
    await seedStock(10)
    expect((await apply(response.body.id)).body.error.code).toBe('tracker_stale_preview')
    const second = await preview()
    await post('/api/collection/adjustments').send({ functionalGroupId: 'A1-1', playableCopies: 9, reason: 'manual' })
    expect((await apply(second.body.id)).body.error.code).toBe('tracker_stale_preview')
    expect((await get(`/api/collection/imports/${second.body.id}`)).body.summary).toEqual(second.body.summary)
  })
  it('refuses a preview after a catalog sync/remap, even at the same tracker commit', async () => {
    const response = await preview()
    await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect((await apply(response.body.id)).body.error.code).toBe('tracker_stale_preview')
  })
  it('automatic is off by default; applies at exactly 10%, skips more than 10% and never queries sooner than 6 h', async () => {
    const sync = test.app.get(TrackerSync)
    const now = new Date('2026-10-11T15:00:00Z')
    expect(await sync.tick(now)).toBeNull()
    expect(calls).toHaveLength(0)
    await setting('trackerAutoSync', true)
    await seedStock(100)
    remote = [row(90)]
    expect(await sync.tick(now)).not.toBeNull()
    expect((await get('/api/collection/summary')).body.copies).toBe(90)
    const count = calls.length
    expect(await sync.tick(new Date(now.getTime() + TRACKER_SYNC_INTERVAL_MS - 1))).toBeNull()
    expect(calls).toHaveLength(count)
    remote = [row(80)]
    const guarded = await sync.tick(new Date(now.getTime() + TRACKER_SYNC_INTERVAL_MS))
    expect(guarded?.tracker?.requiresReview).toBe(true)
    expect((await get('/api/collection/summary')).body.copies).toBe(90)
    expect((await get('/api/collection/tracker-sync/status')).body.result).toBe('review')
    expect((await test.prisma.collectionImport.findFirst({ orderBy: { id: 'desc' } }))?.status).toBe('pending')
    expect((await get('/api/alerts')).body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'tracker_sync' })]),
    )
    expect(
      (
        await post('/api/notifications/subscribe').send({
          endpoint: 'https://push.example.test/tracker',
          keys: { p256dh: 'fake-public-key-for-test', auth: 'fake' },
        })
      ).status,
    ).toBe(204)
    await test.app.get(NotificationsWatcher).tick()
    expect(sent.some((s) => s.title.includes('tracker'))).toBe(true)
    expect((await apply(guarded?.id ?? '')).status).toBe(200)
    expect((await get('/api/alerts')).body.items.some((a: { code: string }) => a.code === 'tracker_sync')).toBe(false)
  })
  it('automatic count failure leaves stock unchanged and reserves the 6 h interval across service instances', async () => {
    await setting('trackerAutoSync', true)
    await seedStock(100)
    countOverride = 2
    const now = new Date('2026-10-11T15:00:00Z')
    await test.app.get(TrackerSync).tick(now)
    const count = calls.length
    expect((await get('/api/collection/tracker-sync/status')).body.result).toBe('error')
    await test.app.get(TrackerSync).tick(new Date(now.getTime() + 60_000))
    expect(calls).toHaveLength(count)
    expect((await get('/api/collection/summary')).body.copies).toBe(100)
  })
  it('backs up and restores tracker settings, state, source, snapshots and the original diff (v8)', async () => {
    const response = await preview()
    await apply(response.body.id)
    const exported = await get('/api/backup/export').responseType('blob')
    const bytes = Buffer.from(exported.body)
    const document = JSON.parse(gunzipSync(bytes).toString())
    expect(document.schemaVersion).toBe(8)
    expect(document.collection.imports[0]).toMatchObject({
      source: 'tracker',
      diffSummary: { tracker: { friendId: FRIEND } },
    })
    expect(document.collection.stock[0].source).toBe('tracker')
    await setting('trackerFriendId', '')
    const restored = await post('/api/backup/import?mode=replace').attach('file', bytes, 'backup.json.gz')
    expect(restored.status).toBe(200)
    expect((await get('/api/collection/tracker-sync/status')).body).toMatchObject({
      friendId: FRIEND,
      result: 'applied',
    })
    expect((await get(`/api/collection/imports/${response.body.id}`)).body.summary).toEqual(response.body.summary)
  })
})
