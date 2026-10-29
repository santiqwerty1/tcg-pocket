import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogIndex, parseTrackerCsv } from '@tcg/domain'
import { onTestFinished, vi } from 'vitest'
import { BackupService } from '../src/backup/backup.service.js'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { TrackerCommitsService } from '../src/catalog/tracker-commits.service.js'
import { CollectionService } from '../src/collection/collection.service.js'
import { DotggClient, DotggError } from '../src/collection/dotgg-client.js'
import { DOTGG_LINK_KEY, DotggLinkStore } from '../src/collection/dotgg-link.store.js'
import { DOTGG_SYNC_INTERVAL_MS, DotggSync } from '../src/collection/dotgg-sync.service.js'
import { TrackerGapService } from '../src/collection/tracker-gap.service.js'
import { TrackerSync } from '../src/collection/tracker-sync.service.js'
import { McpToolsService } from '../src/mcp/mcp-tools.service.js'
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
    // Every test asks GitHub afresh (the compatibility of internal ids is kept 10 minutes in production).
    test.app.get(TrackerGapService).cacheMs = 0
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

  it('backs up imports, stock source and settings (v12) without the link, and a restore keeps the configured link', async () => {
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
    expect(document.schemaVersion).toBe(12)
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
      { internal_id: 853760, amount_owned: 0, collected: true }, // B1a-28: registered with 0, game 0
      { internal_id: 1465601, amount_owned: 3, collected: true }, // B4b-372: same
      { internal_id: 2147483000, amount_owned: 1, collected: true }, // not in the catalog
    ]
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, '', 'B1a', 1],
      [1, "Professor's Research", 'P-A', 7],
      [3, 'Small Balloon', 'B4b', 372],
    ])
    const response = await get('/api/collection/tracker-gap')
    expect(response.status).toBe(200)
    clean(response)
    expect(response.body.summary).toEqual({
      cards: 5,
      cardsMissing: 3,
      copiesMissing: 3,
      cardsExtra: 1,
      copiesExtra: 2,
      cardsCollected: 1,
      trackerCopies: 6,
      gameCopies: 7,
    })
    expect(
      response.body.rows.map((row: { stockCardId: string; delta: number }) => [row.stockCardId, row.delta]),
    ).toEqual([
      ['A1-1', 1],
      ['A1-3', -2],
      ['B1a-1', 1],
      ['B1a-28', 0],
      ['P-A-7', 1],
    ])
    expect(response.body.unmatchedGame).toEqual([])
    expect(response.body.unknownTracker).toEqual([2147483000])
    expect(response.body.warnings).toHaveLength(1)
    expect(response.body).toMatchObject({ notCompared: 1, complete: false })
    const file = parseTrackerCsv(response.body.trackerFile.content)
    expect(response.body.trackerFile).toMatchObject({ fileName: 'tcg-pocket-para-el-tracker.csv', rows: 5 })
    expect(file.errors).toEqual([])
    expect(file.rows.map((row) => [row.id, row.internalId, row.numberOwned, row.collected])).toEqual([
      ['A1-1', 65600, 2, true],
      // 0 copies in the game: Collected FALSE, though the tracker had it registered (Santi, 22/10).
      ['A1-3', 65730, 0, false],
      ['B1a-1', internalId('B1a-1'), 1, true],
      ['B1a-28', 853760, 0, false],
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

  it('«Tracker al día» leaves out the expansions the export does not cover, instead of zeroing them in the file (S-B)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    // The export lists A1 only; the tracker also has P-A-7, B4b-372 and B1a-28 (registered with 0).
    body = exportFile([[2, 'Bulbasaur', 'A1', 1]])
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('B1a-28'), amount_owned: 0, collected: true },
      { internal_id: internalId('P-A-7'), amount_owned: 1, collected: true },
      { internal_id: internalId('B4b-372'), amount_owned: 3, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1'])
    expect(gap.summary).toMatchObject({ cards: 1, trackerCopies: 1, gameCopies: 2 })
    expect(gap).toMatchObject({ complete: false, notCompared: 3 })
    expect(gap.warnings.join(' ')).toContain('no trae ninguna carta de B1a, B4b y P-A, donde el tracker tiene 3 cartas')
    const file = parseTrackerCsv(gap.trackerFile.content)
    expect(file.rows.map((row) => row.id)).toEqual(['A1-1'])
  })

  it('«Tracker al día» gives no file with a hole in the numbering of a known set, or a row with no name: it may be a known card (S-D)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('P-A-7'), amount_owned: 1, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    // The real catalog numbers every set without holes; here P-A-50 is missing, and a row there may be P-A-7 with
    // another numbering (it has no row of its own).
    const catalog = test.app.get(CatalogService)
    const full = catalog.requireIndex()
    const holed = new CatalogIndex({
      ...full.catalog,
      cards: full.catalog.cards.filter((card) => card.id !== 'P-A-50'),
    })
    const spy = vi.spyOn(catalog, 'requireIndex').mockReturnValue(holed)
    onTestFinished(() => spy.mockRestore())
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 50],
    ])
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.unmatchedGame).toHaveLength(1)
    expect(gap.trackerFile).toBeNull()
    expect(gap.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1'])
    expect(gap.complete).toBe(false)
    expect(gap.warnings).toContain(
      'ptcgpocket.gg trae 1 carta con un número que el catálogo no tiene dentro de una expansión que sí tiene (P-A-50): no se compara y no se arma el archivo, porque puede ser una carta conocida con otra numeración (sincronizá el catálogo).',
    )
    spy.mockRestore()
    // A row of a set the catalog does not have, without a name: nothing says which card it is.
    body = `Normal,Foil,Name,Set,Number\n2,0,"Bulbasaur","A1","1"\n1,0,"Professor's Research","P-A","7"\n1,0,"","SP1","2"\n`
    const nameless = (await get('/api/collection/tracker-gap')).body
    expect(nameless.trackerFile).toBeNull()
    expect(nameless.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1'])
    expect(nameless.warnings).toContain(
      'ptcgpocket.gg trae 1 carta sin nombre que el catálogo no tiene (SP1-2): no se compara y no se arma el archivo, porque sin el nombre no se sabe si es una carta conocida con otro código (sincronizá el catálogo).',
    )
  })

  it('«Tracker al día» builds the file without a card of a set the catalog does not have yet (SP1), and says so (S-D)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    // 29/10/2026: ptcgpocket.gg brings the special pack «Primeros Compañeros» before the tracker and the catalog.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [3, 'Small Balloon', 'B4b', 372],
      [1, 'Bulbasaur', 'SP1', 1],
    ])
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('B4b-372'), amount_owned: 3, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.unmatchedGame).toEqual([{ line: 4, set: 'SP1', number: 1, name: 'Bulbasaur', copies: 1 }])
    expect(
      gap.rows.map((row: { stockCardId: string; tracker: number; game: number }) => [
        row.stockCardId,
        row.tracker,
        row.game,
      ]),
    ).toEqual([['A1-1', 1, 2]])
    expect(gap).toMatchObject({ complete: false, notCompared: 1 })
    expect(gap.warnings).toEqual([
      'ptcgpocket.gg trae SP1-1 Bulbasaur: el catálogo todavía no tiene esa expansión, así que no se compara ni va en el archivo para el tracker. Cuando el tracker la cargue, sincronizá el catálogo y volvé a comparar.',
    ])
    const file = parseTrackerCsv(gap.trackerFile.content)
    expect(file.rows.map((row) => [row.id, row.numberOwned, row.collected])).toEqual([['A1-1', 2, true]])
    // A Bulbasaur the tracker has and the export gives no copy of may be the SP1 row under its new code: not compared,
    // so the file does not take it off the tracker.
    remote = [...remote, { internal_id: internalId('A1-227'), amount_owned: 1, collected: true }].sort(
      (a, b) => a.internal_id - b.internal_id,
    )
    const named = (await get('/api/collection/tracker-gap')).body
    expect(named.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1'])
    expect(named).toMatchObject({ complete: false, notCompared: 2 })
    expect(named.warnings).toContain(
      'Bulbasaur (A1-227) no se compara: ptcgpocket.gg no trae copias de esa carta, pero su nombre aparece entre las cartas de ptcgpocket.gg que no se comparan, y puede ser ella con otro código (el archivo la pondría en 0).',
    )
    expect(parseTrackerCsv(named.trackerFile.content).rows.map((row) => row.id)).toEqual(['A1-1'])
    // A promo past the last number of P-B, before the tracker loads it: the same.
    const next =
      Math.max(
        ...test.app
          .get(CatalogService)
          .requireIndex()
          .cardsOfExpansion('P-B')
          .map((card) => card.number),
      ) + 1
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [3, 'Small Balloon', 'B4b', 372],
      [1, 'Pikachu', 'P-B', next],
    ])
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('B4b-372'), amount_owned: 3, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const promo = (await get('/api/collection/tracker-gap')).body
    expect(promo).toMatchObject({ complete: false, notCompared: 1 })
    expect(promo.warnings).toEqual([
      `ptcgpocket.gg trae P-B-${next} Pikachu: el catálogo todavía no tiene esa carta (su número es posterior al último de su expansión), así que no se compara ni va en el archivo para el tracker. Cuando el tracker la cargue, sincronizá el catálogo y volvé a comparar.`,
    ])
    expect(parseTrackerCsv(promo.trackerFile.content).rows.map((row) => row.id)).toEqual(['A1-1'])
  })

  it('«Tracker al día» does not zero a known card the export writes under a new code (S-D)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    // P-A-7 comes as «PA-7» while P-A-1 keeps its code: P-A is covered, and the app has no P-A-7.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, 'Potion', 'P-A', 1],
      [1, "Professor's Research", 'PA', 7],
    ])
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('P-A-7'), amount_owned: 1, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1', 'P-A-1'])
    expect(parseTrackerCsv(gap.trackerFile.content).rows.map((row) => row.id)).toEqual(['A1-1', 'P-A-1'])
    expect(gap).toMatchObject({ complete: false, notCompared: 2 })
    expect(gap.warnings.join(' ')).toContain(
      `ptcgpocket.gg trae PA-7 Professor's Research: el catálogo todavía no tiene`,
    )
    expect(gap.warnings.join(' ')).toContain(
      `${test.app.get(CatalogService).requireIndex().cardById('P-A-7')?.nameEs} (P-A-7) no se compara: ptcgpocket.gg no trae copias de esa carta`,
    )
  })

  it('«Tracker al día» counts a card once when it is left out for its row with another name and for its own name (S-D)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    // A1-2 (Ivysaur) comes named «Venusaur» with 0 copies, and an Ivysaur comes in SP1.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [0, 'Venusaur', 'A1', 2],
      [1, 'Ivysaur', 'SP1', 2],
    ])
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('A1-2'), amount_owned: 1, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1'])
    // The row with another name and the SP1 row: A1-2 is not counted again for its name.
    expect(gap).toMatchObject({ complete: false, notCompared: 2 })
    expect(gap.warnings.join(' ')).not.toContain('(A1-2) no se compara')
    expect(gap.warnings.join(' ')).toContain('con el nombre de otra carta del catálogo')
  })

  it('«Tracker al día» does not zero a known expansion the export writes whole under a new code, even once applied (S-D, S-E)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 7],
    ])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    // ptcgpocket.gg now writes P-A as «PA»: the sync asks for a look.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'PA', 7],
    ])
    const second = await preview()
    expect(second.body.dotgg.requiresReview).toBe(true)
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('P-A-7'), amount_owned: 1, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    // While the app has P-A-7, P-A is left out (S-E).
    const waiting = (await get('/api/collection/tracker-gap')).body
    expect(waiting.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1'])
    expect(waiting.warnings.join(' ')).toContain('la colección de la app todavía tiene copias ahí')
    // Applied anyway, the app has 0 in P-A, which ptcgpocket.gg knew: P-A-7 is still not zeroed, by its name.
    expect((await apply(second.body.id)).status).toBe(200)
    expect((await test.prisma.collectionStock.findUnique({ where: { cardId: 'P-A-7' } }))?.amountOwned).toBe(0)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['A1-1'])
    expect(gap.emptyExpansions).toEqual([])
    expect(parseTrackerCsv(gap.trackerFile.content).rows.map((row) => row.id)).toEqual(['A1-1'])
    expect(gap.warnings.join(' ')).toContain('(P-A-7) no se compara')
  })

  it('«Tracker al día» compares a set the game has none of anymore, once a sync listed it and the app has 0 there (S-E)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [3, 'Small Balloon', 'B4b', 372],
    ])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    // The Globitos were traded away: the export lists A1 only, and the sync says ptcgpocket.gg knows B4b.
    body = exportFile([[2, 'Bulbasaur', 'A1', 1]])
    const second = await preview()
    expect(second.body.dotgg.requiresReview).toBe(true)
    expect(second.body.dotgg.reviewReasons.join(' ')).toContain(
      'La exportación no trae ninguna de las cartas que la colección tiene en B4b (3 copias): ptcgpocket.gg ya conoce esa expansión, así que puede que ya no las tengas; aplicá solo si es así.',
    )
    // The tracker still has the 3.
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 2, collected: true },
      { internal_id: internalId('B4b-372'), amount_owned: 3, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    // While the drop waits in the app, B4b is left out, and the warning says what to do.
    const waiting = (await get('/api/collection/tracker-gap')).body
    expect(waiting.rows).toEqual([])
    expect(waiting).toMatchObject({ complete: false, notCompared: 1, emptyExpansions: [], trackerFile: null })
    expect(waiting.warnings.join(' ')).toContain(
      'no trae la carta que el tracker tiene en B4b: no se compara, porque la colección de la app todavía tiene copias ahí',
    )
    // Santi applies it: the app has 0 there, and the next comparison takes the 3 off the tracker too.
    expect((await apply(second.body.id)).status).toBe(200)
    expect((await test.prisma.collectionStock.findUnique({ where: { cardId: 'B4b-372' } }))?.amountOwned).toBe(0)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(
      gap.rows.map((row: { stockCardId: string; tracker: number; game: number }) => [
        row.stockCardId,
        row.tracker,
        row.game,
      ]),
    ).toEqual([['B4b-372', 3, 0]])
    expect(gap).toMatchObject({ complete: true, notCompared: 0, warnings: [] })
    expect(gap.emptyExpansions).toEqual([{ expansionId: 'B4b', nameEs: expect.any(String), cards: 1 }])
    const file = parseTrackerCsv(gap.trackerFile.content)
    expect(file.rows.map((row) => [row.id, row.internalId, row.numberOwned, row.collected])).toEqual([
      ['B4b-372', internalId('B4b-372'), 0, false],
    ])
    // Claude says it too (the tool's own method; the MCP transport is covered by the test below).
    const tools = test.app.get(McpToolsService, { strict: false }) as unknown as {
      collectionTrackerGap(args: object): Promise<{ text: string; emptyExpansions: unknown[] }>
    }
    const mcp = await tools.collectionTrackerGap({})
    expect(mcp.emptyExpansions).toHaveLength(1)
    expect(mcp.text).toContain(
      'no queda en el juego ninguna de las cartas que tiene el tracker: el archivo las pone en 0',
    )
    // With no file (a row with no name that the catalog does not have), nothing promises one (Codex on #153).
    body = `${body}1,0,"","SP1","1"\n`
    const blocked = await tools.collectionTrackerGap({})
    expect(blocked.emptyExpansions).toHaveLength(1)
    expect(blocked.text).toContain('no queda en el juego ninguna de las cartas que tiene el tracker.')
    expect(blocked.text).not.toContain('el archivo')
  })

  it('«Tracker al día» leaves out the cards a sync to review would drop while the app still has them (S-K)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    const index = test.app.get(CatalogService).requireIndex()
    const row = (n: number) => `1,0,"${index.cardById(`A1-${n}`)?.nameEn ?? ''}","A1","${n}"`
    body = `Normal,Foil,Name,Set,Number\n${range(1, 10).map(row).join('\n')}\n`
    expect((await apply((await preview()).body.id)).status).toBe(200)
    // The export drops half of A1: the sync waits for a look, and Santi has not applied it.
    body = `Normal,Foil,Name,Set,Number\n${range(1, 5).map(row).join('\n')}\n`
    const second = await preview()
    expect(second.body.dotgg.requiresReview).toBe(true)
    remote = range(1, 10)
      .map((n) => ({ internal_id: internalId(`A1-${n}`), amount_owned: 1, collected: true }))
      .sort((a, b) => a.internal_id - b.internal_id)
    const waiting = (await get('/api/collection/tracker-gap')).body
    expect(waiting.rows).toEqual([])
    expect(waiting).toMatchObject({ complete: false, notCompared: 5, pendingDrops: 5, trackerFile: null })
    expect(waiting.warnings).toEqual([
      'Hay 5 cartas en 0 en la exportación de ptcgpocket.gg que la colección de la app todavía tiene: no se comparan, porque hay bajas sin aplicar. Aplicá la sincronización con el juego y volvé a comparar.',
    ])
    const tools = test.app.get(McpToolsService, { strict: false }) as unknown as {
      collectionTrackerGap(args: object): Promise<{ text: string; complete: boolean; notCompared: object }>
    }
    const mcp = await tools.collectionTrackerGap({})
    expect(mcp).toMatchObject({ complete: false, notCompared: { pendingDrops: 5 } })
    expect(mcp.text).toContain('Hay bajas sin aplicar en la app (5 cartas): aplicá la sincronización con ptcgpocket.gg')
    // Applied, the app has 0 there and the five are compared (ptcgpocket.gg knows every set, as in the real export).
    expect((await apply(second.body.id)).status).toBe(200)
    await test.prisma.appSetting.update({
      where: { key: 'dotggSeenExpansions' },
      data: { value: index.catalog.expansions.map((expansion) => expansion.id) },
    })
    const applied = (await get('/api/collection/tracker-gap')).body
    expect(applied.rows.map((item: { stockCardId: string }) => item.stockCardId)).toEqual(
      range(6, 10).map((n) => `A1-${n}`),
    )
    expect(applied).toMatchObject({ complete: true, pendingDrops: 0, warnings: [] })
    expect(parseTrackerCsv(applied.trackerFile.content).rows.map((item) => item.numberOwned)).toEqual([0, 0, 0, 0, 0])
  })

  it('a set no applied sync listed stays out with 0 in the app; an automatic check with nothing to change marks what it lists (S-E)', async () => {
    const sync = test.app.get(DotggSync)
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    // A preview listing B4b that is never applied does not count.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [3, 'Small Balloon', 'B4b', 372],
    ])
    const discarded = await preview()
    expect(discarded.status).toBe(200)
    body = exportFile([[2, 'Bulbasaur', 'A1', 1]])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 2, collected: true },
      { internal_id: internalId('B4b-372'), amount_owned: 3, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap).toMatchObject({ rows: [], notCompared: 1, emptyExpansions: [] })
    expect(gap.warnings.join(' ')).toContain('puede que ptcgpocket.gg no conozca la expansión')
    // An automatic check with nothing to change adds what it lists, like an applied sync.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [3, 'Small Balloon', 'B4b', 372],
    ])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    await test.prisma.appSetting.update({ where: { key: 'dotggSeenExpansions' }, data: { value: ['A1'] } })
    await setting('dotggAutoSync', true)
    expect(await sync.tick(new Date(Date.now() + DOTGG_SYNC_INTERVAL_MS + 60_000))).toBeNull()
    expect((await get('/api/collection/dotgg/status')).body.result).toBe('unchanged')
    expect((await test.prisma.appSetting.findUnique({ where: { key: 'dotggSeenExpansions' } }))?.value).toEqual([
      'A1',
      'B4b',
    ])
  })

  it('with no mark yet (syncs applied before it existed), the comparison and the next sync start from the applied imports (S-E)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [3, 'Small Balloon', 'B4b', 372],
    ])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    await test.prisma.appSetting.delete({ where: { key: 'dotggSeenExpansions' } })
    // The sync's review knows B4b from the applied import too (Codex on #153).
    body = exportFile([[2, 'Bulbasaur', 'A1', 1]])
    const drop = await preview()
    expect(drop.body.dotgg.reviewReasons.join(' ')).toContain('ptcgpocket.gg ya conoce esa expansión')
    expect((await apply(drop.body.id)).status).toBe(200)
    await test.prisma.appSetting.delete({ where: { key: 'dotggSeenExpansions' } })
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 2, collected: true },
      { internal_id: internalId('B4b-372'), amount_owned: 3, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['B4b-372'])
    expect(gap.emptyExpansions).toHaveLength(1)
    // Reading does not write it; the next applied sync does, from the same imports and its own rows.
    expect(await test.prisma.appSetting.findUnique({ where: { key: 'dotggSeenExpansions' } })).toBeNull()
    body = exportFile([[3, 'Bulbasaur', 'A1', 1]])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    expect((await test.prisma.appSetting.findUnique({ where: { key: 'dotggSeenExpansions' } }))?.value).toEqual([
      'A1',
      'B4b',
    ])
  })

  it('a reprint row says ptcgpocket.gg knows its set, though the card is kept under another one (S-E)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    // B4b-8 is kept under B1-2: the export writes B4b, so a B4b card it does not list has 0 copies in the game.
    const reprint = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, '', 'B4b', 8],
    ])
    body = reprint
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 2, collected: true },
      { internal_id: internalId('B1-2'), amount_owned: 1, collected: true },
      { internal_id: internalId('B4b-372'), amount_owned: 3, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    // Nothing applied yet: the export itself says ptcgpocket.gg writes B4b.
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.rows.map((row: { stockCardId: string }) => row.stockCardId)).toEqual(['B4b-372'])
    expect(gap.warnings).toEqual([])
    // The mark keeps the code the row wrote, not B1, where the card is kept.
    expect((await apply((await preview()).body.id)).status).toBe(200)
    expect((await test.prisma.appSetting.findUnique({ where: { key: 'dotggSeenExpansions' } }))?.value).toEqual([
      'A1',
      'B4b',
    ])
    // The sync's review says it too: B4b-372 in the app, a mark without B4b, and an export that writes B4b-8 only.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, '', 'B4b', 8],
      [3, 'Small Balloon', 'B4b', 372],
    ])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    await test.prisma.appSetting.update({ where: { key: 'dotggSeenExpansions' }, data: { value: ['A1'] } })
    body = reprint
    expect((await preview()).body.dotgg.reviewReasons.join(' ')).toContain(
      'no trae ninguna de las cartas que la colección tiene en B4b (3 copias): ptcgpocket.gg ya conoce esa expansión',
    )
  })

  it('a card whose copy may be a reprint in a set ptcgpocket.gg never wrote is not zeroed (S-E)', async () => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    // A4b-44 is kept under A3a-6. The export writes A3a (another card) and never A4b: the tracker's copy of A3a-6 may
    // be the A4b reprint, so the file must not take it off.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, '', 'A3a', 1],
    ])
    remote = [
      { internal_id: internalId('A1-1'), amount_owned: 2, collected: true },
      { internal_id: internalId('A3a-1'), amount_owned: 1, collected: true },
      { internal_id: internalId('A3a-6'), amount_owned: 1, collected: true },
    ].sort((a, b) => a.internal_id - b.internal_id)
    const gap = (await get('/api/collection/tracker-gap')).body
    expect(gap.rows).toEqual([])
    expect(gap).toMatchObject({ notCompared: 1, complete: false, trackerFile: null })
    expect(gap.warnings.join(' ')).toContain(
      '1 carta del tracker que ptcgpocket.gg no trae tiene una reimpresión en A4b, que ptcgpocket.gg nunca trajo: no se compara',
    )
    // Once ptcgpocket.gg writes A4b (A4b-1, kept under A1-1, with the same count), its 0 is the game's.
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, '', 'A3a', 1],
      [2, '', 'A4b', 1],
    ])
    const known = (await get('/api/collection/tracker-gap')).body
    expect(known.rows.map((row: { stockCardId: string; game: number }) => [row.stockCardId, row.game])).toEqual([
      ['A3a-6', 0],
    ])
  })

  it('a restore keeps the expansions ptcgpocket.gg was seen writing (S-E)', async () => {
    await setLink(LINK)
    body = exportFile([[2, 'Bulbasaur', 'A1', 1]])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    const exported = await get('/api/backup/export').responseType('blob')
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [3, 'Small Balloon', 'B4b', 372],
    ])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    await post('/api/backup/import?mode=replace').attach('file', Buffer.from(exported.body), 'backup.json.gz')
    expect((await test.prisma.appSetting.findUnique({ where: { key: 'dotggSeenExpansions' } }))?.value).toEqual([
      'A1',
      'B4b',
    ])
  })

  it('a restore keeps what an apply in flight adds to the mark (Codex on #153)', async () => {
    await setLink(LINK)
    body = exportFile([[2, 'Bulbasaur', 'A1', 1]])
    expect((await apply((await preview()).body.id)).status).toBe(200)
    const exported = await get('/api/backup/export').responseType('blob')
    // An apply in flight: the import's table locks, and B4b added to the mark but not committed yet.
    const writer = await test.prisma.pool.connect()
    try {
      await writer.query('BEGIN')
      await writer.query('LOCK TABLE cards, collection_stock, collection_adjustments IN SHARE ROW EXCLUSIVE MODE')
      await writer.query(`UPDATE app_settings SET value = '["A1","B4b"]'::jsonb WHERE key = 'dotggSeenExpansions'`)
      const restoring = post('/api/backup/import?mode=replace')
        .attach('file', Buffer.from(exported.body), 'backup.json.gz')
        .then((response) => response)
      // Once the restore waits behind the apply, the apply commits.
      for (let tries = 0; tries < 200; tries += 1) {
        const [waiting] = await test.prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`
        if ((waiting?.n ?? 0) > 0) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      await writer.query('COMMIT')
      expect((await restoring).status).toBe(200)
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined)
      writer.release()
    }
    expect((await test.prisma.appSetting.findUnique({ where: { key: 'dotggSeenExpansions' } }))?.value).toEqual([
      'A1',
      'B4b',
    ])
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
      expect(structured.complete).toBe(true)
      // A card the catalog does not have: the comparison is not complete, and the text does not say «al día».
      body = exportFile([
        [1, 'Bulbasaur', 'A1', 1],
        [1, 'Card From The Future', 'C9', 1],
      ])
      const partial = (await client.callTool({ name: 'collection_tracker_gap', arguments: {} })) as {
        structuredContent?: Record<string, unknown>
      }
      expect(partial.structuredContent?.complete).toBe(false)
      expect(String(partial.structuredContent?.text)).toBe(
        'Lo que se pudo comparar está al día, pero 1 carta quedó afuera de la comparación (mirá los avisos).',
      )
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
  /** An applied sync an hour ago, read from LINK (the mark counts only for the link it was read from). */
  const lastApplied = () =>
    test.prisma.appSetting.createMany({
      data: [
        { key: 'dotggLastAppliedAt', value: new Date(Date.now() - 3600_000).toISOString() },
        { key: 'dotggLastAppliedLink', value: test.app.get(DotggLinkStore).fingerprint(LINK) },
      ],
    })

  it('automatic: an expansion the export does not list makes it wait, even with a small drop', async () => {
    await test.prisma.collectionStock.createMany({
      data: [
        ...range(1, 20).map((n) => ({ cardId: `A1-${n}`, amountOwned: 1, collected: true, source: 'import' as const })),
        { cardId: 'P-A-7', amountOwned: 1, collected: true, source: 'import' as const },
      ],
    })
    await setLink(LINK)
    await lastApplied()
    await setting('dotggAutoSync', true)
    body = exportFile(range(1, 21).map((n) => [1, '', 'A1', n]))
    const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 60_000))
    expect(result?.dotgg?.requiresReview).toBe(true)
    expect(result?.dotgg?.reviewReasons).toEqual([expect.stringContaining('ninguna carta de P-A')])
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
    await setLink(LINK)
    await lastApplied()
    await test.http().patch('/api/collection/stock/A1-1').set('Cookie', cookie).send({ amountOwned: 3 })
    await setting('dotggAutoSync', true)
    body = exportFile(range(1, 40).map((n) => [1, '', 'A1', n]))
    const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 60_000))
    expect(result?.dotgg?.requiresReview).toBe(true)
    expect(result?.dotgg?.reviewReasons).toEqual([expect.stringContaining('1 carta tiene un cambio manual')])
    expect(await copies()).toBe(42)
  })

  it('another link starts over: its first automatic sync waits for a look; the same link keeps the last one', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    expect((await apply((await preview()).body.id)).status).toBe(200)
    await setLink(LINK)
    expect(await test.prisma.appSetting.count({ where: { key: 'dotggLastAppliedAt' } })).toBe(1)
    await setLink(OTHER)
    expect(await test.prisma.appSetting.count({ where: { key: 'dotggLastAppliedAt' } })).toBe(0)
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 7],
      [4, 'Small Balloon', 'B4b', 372],
    ])
    const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 2 * DOTGG_SYNC_INTERVAL_MS))
    expect(result?.dotgg?.requiresReview).toBe(true)
    expect(result?.dotgg?.reviewReasons.join(' ')).toContain('primera sincronización')
    expect(await copies()).toBe(6)
  })

  it.each([
    ['another link', true],
    ['the same link', false],
  ])('a backup restored with %s configured: a first sync waits only for another link', async (_name, other) => {
    await setLink(LINK)
    expect((await apply((await preview()).body.id)).status).toBe(200)
    const exported = await get('/api/backup/export').responseType('blob')
    if (other) await setLink(OTHER)
    const restored = await post('/api/backup/import?mode=replace').attach(
      'file',
      Buffer.from(exported.body),
      'backup.json.gz',
    )
    expect(restored.status).toBe(200)
    // The file brought back the last applied sync of LINK: kept with LINK, gone with another link.
    expect(await test.prisma.appSetting.count({ where: { key: 'dotggLastAppliedAt' } })).toBe(other ? 0 : 1)
    await setting('dotggAutoSync', true)
    body = exportFile([
      [2, 'Bulbasaur', 'A1', 1],
      [1, "Professor's Research", 'P-A', 7],
      [4, 'Small Balloon', 'B4b', 372],
    ])
    const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 2 * DOTGG_SYNC_INTERVAL_MS))
    expect(result?.dotgg?.requiresReview).toBe(other)
    expect(result?.dotgg?.reviewReasons.join(' ').includes('primera sincronización')).toBe(other)
    expect(await copies()).toBe(other ? 6 : 7)
  })

  it.each([
    ['friend id', () => setting('trackerFriendId', '1111222233334444')],
    ['link', () => setLink(OTHER)],
  ])('«Tracker al día» refuses a comparison when the %s changed during the reads', async (_name, change) => {
    await setting('trackerFriendId', FRIEND)
    await setLink(LINK)
    const client = test.app.get(DotggClient)
    const exportCsv = client.exportCsv.bind(client)
    client.exportCsv = async (link: string) => {
      await change()
      return exportCsv(link)
    }
    try {
      const response = await get('/api/collection/tracker-gap')
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('gap_config_changed')
      expect(response.body.error.message).toContain('volvé a comparar')
      clean(response)
    } finally {
      client.exportCsv = exportCsv
    }
  })

  it('automatic: nothing to change but rows to look at keeps a preview, so the alert has one (Codex 4355133195)', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    expect((await apply((await preview()).body.id)).status).toBe(200)
    body = `${BASE}2,0,"Card From The Future","C9","1"\n`
    const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 2 * DOTGG_SYNC_INTERVAL_MS))
    expect(result?.summary.unitsChanged).toBe(0)
    expect(result?.dotgg?.unmatched).toHaveLength(1)
    expect((await get(`/api/collection/imports/${result?.id}`)).body.status).toBe('pending')
    const alert = ((await get('/api/alerts')).body.items as { code: string; link: string | null }[]).find(
      (item) => item.code === 'dotgg_sync',
    )
    expect(alert?.link).toBe(`/coleccion/importar/${result?.id}`)
    expect(await copies()).toBe(6)
  })

  it('another link forgets the old link’s last check («Última sincronización»)', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    expect((await apply((await preview()).body.id)).status).toBe(200)
    expect(await test.app.get(DotggSync).tick(new Date(Date.now() + 2 * DOTGG_SYNC_INTERVAL_MS))).toBeNull()
    expect((await get('/api/collection/dotgg/status')).body.lastCheckedAt).not.toBeNull()
    await setLink(LINK)
    expect((await get('/api/collection/dotgg/status')).body.lastCheckedAt).not.toBeNull()
    await setLink(OTHER)
    expect((await get('/api/collection/dotgg/status')).body).toMatchObject({ lastCheckedAt: null, lastAppliedAt: null })
  })

  it('the link’s fingerprint is served nowhere: settings, previews, the imports list', async () => {
    await setLink(LINK)
    const pending = await preview()
    expect((await apply(pending.body.id)).status).toBe(200)
    const fingerprint = test.app.get(DotggLinkStore).fingerprint(LINK)
    expect(await test.prisma.appSetting.count({ where: { key: 'dotggLastAppliedLink' } })).toBe(1)
    for (const path of ['/api/settings', `/api/collection/imports/${pending.body.id}`, '/api/collection/imports']) {
      const response = await get(path)
      expect(JSON.stringify(response.body), path).not.toContain(fingerprint)
      expect(JSON.stringify(response.body), path).not.toContain('dotggLastAppliedLink')
    }
    expect(JSON.stringify(pending.body)).not.toContain(fingerprint)
  })

  it.each([
    ['another link', 'other'],
    ['no link', 'none'],
    ['the same link', 'same'],
  ] as const)('a restore with %s configured resets by link, like saving a link (S-C)', async (_name, mode) => {
    const other = mode !== 'same'
    await setLink(LINK)
    expect((await apply((await preview()).body.id)).status).toBe(200)
    // A later check with nothing to change: it moves the collection's date past the import.
    const checked = new Date(Date.now() + 60_000).toISOString()
    await test.prisma.appSetting.upsert({
      where: { key: 'dotggLastCheckedAt' },
      create: { key: 'dotggLastCheckedAt', value: checked },
      update: { value: checked },
    })
    const applied = (await test.prisma.collectionImport.findFirst({ where: { status: 'applied' } }))?.appliedAt
    expect((await get('/api/collection/summary')).body.lastImportAt).toBe(checked)
    const exported = await get('/api/backup/export').responseType('blob')
    if (mode === 'other') await setLink(OTHER)
    if (mode === 'none') await remove()
    await post('/api/backup/import?mode=replace').attach('file', Buffer.from(exported.body), 'backup.json.gz')
    const status = (await get('/api/collection/dotgg/status')).body
    const summary = (await get('/api/collection/summary')).body
    if (other) {
      expect(status).toMatchObject({ lastCheckedAt: null, lastAppliedAt: null, previewId: null, result: null })
      // The other link's check does not date the collection: only the import that came back with the file does.
      expect(summary.lastImportAt).toBe(applied?.toISOString())
    } else {
      expect(status.lastAppliedAt).not.toBeNull()
      expect(status.lastCheckedAt).toBe(checked)
      expect(summary.lastImportAt).toBe(checked)
    }
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

  it('a preview restored from a backup does not apply with another link', async () => {
    await setLink(LINK)
    const pending = await preview()
    expect(pending.body.dotgg).not.toHaveProperty('linkId')
    clean(await get(`/api/collection/imports/${pending.body.id}`))
    const stored = await test.prisma.collectionImport.findUniqueOrThrow({ where: { id: Number(pending.body.id) } })
    const linkId = (stored.diffSummary as { dotgg?: { linkId?: string } }).dotgg?.linkId
    expect(linkId).toBe(test.app.get(DotggLinkStore).fingerprint(LINK))
    expect(linkId).not.toContain(TOKEN)
    const exported = await get('/api/backup/export').responseType('blob')
    await setLink(OTHER)
    const restored = await post('/api/backup/import?mode=replace').attach(
      'file',
      Buffer.from(exported.body),
      'backup.json.gz',
    )
    expect(restored.status).toBe(200)
    expect((await get(`/api/collection/imports/${pending.body.id}`)).body.status).toBe('pending')
    const applied = await apply(pending.body.id)
    expect(applied.status).toBe(409)
    expect(applied.body.error.code).toBe('dotgg_other_link')
    expect((await post(`/api/collection/imports/${pending.body.id}/apply`).send({})).body.error.code).toBe(
      'dotgg_other_link',
    )
    expect(await copies()).toBe(0)
    // With the link it was read from, it applies.
    await setLink(LINK)
    await test.prisma.collectionImport.update({ where: { id: Number(pending.body.id) }, data: { status: 'pending' } })
    expect((await apply(pending.body.id)).status).toBe(200)
  })

  it('an automatic apply refuses a preview that asked for a look, whoever calls it', async () => {
    await setLink(LINK)
    await setting('dotggAutoSync', true)
    const reviewed = await preview() // the first sync: requiresReview
    expect(reviewed.body.dotgg.requiresReview).toBe(true)
    const collection = test.app.get(CollectionService)
    await expect(collection.applyImport(reviewed.body.id, true)).rejects.toMatchObject({
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
    const refused = await post('/api/collection/tracker-sync/preview').send({})
    expect(refused.body.error.code).toBe('tracker_not_master')
    expect(refused.body.error.message).toContain('no se puede leer')
    await setting('trackerAutoSync', true)
    expect(await test.app.get(TrackerSync).tick(new Date(Date.now() + 7 * 3600_000))).toBeNull()
    expect(trackerCalls).toHaveLength(0)
    const manual = await preview()
    expect(manual.status).toBe(400)
    expect(manual.body.error.code).toBe('dotgg_unreadable')
    // With the daily sync off, the alert says it all the same.
    expect(await test.app.get(DotggSync).tick(new Date(Date.now() + 60_000))).toBeNull()
    expect(dotggCalls).toHaveLength(0)
    expect((await alerts()).find((alert) => alert.code === 'dotgg_sync')?.detail).toContain('no se puede leer')
    // A pending tracker preview from before cannot be applied by any endpoint while that link is stored.
    await test.prisma.appSecret.deleteMany()
    remote = [{ internal_id: internalId('A1-1'), amount_owned: 2, collected: true }]
    const pending = await post('/api/collection/tracker-sync/preview').send({})
    expect(pending.status).toBe(200)
    await test.prisma.appSecret.create({ data: { key: DOTGG_LINK_KEY, value: 'v1.AAAA.BBBB.CCCC' } })
    const generic = await post(`/api/collection/imports/${pending.body.id}/apply`).send({})
    expect(generic.status).toBe(409)
    expect(generic.body.error.code).toBe('tracker_not_master')
    expect(generic.body.error.message).toContain('no se puede leer')
    expect(await copies()).toBe(0)
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
    const catalogCommit = test.app.get(CatalogService).trackerCommit ?? ''
    const latest = 'b'.repeat(40)
    const ui = ['frontend/src/components/Header.tsx', 'frontend/public/locales/es-ES/common/sets.json']
    const ids = [...ui, 'frontend/assets/cards.json']
    /** GitHub with main at `latest`: `forward` is catalog...main, `backward` main...catalog. */
    const github = (status: string, forward: string[], backward: string[] = []) => {
      test.app.get(TrackerCommitsService).fetchImpl = async (input) => {
        const url = String(input)
        if (url.includes(`/compare/${catalogCommit}...`))
          return Response.json({ status, files: forward.map((filename) => ({ filename })) })
        if (url.includes(`/compare/${latest}...`))
          return Response.json({ status: 'ahead', files: backward.map((filename) => ({ filename })) })
        return Response.json({ sha: latest })
      }
    }
    const compare = async () => (await get('/api/collection/tracker-gap')).body
    // Main ahead with interface commits only: the ids are the same, the file is offered.
    github('ahead', ui)
    const quiet = await compare()
    expect(quiet.warnings.join(' ')).not.toContain('internal_id')
    expect(quiet.trackerFile).not.toBeNull()
    expect(quiet.complete).toBe(true)
    // Main ahead with cards.json: no file.
    github('ahead', ids)
    const ahead = await compare()
    expect(ahead.warnings.join(' ')).toContain('otros datos de cartas (cards.json)')
    expect(ahead.trackerFile).toBeNull()
    expect(ahead.complete).toBe(false)
    // Main behind the catalog (a rollback) and cards.json changed in between: also no file (Codex 4354955470).
    github('behind', [], ids)
    const behind = await compare()
    expect(behind.warnings.join(' ')).toContain('otros datos de cartas (cards.json)')
    expect(behind.trackerFile).toBeNull()
    github('behind', [], ui)
    expect((await compare()).trackerFile).not.toBeNull()
    // Diverged: either side changing cards.json counts.
    github('diverged', ui, ids)
    expect((await compare()).trackerFile).toBeNull()
    // GitHub lists at most 300 files: a full list may hide cards.json.
    github(
      'ahead',
      Array.from({ length: 300 }, (_, at) => `frontend/src/file-${at}.tsx`),
    )
    expect((await compare()).trackerFile).toBeNull()
    // GitHub does not answer: the ids cannot be checked, no file.
    test.app.get(TrackerCommitsService).fetchImpl = async () => new Response(null, { status: 500 })
    const unknown = await compare()
    expect(unknown.warnings.join(' ')).toContain('No se pudo comprobar en GitHub')
    expect(unknown.trackerFile).toBeNull()
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

  // --- Something changes while a request is in flight (Codex on #150): the snapshot pattern, path by path ----------

  /** Runs `during` inside the next read of ptcgpocket.gg, then lets the read go on (or fail with `fail`). */
  function duringRead(during: () => Promise<unknown>, fail?: DotggError) {
    const client = test.app.get(DotggClient)
    const exportCsv = client.exportCsv.bind(client)
    let done = false
    client.exportCsv = async (link: string) => {
      if (!done) {
        done = true
        await during()
        if (fail) throw fail
      }
      return exportCsv(link)
    }
    onTestFinished(() => {
      client.exportCsv = exportCsv
    })
  }
  const reloadCatalog = () =>
    test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })

  it.each([
    [
      '4354775675: saving the same link again keeps the pending review in Avisos; another link takes it away',
      async () => {
        await setLink(LINK)
        await setting('dotggAutoSync', true)
        expect((await test.app.get(DotggSync).tick())?.dotgg?.requiresReview).toBe(true)
        expect((await alerts()).some((alert) => alert.code === 'dotgg_sync')).toBe(true)
        await setLink(LINK)
        expect((await alerts()).some((alert) => alert.code === 'dotgg_sync')).toBe(true)
        await setLink(OTHER)
        expect((await alerts()).some((alert) => alert.code === 'dotgg_sync')).toBe(false)
      },
    ],
    [
      '4354775681: a catalog sync during «Tracker al día» refuses the comparison instead of mixing internal ids',
      async () => {
        await setting('trackerFriendId', FRIEND)
        await setLink(LINK)
        duringRead(reloadCatalog)
        const response = await get('/api/collection/tracker-gap')
        expect(response.status).toBe(409)
        expect(response.body.error.code).toBe('gap_config_changed')
        expect(response.body.error.message).toContain('el catálogo')
      },
    ],
    [
      '4354775689: a read of the old link that fails after the link changed leaves no state to the new one',
      async () => {
        await setLink(LINK)
        duringRead(() => setLink(OTHER), new DotggError('dotgg_auth', 'ptcgpocket.gg no reconoce el link (HTTP 404).'))
        expect((await preview()).status).toBe(503)
        expect((await get('/api/collection/dotgg/status')).body).toMatchObject({
          configured: true,
          lastAttemptAt: null,
          result: null,
          error: null,
        })
        // The new link's daily sync is not held back 24 h by the old link's attempt.
        await setting('dotggAutoSync', true)
        const calls = dotggCalls.length
        await test.app.get(DotggSync).tick()
        expect(dotggCalls.length).toBe(calls + 1)
      },
    ],
    [
      '4354630300: a backup restored with another link brings the old link’s last sync, which does not count',
      async () => {
        await setLink(LINK)
        expect((await apply((await preview()).body.id)).status).toBe(200)
        const exported = await get('/api/backup/export').responseType('blob')
        await setLink(OTHER)
        await post('/api/backup/import?mode=replace').attach('file', Buffer.from(exported.body), 'backup.json.gz')
        await setting('dotggAutoSync', true)
        body = BASE.replace('3,0,"Small Balloon"', '4,0,"Small Balloon"')
        const result = await test.app.get(DotggSync).tick(new Date(Date.now() + 2 * DOTGG_SYNC_INTERVAL_MS))
        expect(result?.dotgg?.reviewReasons.join(' ')).toContain('primera sincronización')
      },
    ],
    [
      '4354630309: a friend id changed during «Tracker al día» refuses the comparison',
      async () => {
        await setting('trackerFriendId', FRIEND)
        await setLink(LINK)
        duringRead(() => setting('trackerFriendId', '1111222233334444'))
        const response = await get('/api/collection/tracker-gap')
        expect(response.body.error.code).toBe('gap_config_changed')
        expect(response.body.error.message).toContain('el friend_id del tracker')
      },
    ],
  ])('%s', async (_name, scenario) => {
    await scenario()
  })

  it('apply (ptcgpocket.gg): a catalog sync after the preview makes it stale', async () => {
    await setLink(LINK)
    const pending = await preview()
    await reloadCatalog()
    const applied = await apply(pending.body.id)
    expect(applied.status).toBe(409)
    expect(applied.body.error.code).toBe('dotgg_stale_preview')
    expect(await copies()).toBe(0)
  })

  it('apply (tracker): a preview read for another friend id does not apply, by hand either', async () => {
    await setting('trackerFriendId', FRIEND)
    const pending = await post('/api/collection/tracker-sync/preview').send({})
    expect(pending.status).toBe(200)
    await setting('trackerFriendId', '1111222233334444')
    const applied = await post(`/api/collection/imports/${pending.body.id}/apply`).send({})
    expect(applied.status).toBe(409)
    expect(applied.body.error.code).toBe('tracker_config_changed')
    expect(await copies()).toBe(0)
  })

  it('sync: a link changed during a manual read stores neither the preview nor its state', async () => {
    await setLink(LINK)
    duringRead(() => setLink(OTHER))
    const response = await preview()
    expect(response.body.error.code).toBe('dotgg_config_changed')
    expect(await test.prisma.collectionImport.count()).toBe(0)
    expect((await get('/api/collection/dotgg/status')).body).toMatchObject({ lastAttemptAt: null, previewId: null })
  })
})
