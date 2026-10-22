import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { parseTrackerCsv } from '@tcg/domain'
import { BackupService } from '../src/backup/backup.service.js'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { TrackerCommitsService } from '../src/catalog/tracker-commits.service.js'
import { CollectionService } from '../src/collection/collection.service.js'
import { DotggClient, DotggError } from '../src/collection/dotgg-client.js'
import { DOTGG_LINK_KEY, DotggLinkStore } from '../src/collection/dotgg-link.store.js'
import { DOTGG_SYNC_INTERVAL_MS, DotggSync } from '../src/collection/dotgg-sync.service.js'
import { TrackerSync } from '../src/collection/tracker-sync.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * T-020: the collection from the game through ptcgpocket.gg, against a local DotGG (the client's transport is pointed
 * at it) and a local tracker. Synthetic exports in the real format. The link is a secret: every answer, alert, setting,
 * backup and log line of these tests is checked for its token.
 */
const TOKEN = 'e2eToken_9f8e7d6c5b4a3210'
const LINK = `https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket&token=${TOKEN}`
const FRIEND = '5080397634069511'
type Row = { internal_id: number; amount_owned: number | null; collected: boolean | null }

function exportFile(rows: [number, string, string, number][]): string {
  return `Normal,Foil,Name,Set,Number\n${rows.map(([copies, name, set, number]) => `${copies},0,"${name}","${set}","${number}"`).join('\n')}\n`
}

const BASE = exportFile([
  [2, 'Bulbasaur', 'A1', 1],
  [1, "Professor's Research", 'P-A', 7],
  [3, 'Small Balloon', 'B4b', 372],
])

describe('ptcgpocket.gg collection sync (local DotGG and tracker only)', () => {
  let test: TestApp
  let cookie: string
  let dotggServer: Server
  let trackerServer: Server
  let dotggPort = 0
  // The local DotGG.
  let body = BASE
  let status = 200
  let hang = false
  let redirect: string | null = null
  let announce: string | null = null
  let chunked = false
  const dotggCalls: URL[] = []
  // The local tracker.
  let remote: Row[] = []
  const trackerCalls: string[] = []

  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)
  const setting = (key: string, value: unknown) => put(`/api/settings/${key}`).send({ value })
  const setLink = (url: string) => put('/api/collection/dotgg/link').send({ url })
  const preview = () => post('/api/collection/dotgg/preview').send({})
  const apply = (id: string) => post('/api/collection/dotgg/apply').send({ id })
  const copies = async () => (await get('/api/collection/summary')).body.copies as number
  const alerts = async () => (await get('/api/alerts')).body.items as { code: string; detail: string }[]
  /** Neither the token nor the link in anything the API answered. */
  const clean = (response: { text?: string; body?: unknown }) => {
    const text = `${response.text ?? ''}${JSON.stringify(response.body ?? null)}`
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('exportcollection?game')
  }

  function serveDotgg(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://dotgg.test')
    dotggCalls.push(url)
    if (hang) return // never answers: the client's timeout has to end it
    if (redirect && url.pathname === '/cgfw/exportcollection') {
      res.writeHead(302, { Location: redirect })
      res.end()
      return
    }
    if (status !== 200) {
      res.writeHead(status, { 'Content-Type': 'text/html' })
      res.end(`<html>error for ${url.search}</html>`)
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/csv', ...(announce ? { 'Content-Length': announce } : {}) })
    if (chunked) {
      for (let at = 0; at < body.length; at += 500) res.write(body.slice(at, at + 500))
      res.end()
    } else res.end(body)
  }

  beforeAll(async () => {
    test = await createTestApp()
    test.env.notificationsWatch = false
    await seedOwner(test.app, { totp: false })
    cookie = await login(test)
    await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    dotggServer = createServer(serveDotgg)
    await new Promise<void>((resolve) => dotggServer.listen(0, '127.0.0.1', resolve))
    dotggPort = (dotggServer.address() as AddressInfo).port
    trackerServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://tracker.test')
      trackerCalls.push(`${req.method} ${url.pathname}`)
      if (req.method === 'HEAD') {
        res.setHeader('Content-Range', `*/${remote.length}`)
        res.end()
        return
      }
      const after = Number(url.searchParams.get('internal_id')?.slice(3) ?? -1)
      res.writeHead(206, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify(remote.filter((r) => r.internal_id > after).slice(0, Number(url.searchParams.get('limit')))),
      )
    })
    await new Promise<void>((resolve) => trackerServer.listen(0, '127.0.0.1', resolve))
    test.env.trackerCollectionUrl = `http://127.0.0.1:${(trackerServer.address() as AddressInfo).port}`
    test.env.trackerCollectionAnonKey = 'public-test-key'
  })

  beforeEach(async () => {
    body = BASE
    status = 200
    hang = false
    redirect = null
    announce = null
    chunked = false
    dotggCalls.length = 0
    trackerCalls.length = 0
    remote = [{ internal_id: 65600, amount_owned: 1, collected: true }]
    const client = test.app.get(DotggClient)
    client.timeoutMs = 15_000
    client.totalTimeoutMs = 60_000
    client.maxBytes = 2 * 1024 * 1024
    client.retryDelayMs = 10
    client.fetchImpl = async (input, init) => {
      const target = new URL(String(input))
      if (target.hostname !== 'dotgg.gg' && !target.hostname.endsWith('.dotgg.gg'))
        throw new Error(`unexpected host ${target.hostname}`)
      return fetch(`http://127.0.0.1:${dotggPort}${target.pathname}${target.search}`, init)
    }
    test.app.get(TrackerCommitsService).fetchImpl = async () =>
      Response.json({ sha: test.app.get(CatalogService).trackerCommit })
    await test.prisma.collectionStock.deleteMany()
    await test.prisma.collectionAdjustment.deleteMany()
    await test.prisma.collectionImport.deleteMany()
    await test.prisma.appSecret.deleteMany()
    await test.prisma.appSetting.deleteMany({
      where: { OR: [{ key: { startsWith: 'tracker' } }, { key: { startsWith: 'dotgg' } }] },
    })
  })

  afterAll(async () => {
    dotggServer.closeAllConnections()
    trackerServer.closeAllConnections()
    await new Promise<void>((resolve) => dotggServer.close(() => resolve()))
    await new Promise<void>((resolve) => trackerServer.close(() => resolve()))
    await test.close()
  })

  it('requires a session for every route', async () => {
    for (const [method, path] of [
      ['get', '/api/collection/dotgg/status'],
      ['put', '/api/collection/dotgg/link'],
      ['delete', '/api/collection/dotgg/link'],
      ['post', '/api/collection/dotgg/preview'],
      ['post', '/api/collection/dotgg/apply'],
      ['get', '/api/collection/tracker-gap'],
    ] as const) {
      expect((await test.http()[method](path)).status, path).toBe(401)
    }
  })

  it('stores a valid link sealed, shows it masked and never serves it (status, settings, alerts)', async () => {
    const bad = await setLink(LINK.replace('api.dotgg.gg', 'api.dotgg.gg.evil.example'))
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('dotgg_link')
    clean(bad)
    expect((await setLink(LINK.replace('pokepocket', 'other'))).body.error.code).toBe('dotgg_link')
    expect((await setLink(`https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket`)).status).toBe(400)
    expect(await test.prisma.appSecret.count()).toBe(0)
    const saved = await setLink(`  ${LINK}  `)
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ configured: true, enabled: false, link: '…/exportcollection?…token=••••3210' })
    clean(saved)
    clean(await get('/api/collection/dotgg/status'))
    clean(await get('/api/settings'))
    expect((await get('/api/settings')).body).not.toHaveProperty(DOTGG_LINK_KEY)
    // The link is not a setting: the generic endpoint does not take it.
    expect((await setting(DOTGG_LINK_KEY, LINK)).status).toBe(400)
    const secret = await test.prisma.appSecret.findUniqueOrThrow({ where: { key: DOTGG_LINK_KEY } })
    expect(secret.value).toMatch(/^v1\./)
    expect(secret.value).not.toContain(TOKEN)
    const settings = await test.prisma.appSetting.findMany()
    expect(JSON.stringify(settings)).not.toContain(TOKEN)
    const cleared = await test.http().delete('/api/collection/dotgg/link').set('Cookie', cookie)
    expect(cleared.body).toMatchObject({ configured: false, link: null })
    expect(await test.prisma.appSecret.count()).toBe(0)
  })

  it('previews through the common importer, lists cards the catalog lacks, and applies that stored snapshot', async () => {
    await setLink(LINK)
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 7],
      [3, 'Small Balloon', 'B4b', 372],
      [2, 'Card From The Future', 'C9', 1],
    ])
    const response = await preview()
    expect(response.status).toBe(200)
    clean(response)
    expect(response.body).toMatchObject({
      source: 'dotgg',
      fileName: 'ptcgpocket.gg (juego)',
      dedupTotal: 6,
      unknownIds: ['C9-1'],
      blocked: false,
      summary: { newUnits: 3, copiesDelta: 6 },
      dotgg: {
        requiresReview: true,
        unmatched: [{ line: 5, set: 'C9', number: 1, name: 'Card From The Future', copies: 2 }],
      },
    })
    const reasons = (response.body.dotgg.reviewReasons as string[]).join(' ')
    expect(reasons).toContain('primera sincronización')
    expect(reasons).toContain('1 carta que el catálogo no tiene (2 copias)')
    // The request carried the game and the token; nothing changed yet.
    expect(dotggCalls).toHaveLength(1)
    expect(dotggCalls[0]?.searchParams.get('token')).toBe(TOKEN)
    expect(dotggCalls[0]?.searchParams.get('game')).toBe('pokepocket')
    expect(await copies()).toBe(0)
    clean(await get(`/api/collection/imports/${response.body.id}`))
    clean(await get('/api/collection/imports'))
    body = '' // Applying never reads ptcgpocket.gg again.
    const applied = await apply(response.body.id)
    expect(applied.status).toBe(200)
    expect(applied.body.summary).toEqual(response.body.summary)
    expect(dotggCalls).toHaveLength(1)
    expect(await copies()).toBe(6)
    expect((await test.prisma.collectionStock.findFirst({ where: { cardId: 'A1-1' } }))?.source).toBe('dotgg')
    expect((await test.prisma.collectionImport.findFirst())?.source).toBe('dotgg')
    expect((await apply(response.body.id)).body.error.code).toBe('import_not_pending')
    const state = (await get('/api/collection/dotgg/status')).body
    expect(state).toMatchObject({ result: 'applied', previewId: response.body.id })
    expect(state.lastAppliedAt).not.toBeNull()
    // The CSV and tracker endpoint do not apply it.
    const csvLike = await post('/api/collection/tracker-sync/apply').send({ id: response.body.id })
    expect(csvLike.status).not.toBe(200)
  })

  it('is the whole collection: what it does not list goes to 0 and keeps the carddex flag', async () => {
    await setLink(LINK)
    await test.prisma.collectionStock.create({
      data: { cardId: 'A1-3', amountOwned: 1, collected: true, source: 'import' },
    })
    const response = await preview()
    const zeroed = (response.body.changes as { stockCardId: string; after: unknown }[]).find(
      (change) => change.stockCardId === 'A1-3',
    )
    expect(zeroed?.after).toEqual({ amountOwned: 0, collected: true })
    expect(response.body.summary.zeroedUnits).toBe(1)
    expect((await apply(response.body.id)).status).toBe(200)
    expect(await test.prisma.collectionStock.findUnique({ where: { cardId: 'A1-3' } })).toMatchObject({
      amountOwned: 0,
      collected: true,
      source: 'dotgg',
    })
  })

  it.each([
    ['a revoked link (404)', () => (status = 404), 'dotgg_auth', 1],
    ['a server error (500), three attempts', () => (status = 500), 'dotgg_network', 3],
    ['a rate limit (429), three attempts', () => (status = 429), 'dotgg_network', 3],
    ['another client error (400)', () => (status = 400), 'dotgg_http', 1],
    ['an HTML page with the token in it', () => (body = `<html>bad token ${TOKEN}</html>`), 'dotgg_format', 1],
    ['the header alone', () => (body = 'Normal,Foil,Name,Set,Number\n'), 'dotgg_empty', 1],
    ['a redirect to another site', () => (redirect = `https://evil.example/steal?token=${TOKEN}`), 'dotgg_redirect', 1],
  ])('refuses %s with a clear message and no link, changing nothing', async (_name, arrange, code, calls) => {
    await setLink(LINK)
    await test.prisma.collectionStock.create({
      data: { cardId: 'A1-1', amountOwned: 5, collected: true, source: 'import' },
    })
    arrange()
    const response = await preview()
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe(code)
    expect(response.body.error.message.length).toBeGreaterThan(20)
    clean(response)
    expect(dotggCalls).toHaveLength(calls)
    expect(await test.prisma.collectionImport.count()).toBe(0)
    expect(await copies()).toBe(5)
    const state = await get('/api/collection/dotgg/status')
    expect(state.body.result).toBe('error')
    clean(state)
  })

  it('follows a redirect within dotgg.gg', async () => {
    await setLink(LINK)
    redirect = 'https://cdn.dotgg.gg/exports/file.csv'
    const response = await preview()
    expect(response.status).toBe(200)
    expect(dotggCalls.map((url) => url.pathname)).toEqual(['/cgfw/exportcollection', '/exports/file.csv'])
  })

  it('times out a silent server after three bounded attempts', async () => {
    await setLink(LINK)
    const client = test.app.get(DotggClient)
    client.timeoutMs = 150
    hang = true
    const started = Date.now()
    const response = await preview()
    expect(response.body.error.code).toBe('dotgg_network')
    expect(response.body.error.message).toContain('sin respuesta')
    expect(dotggCalls).toHaveLength(3)
    expect(Date.now() - started).toBeLessThan(10_000)
    dotggServer.closeAllConnections()
  })

  it.each([
    ['announced', true],
    ['counted while reading', false],
  ])('refuses a response above the size cap (%s)', async (_name, announced) => {
    await setLink(LINK)
    test.app.get(DotggClient).maxBytes = 2000
    body = exportFile(Array.from({ length: 200 }, (_, at) => [1, 'Bulbasaur padded name', 'A1', at + 1]))
    expect(body.length).toBeGreaterThan(2000)
    if (announced) announce = String(Buffer.byteLength(body))
    else chunked = true
    const response = await preview()
    expect(response.body.error.code).toBe('dotgg_too_large')
    expect(await test.prisma.collectionImport.count()).toBe(0)
  })

  it('a network error that quotes the URL is told without it', async () => {
    await setLink(LINK)
    test.app.get(DotggClient).fetchImpl = async (input) => {
      throw new TypeError(`Failed to parse URL from ${String(input)}`)
    }
    const response = await preview()
    expect(response.body.error.code).toBe('dotgg_network')
    expect(dotggCalls).toHaveLength(0)
    clean(response)
    clean(await get('/api/collection/dotgg/status'))
  })

  it('never answers, stores or logs the link, even when an error message quotes it', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    const sync = test.app.get(DotggSync)
    const logger = (sync as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger
    const original = logger.warn
    const lines: unknown[] = []
    logger.warn = (...args: unknown[]) => {
      lines.push(args)
    }
    const client = test.app.get(DotggClient)
    const exportCsv = client.exportCsv
    client.exportCsv = async (link: string) => {
      throw new DotggError('dotgg_http', `algo falló en ${link} (token ${TOKEN})`)
    }
    try {
      const response = await preview()
      expect(response.body.error.code).toBe('dotgg_http')
      expect(response.body.error.message).toContain('algo falló en ••••')
      clean(response)
      await sync.tick(new Date(Date.now() + 2 * DOTGG_SYNC_INTERVAL_MS))
      clean(await get('/api/collection/dotgg/status'))
      clean(await get('/api/alerts'))
      expect((await alerts()).some((alert) => alert.code === 'dotgg_sync')).toBe(true)
      expect(JSON.stringify(await test.prisma.appSetting.findMany())).not.toContain(TOKEN)
      expect(lines.length).toBeGreaterThan(0)
      expect(JSON.stringify(lines)).not.toContain(TOKEN)
    } finally {
      logger.warn = original
      client.exportCsv = exportCsv
    }
  })

  it('needs the link: 400 without it, for the preview and for «Tracker al día»', async () => {
    expect((await preview()).body.error.code).toBe('dotgg_not_configured')
    await setting('trackerFriendId', FRIEND)
    expect((await get('/api/collection/tracker-gap')).body.error.code).toBe('dotgg_not_configured')
    expect(dotggCalls).toHaveLength(0)
  })

  it('makes ptcgpocket.gg the source: the tracker stops writing (preview, automatic, pending apply) until the link goes', async () => {
    await setting('trackerFriendId', FRIEND)
    const pendingTracker = await post('/api/collection/tracker-sync/preview').send({})
    expect(pendingTracker.status).toBe(200)
    // Saving the link discards the pending tracker preview.
    await setLink(LINK)
    expect((await get(`/api/collection/imports/${pendingTracker.body.id}`)).body.status).toBe('discarded')
    const refused = await post('/api/collection/tracker-sync/preview').send({})
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('tracker_not_master')
    await setting('trackerAutoSync', true)
    trackerCalls.length = 0
    expect(await test.app.get(TrackerSync).tick(new Date(Date.now() + 7 * 60 * 60 * 1000))).toBeNull()
    expect(trackerCalls).toHaveLength(0)
    // A tracker preview that slipped in before the link (a race) cannot be applied through any endpoint.
    await test.prisma.appSecret.deleteMany()
    const raced = await post('/api/collection/tracker-sync/preview').send({})
    expect(raced.status).toBe(200)
    await setLink(LINK)
    // Saving the link discarded it: put it back to pending, as if it had been stored right after the link.
    await test.prisma.collectionImport.update({ where: { id: Number(raced.body.id) }, data: { status: 'pending' } })
    expect((await post(`/api/collection/imports/${raced.body.id}/apply`)).body.error.code).toBe('tracker_not_master')
    expect((await post('/api/collection/tracker-sync/apply').send({ id: raced.body.id })).status).toBe(409)
    expect(await copies()).toBe(0)
    // A pending ptcgpocket.gg preview is discarded with the link, and the tracker is back.
    const pendingGame = await preview()
    const cleared = await test.http().delete('/api/collection/dotgg/link').set('Cookie', cookie)
    expect(cleared.body.configured).toBe(false)
    expect((await get(`/api/collection/imports/${pendingGame.body.id}`)).body.status).toBe('discarded')
    expect((await post('/api/collection/tracker-sync/preview').send({})).status).toBe(200)
  })

  it('refuses a stale preview after a manual edit and serializes previews', async () => {
    await setLink(LINK)
    const first = await preview()
    await test.http().patch('/api/collection/stock/A1-1').set('Cookie', cookie).send({ amountOwned: 9 })
    const stale = await apply(first.body.id)
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('dotgg_stale_preview')
    const client = test.app.get(DotggClient)
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
    const running = preview().then((response) => response)
    try {
      await waiting
      expect((await preview()).body.error.code).toBe('dotgg_busy')
      release()
      expect((await running).status).toBe(200)
    } finally {
      release()
      client.fetchImpl = original
    }
  })

  it('automatic: off by default; daily; reviews the first sync and big drops; applies the rest; alerts without the link', async () => {
    const sync = test.app.get(DotggSync)
    const now = new Date(Date.now() + 60_000)
    await setLink(LINK)
    expect(await sync.tick(now)).toBeNull()
    expect(dotggCalls).toHaveLength(0)
    expect((await setting('dotggAutoSync', 'yes')).status).toBe(400)
    await setting('dotggAutoSync', true)
    // First automatic run: a preview to look at, never applied by itself.
    const first = await sync.tick(now)
    expect(first?.dotgg?.requiresReview).toBe(true)
    expect(await copies()).toBe(0)
    const warned = (await alerts()).find((alert) => alert.code === 'dotgg_sync')
    expect(warned?.detail).toContain('primera sincronización')
    clean(await get('/api/alerts'))
    expect((await apply(first?.id ?? '')).status).toBe(200)
    expect((await alerts()).some((alert) => alert.code === 'dotgg_sync')).toBe(false)
    // Within 24 h nothing is read.
    const count = dotggCalls.length
    expect(await sync.tick(new Date(now.getTime() + DOTGG_SYNC_INTERVAL_MS - 1))).toBeNull()
    expect(dotggCalls).toHaveLength(count)
    // A day later, a small gain applies by itself.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 7],
      [4, 'Small Balloon', 'B4b', 372],
    ])
    const second = await sync.tick(new Date(now.getTime() + DOTGG_SYNC_INTERVAL_MS))
    expect(second?.dotgg?.requiresReview).toBe(false)
    expect(await copies()).toBe(7)
    expect((await get('/api/collection/dotgg/status')).body).toMatchObject({ result: 'applied', automatic: true })
    // Nothing new: no import, the check date moves (and with it the collection's date).
    const imports = await test.prisma.collectionImport.count()
    const third = new Date(now.getTime() + 2 * DOTGG_SYNC_INTERVAL_MS)
    expect(await sync.tick(third)).toBeNull()
    expect(await test.prisma.collectionImport.count()).toBe(imports)
    expect((await get('/api/collection/dotgg/status')).body).toMatchObject({
      result: 'unchanged',
      lastCheckedAt: third.toISOString(),
    })
    expect((await get('/api/collection/summary')).body.lastImportAt).toBe(third.toISOString())
    // A drop of more than 10 % waits.
    body = exportFile([[2, 'Bulbasaur', 'A1', 1]])
    const dropped = await sync.tick(new Date(now.getTime() + 3 * DOTGG_SYNC_INTERVAL_MS))
    expect(dropped?.dotgg?.requiresReview).toBe(true)
    expect(dropped?.dotgg?.reviewReasons.join(' ')).toContain('más del 10')
    expect(dropped?.dotgg?.missingExpansions.map((item) => item.expansionId)).toEqual(['B4b', 'P-A'])
    expect(await copies()).toBe(7)
    // A failure leaves an alert without the link; turning the switch off clears it.
    status = 404
    expect(await sync.tick(new Date(now.getTime() + 4 * DOTGG_SYNC_INTERVAL_MS))).toBeNull()
    const failed = (await alerts()).find((alert) => alert.code === 'dotgg_sync')
    expect(failed?.detail).toContain('HTTP 404')
    clean(await get('/api/alerts'))
    clean(await get('/api/collection/dotgg/status'))
    await setting('dotggAutoSync', false)
    expect((await alerts()).some((alert) => alert.code === 'dotgg_sync')).toBe(false)
  })

  it('does not apply automatically when the link changed during the read', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    await test.prisma.appSetting.create({ data: { key: 'dotggLastAppliedAt', value: new Date().toISOString() } })
    const client = test.app.get(DotggClient)
    const original = client.fetchImpl
    client.fetchImpl = async (input, init) => {
      await setLink(LINK.replace(TOKEN, `${TOKEN}x`))
      return original(input, init)
    }
    try {
      expect(await test.app.get(DotggSync).tick()).toBeNull()
      expect(await copies()).toBe(0)
      expect(await test.prisma.collectionImport.count()).toBe(0)
    } finally {
      client.fetchImpl = original
    }
  })

  it('backs up imports, stock source and settings (v11) without the link, and a restore keeps the configured link', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    const response = await preview()
    await apply(response.body.id)
    // An old schedule in the file: restoring it must still wait 24 h from the restore.
    await test.prisma.appSetting.update({
      where: { key: 'dotggSyncState' },
      data: { value: { lastAttemptAt: '2020-01-01T00:00:00.000Z', result: 'applied' } },
    })
    const exported = await get('/api/backup/export').responseType('blob')
    const bytes = Buffer.from(exported.body)
    const text = gunzipSync(bytes).toString()
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(DOTGG_LINK_KEY)
    const document = JSON.parse(text)
    expect(document.schemaVersion).toBe(11)
    expect(document.collection.imports[0]).toMatchObject({ source: 'dotgg', diffSummary: { dotgg: {} } })
    expect(document.collection.stock[0].source).toBe('dotgg')
    const dry = await post('/api/backup/import?mode=dry-run').attach('file', bytes, 'backup.json.gz')
    expect(JSON.stringify(dry.body)).toContain('El link de ptcgpocket.gg no viaja en el backup')
    const restored = await post('/api/backup/import?mode=replace').attach('file', bytes, 'backup.json.gz')
    expect(restored.status).toBe(200)
    expect(restored.body.notices.join(' ')).toContain('esperará 24 horas')
    const after = (await get('/api/collection/dotgg/status')).body
    expect(after).toMatchObject({ configured: true, enabled: true, result: 'applied' })
    expect(Date.now() - Date.parse(after.lastAttemptAt)).toBeLessThan(60_000)
    expect((await get(`/api/collection/imports/${response.body.id}`)).body.dotgg).toBeDefined()
    expect((await test.app.get(BackupService).drill()).ok).toBe(true)
    expect(await test.prisma.appSecret.count()).toBe(1)
  })

  it('«Tracker al día»: compares the tracker with the game card by card and builds the file, changing nothing', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    remote = [
      { internal_id: 65600, amount_owned: 1, collected: true }, // A1-1: game 2
      { internal_id: 65730, amount_owned: 2, collected: true }, // A1-3: game 0
      { internal_id: 1465601, amount_owned: 3, collected: true }, // B4b-372: same
      { internal_id: 2147483000, amount_owned: 1, collected: true }, // not in the catalog
    ]
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 7],
      [3, 'Small Balloon', 'B4b', 372],
      [1, 'Card From The Future', 'C9', 1],
    ])
    const response = await get('/api/collection/tracker-gap')
    expect(response.status).toBe(200)
    clean(response)
    expect(response.body.summary).toEqual({
      cards: 3,
      cardsMissing: 2,
      copiesMissing: 2,
      cardsExtra: 1,
      copiesExtra: 2,
      trackerCopies: 6,
      gameCopies: 6,
    })
    expect(
      response.body.rows.map((row: { stockCardId: string; delta: number }) => [row.stockCardId, row.delta]),
    ).toEqual([
      ['A1-1', 1],
      ['A1-3', -2],
      ['P-A-7', 1],
    ])
    expect(response.body.unmatchedGame).toHaveLength(1)
    expect(response.body.unknownTracker).toEqual([2147483000])
    expect(response.body.warnings).toHaveLength(2)
    const file = parseTrackerCsv(response.body.trackerFile.content)
    expect(response.body.trackerFile).toMatchObject({ fileName: 'tcg-pocket-para-el-tracker.csv', rows: 3 })
    expect(file.errors).toEqual([])
    expect(file.rows.map((row) => [row.id, row.internalId, row.numberOwned, row.collected])).toEqual([
      ['A1-1', 65600, 2, true],
      ['A1-3', 65730, 0, true],
      ['P-A-7', 12583376, 1, true],
    ])
    expect(await copies()).toBe(0)
    expect(await test.prisma.collectionImport.count()).toBe(0)
    // Rows ptcgpocket.gg could not read: no file (it would zero those cards in the tracker).
    body = `${body}x,0,"bad","A1","2"\n`
    const unsafe = await get('/api/collection/tracker-gap')
    expect(unsafe.body.trackerFile).toBeNull()
    expect(unsafe.body.warnings.join(' ')).toContain('no se arma el archivo')
  })

  it('«Tracker al día» for Claude (MCP), without the link or the file', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    const token = (await post('/api/tokens').send({ name: 'claude', kind: 'mcp', scopes: ['mcp:read'] })).body.token
    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    try {
      const result = (await client.callTool({ name: 'collection_tracker_gap', arguments: { limit: 1 } })) as {
        structuredContent?: Record<string, unknown>
        isError?: boolean
      }
      expect(result.isError).toBeFalsy()
      const structured = result.structuredContent ?? {}
      expect(structured.summary).toMatchObject({ cards: 3, cardsMissing: 3 })
      expect(structured.cards).toHaveLength(1)
      expect(structured.moreCards).toBe(2)
      expect(String(structured.text)).toContain('le faltan')
      const text = JSON.stringify(result)
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain('InternalId,NumberOwned')
    } finally {
      await client.close()
    }
  })

  // --- Scenarios of the adversarial self-review, kept as regression tests ---------------------------------------

  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => from + at)
  const remove = () => test.http().delete('/api/collection/dotgg/link').set('Cookie', cookie)
  const OTHER = LINK.replace(TOKEN, `${TOKEN}ZZ99`)
  const internalId = (id: string) => test.app.get(CatalogService).requireIndex().cardById(id)?.internalId ?? -1
  const lastApplied = () =>
    test.prisma.appSetting.create({
      data: { key: 'dotggLastAppliedAt', value: new Date(Date.now() - 3600_000).toISOString() },
    })

  it('automatic: an expansion the export does not list makes it wait, even with a small drop', async () => {
    await test.prisma.collectionStock.createMany({
      data: [
        ...range(1, 20).map((n) => ({ cardId: `A1-${n}`, amountOwned: 1, collected: true, source: 'import' as const })),
        { cardId: 'P-A-7', amountOwned: 1, collected: true, source: 'import' as const },
      ],
    })
    await lastApplied()
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    body = exportFile(range(1, 21).map((n) => [1, '', 'A1', n]))
    const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 60_000))
    expect(result?.dotgg?.requiresReview).toBe(true)
    expect(result?.dotgg?.reviewReasons.join(' ')).toContain('ninguna carta de P-A')
    expect(await copies()).toBe(21)
  })

  it('automatic: one manual edit since the last sync makes it wait', async () => {
    await test.prisma.collectionStock.createMany({
      data: range(1, 40).map((n) => ({
        cardId: `A1-${n}`,
        amountOwned: 1,
        collected: true,
        source: 'import' as const,
        updatedAt: new Date(Date.now() - 2 * 3600_000),
      })),
    })
    await lastApplied()
    await test.http().patch('/api/collection/stock/A1-1').set('Cookie', cookie).send({ amountOwned: 3 })
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    body = exportFile(range(1, 40).map((n) => [1, '', 'A1', n]))
    const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 60_000))
    expect(result?.dotgg?.requiresReview).toBe(true)
    expect(result?.dotgg?.reviewReasons.join(' ')).toContain('1 carta tiene un cambio manual')
    expect(await copies()).toBe(42)
  })

  it('the same link keeps the pending preview; another link discards it', async () => {
    await setLink(LINK)
    const pending = await preview()
    await setLink(LINK)
    expect((await get(`/api/collection/imports/${pending.body.id}`)).body.status).toBe('pending')
    await setLink(OTHER)
    expect((await get(`/api/collection/imports/${pending.body.id}`)).body.status).toBe('discarded')
  })

  it.each([
    ['removed', () => remove(), 'dotgg_not_configured'],
    ['changed', () => setLink(OTHER), 'dotgg_config_changed'],
  ])('a link %s during a manual read stores nothing', async (_name, change, code) => {
    await setLink(LINK)
    const client = test.app.get(DotggClient)
    const original = client.fetchImpl
    let changed = false
    client.fetchImpl = async (input, init) => {
      if (!changed) {
        changed = true
        await change()
      }
      return original(input, init)
    }
    const response = await preview()
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe(code)
    clean(response)
    expect(await test.prisma.collectionImport.count()).toBe(0)
    expect(await copies()).toBe(0)
  })

  it('back to the tracker after removing the link, its first sync waits instead of undoing the game', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    body = exportFile(range(1, 30).map((n) => [1, '', 'A1', n]))
    const game = await preview()
    expect((await apply(game.body.id)).status).toBe(200)
    expect(await copies()).toBe(30)
    // The tracker is behind the game: it has not got A1-30 yet.
    remote = range(1, 29).map((n) => ({ internal_id: internalId(`A1-${n}`), amount_owned: 1, collected: true }))
    await setting('trackerAutoSync', true)
    await remove()
    const result = await test.app.get(TrackerSync).tick(new Date(Date.now() + 60_000))
    expect(result?.tracker?.requiresReview).toBe(true)
    expect(result?.tracker?.reviewReasons?.join(' ')).toContain('1 carta tiene el número del juego')
    expect(await copies()).toBe(30)
  })

  it('a pending preview that came back with a backup does not apply without the link', async () => {
    await setLink(LINK)
    const pending = await preview()
    const exported = await get('/api/backup/export').responseType('blob')
    await remove()
    const restored = await post('/api/backup/import?mode=replace').attach(
      'file',
      Buffer.from(exported.body),
      'backup.json.gz',
    )
    expect(restored.status).toBe(200)
    expect((await get(`/api/collection/imports/${pending.body.id}`)).body.status).toBe('pending')
    const generic = await post(`/api/collection/imports/${pending.body.id}/apply`).send({})
    expect(generic.status).toBe(409)
    expect(generic.body.error.code).toBe('dotgg_not_configured')
    expect((await apply(pending.body.id)).body.error.code).toBe('dotgg_not_configured')
    expect(await copies()).toBe(0)
  })

  it('an automatic apply refuses a preview that asked for a look, whoever calls it', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    const reviewed = await preview() // the first sync: requiresReview
    expect(reviewed.body.dotgg.requiresReview).toBe(true)
    const collection = test.app.get(CollectionService)
    const fingerprint = test.app.get(DotggLinkStore).fingerprint(LINK)
    await expect(collection.applyImport(reviewed.body.id, true, fingerprint)).rejects.toMatchObject({
      response: { code: 'dotgg_review' },
    })
    expect(await copies()).toBe(0)
  })

  it('an automatic failure does not warn about a link that changed meanwhile', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    const client = test.app.get(DotggClient)
    const exportCsv = client.exportCsv
    client.exportCsv = async () => {
      await setLink(OTHER)
      throw new DotggError('dotgg_auth', 'ptcgpocket.gg no reconoce el link (HTTP 404).')
    }
    try {
      expect(await test.app.get(DotggSync).tick(new Date(Date.now() + 60_000))).toBeNull()
      expect((await alerts()).some((alert) => alert.code === 'dotgg_sync')).toBe(false)
    } finally {
      client.exportCsv = exportCsv
    }
  })

  it('a stored link that cannot be opened keeps the tracker paused and says so', async () => {
    await setting('trackerFriendId', FRIEND)
    await test.prisma.appSecret.create({ data: { key: DOTGG_LINK_KEY, value: 'v1.AAAA.BBBB.CCCC' } })
    const state = (await get('/api/collection/dotgg/status')).body
    expect(state).toMatchObject({ configured: false, unreadable: true, link: null })
    expect((await post('/api/collection/tracker-sync/preview').send({})).body.error.code).toBe('tracker_not_master')
    await setting('trackerAutoSync', true)
    expect(await test.app.get(TrackerSync).tick(new Date(Date.now() + 7 * 3600_000))).toBeNull()
    expect(trackerCalls).toHaveLength(0)
    const manual = await preview()
    expect(manual.status).toBe(400)
    expect(manual.body.error.code).toBe('dotgg_unreadable')
    await setting('dotggAutoSync', true)
    expect(await test.app.get(DotggSync).tick(new Date(Date.now() + 60_000))).toBeNull()
    expect(dotggCalls).toHaveLength(0)
    expect((await alerts()).find((alert) => alert.code === 'dotgg_sync')?.detail).toContain('no se puede leer')
    // Pasting it again clears it.
    await setLink(LINK)
    expect((await get('/api/collection/dotgg/status')).body).toMatchObject({ configured: true, unreadable: false })
  })

  it('a row with another card’s name (another numbering) waits for a look and is not compared', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    await lastApplied()
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 7],
      [3, 'Charizard ex', 'B4b', 372],
    ])
    const response = await preview()
    expect(response.body.dotgg.renamed).toEqual([
      { line: 4, cardId: 'B4b-372', name: 'Charizard ex', catalogName: 'Small Balloon', copies: 3 },
    ])
    expect(response.body.dotgg.reviewReasons.join(' ')).toContain('con el nombre de otra carta del catálogo')
    remote = [{ internal_id: internalId('A1-1'), amount_owned: 1, collected: true }]
    const gap = await get('/api/collection/tracker-gap')
    expect(gap.body.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1', 'P-A-7'])
    expect(gap.body.warnings.join(' ')).toContain('con el nombre de otra carta del catálogo')
  })

  it('«Tracker al día» warns when the tracker published changes after the catalog, and never quotes the link', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    test.app.get(TrackerCommitsService).fetchImpl = async () => Response.json({ sha: 'b'.repeat(40) })
    const response = await get('/api/collection/tracker-gap')
    expect(response.body.warnings.join(' ')).toContain('El tracker publicó cambios después del catálogo')
    const client = test.app.get(DotggClient)
    const exportCsv = client.exportCsv
    client.exportCsv = async (link: string) => {
      throw new DotggError('dotgg_http', `falló ${link}`)
    }
    try {
      const failed = await get('/api/collection/tracker-gap')
      expect(failed.status).toBe(503)
      expect(failed.body.error.message).toBe('falló ••••')
      clean(failed)
    } finally {
      client.exportCsv = exportCsv
    }
  })
})
