import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import type { StarCouponView } from '../src/packs/pack-views.js'
import { PacksService } from '../src/packs/packs.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Cupón ★★ (3/11/2026): `GET /api/packs/star-coupon` and the `packs_star_coupon` tool against the 6/10/2026 collection,
 * the 40 decks and the made-up pokemon-zone import.
 */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')
const PZ_FIXTURE = join(REPO_ROOT, 'packages/domain/test/fixtures/pokemon-zone/payload.json')

type Payload = {
  v: number
  mine: { resourceData: { tickets: { key: string; value: number; name: string }[] } }
  stats: { syncedAt: string }
}

describe('Cupón ★★ (e2e)', () => {
  let test: TestApp
  let cookie: string
  let url: URL
  let readToken: string
  let beastsId: string
  const clients: Client[] = []

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const patch = (path: string) => test.http().patch(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)
  const coupon = async (query = ''): Promise<StarCouponView> => {
    const response = await get(`/api/packs/star-coupon${query}`)
    expect(response.status).toBe(200)
    return response.body as StarCouponView
  }
  /** packs_star_coupon's `coupons`, through the MCP endpoint. */
  const toolCoupons = async (): Promise<unknown> => {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${readToken}` } } }),
    )
    clients.push(client)
    const result = (await client.callTool({ name: 'packs_star_coupon', arguments: { limit: 1 } })) as {
      structuredContent?: Record<string, unknown>
    }
    return result.structuredContent?.coupons
  }

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const preview = await post('/api/collection/imports').attach('file', readFileSync(CSV_PATH), 'export.csv')
    expect((await post(`/api/collection/imports/${preview.body.id}/apply`)).status).toBe(200)
    const drafts = (await post('/api/decks/import').send({ text: readFileSync(DECKS_PATH, 'utf8') })).body.drafts as {
      title: string
      draft: { energies: string[]; cards: unknown[] }
    }[]
    const inputs = drafts.map((d) => ({
      name: d.title,
      energies: d.draft.energies.length > 0 ? d.draft.energies : ['psychic'],
      cards: d.draft.cards,
    }))
    expect((await post('/api/decks/import/commit').send({ decks: inputs })).status).toBe(201)
    readToken = (await post('/api/tokens').send({ name: 'claude', kind: 'mcp', scopes: ['mcp:read'] })).body.token
    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    url = new URL(`http://127.0.0.1:${port}/api/mcp`)
  })

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined)
    await test.close()
  })

  it('needs the session and checks its knobs', async () => {
    expect((await test.http().get('/api/packs/star-coupon')).status).toBe(401)
    expect((await get('/api/packs/star-coupon?copies=0')).status).toBe(400)
    expect((await get('/api/packs/star-coupon?copies=6')).status).toBe(400)
    expect((await get('/api/packs/star-coupon?deckTarget=meta')).status).toBe(400)
  })

  it('without deck goals: the packs on sale with their ☆☆, tied on new editions; no import, no count', async () => {
    const view = await coupon()
    expect(view).toMatchObject({ rarity: '☆☆', deckTarget: 'saved', goalCopies: 1, goals: [], coupons: null })
    expect(view.lastImportAt).not.toBeNull()
    // 29 openable packs: the Deluxe ex is off by default and the Deluxe Mega ended on 28/10/2026.
    expect(view.packs).toHaveLength(27)
    expect(view.packs.map((pack) => pack.packId)).not.toContain('B4b/deluxepackmega')
    const suicune = view.packs.find((pack) => pack.packId === 'A4a/suicunepack')
    expect(suicune).toMatchObject({
      nameEs: expect.any(String),
      size: 12,
      forDecks: 0,
      newEditions: 12,
      chanceNew: 100,
    })
    expect(view.best).toContain('A4a/suicunepack')
    expect(view.best).not.toContain('B2/megagardevoirpack')
    // Follow-up of #173: among the ties, the newest expansion first (B4a), not the first id (Charizard A1).
    expect(view.packs[0]?.packId).toBe('B4a/teamrocketsambitionpack')
    expect(view.tieBreak).toBe('newest')
    expect(view.known).toEqual([
      { key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' },
    ])
  })

  it('a deck goal lacking Entei ex and Suicune ex puts Suicune first: 3 of 12 for the decks', async () => {
    const created = await post('/api/decks').send({
      name: 'Bestias',
      energies: ['water'],
      cards: [
        { cardId: 'A4a-20', count: 2 },
        { cardId: 'A4a-10', count: 2 },
      ],
    })
    expect(created.status).toBe(201)
    beastsId = created.body.id
    // Not a goal of Sobres until it has a pack priority.
    expect((await coupon()).packs[0]?.forDecks).toBe(0)
    expect((await patch(`/api/decks/${beastsId}`).send({ packPriority: 2 })).status).toBe(200)
    const view = await coupon()
    expect(view.goals).toEqual([{ id: beastsId, name: 'Bestias', priority: 2, target: 'saved' }])
    expect(view.best).toEqual(['A4a/suicunepack'])
    const first = view.packs[0]
    expect(first).toMatchObject({ packId: 'A4a/suicunepack', size: 12, forDecks: 3, newEditions: 12, chanceDecks: 25 })
    expect(first?.cards.filter((card) => card.decks.length > 0).map((card) => card.cardId)).toEqual([
      'A4a-79',
      'A4a-80',
      'A4a-87',
    ])
    // Switched off in Sobres → Ajustes, it is not on sale: gone.
    expect((await patch('/api/packs/A4a/suicunepack').send({ available: false })).status).toBe(200)
    const off = await coupon()
    expect(off.packs.map((pack) => pack.packId)).not.toContain('A4a/suicunepack')
    expect(off.packs.every((pack) => pack.forDecks === 0)).toBe(true)
    expect((await patch('/api/packs/A4a/suicunepack').send({ available: true })).status).toBe(200)
  })

  it('«Copias por edición»: the saved one by default, the page’s when it sends it', async () => {
    expect((await put('/api/settings/rarityFilter').send({ value: { rarities: [], copies: 2 } })).status).toBe(200)
    const saved = await coupon()
    expect(saved.goalCopies).toBe(2)
    const megaGardevoir = (view: StarCouponView) => view.packs.find((pack) => pack.packId === 'B2/megagardevoirpack')
    // One of its 23 ☆☆ owned, with a single copy: below a goal of 2, not of 1.
    expect(megaGardevoir(saved)).toMatchObject({ size: 23, newEditions: 22, belowGoal: 23 })
    const one = await coupon('?copies=1')
    expect(one.goalCopies).toBe(1)
    expect(megaGardevoir(one)).toMatchObject({ newEditions: 22, belowGoal: 22 })
    // The collection goal off: 1.
    expect((await put('/api/settings/rarityFilter').send({ value: null })).status).toBe(200)
    expect((await coupon()).goalCopies).toBe(1)
  })

  it('the coupons of the latest pokemon-zone import: v1 unknown (never 0), v2 its ★★ tickets, v2 holding none 0', async () => {
    const fixture = () => JSON.parse(readFileSync(PZ_FIXTURE, 'utf8')) as Payload
    const save = async (payload: Payload) =>
      expect((await post('/api/pokemon-zone/imports').send(payload)).status).toBe(201)
    // The fixture is a bookmarklet version 1 payload: it holds the anniversary's ticket, but v1 does not count it.
    await save(fixture())
    expect((await coupon()).coupons).toEqual({
      importedAt: expect.any(String),
      syncedAt: '2026-11-02T02:43:29.379Z',
      count: null,
      expired: [],
    })
    expect(await toolCoupons()).toMatchObject({ status: 'unknown', gameReadAt: '1/11/2026, 23:43' })
    // A later read with the version 2 bookmarklet: one ★★ ticket (the anniversary's).
    const v2 = { ...fixture(), v: 2 }
    v2.stats.syncedAt = '2026-11-02T20:00:00.000Z'
    await save(v2)
    expect((await coupon()).coupons).toMatchObject({ syncedAt: '2026-11-02T20:00:00.000Z', count: 1, expired: [] })
    // Follow-up of #173: the same read seen after the anniversary's deadline — the ticket is apart, as expired.
    const later = await test.app.get(PacksService).starCoupon({}, new Date('2026-12-16T00:00:00Z'))
    expect(later.coupons).toMatchObject({
      count: 0,
      expired: [
        { key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z', count: 1 },
      ],
    })
    expect(await toolCoupons()).toEqual({ status: 'known', gameReadAt: '2/11/2026, 17:00', count: 1 })
    // Spent: version 2 with the ticket at 0 is 0, not unknown.
    const spent = { ...fixture(), v: 2 }
    spent.stats.syncedAt = '2026-11-02T21:00:00.000Z'
    spent.mine.resourceData.tickets = spent.mine.resourceData.tickets.map((ticket) =>
      ticket.key === 'TICKET_2610000_EV_02' ? { ...ticket, value: 0 } : ticket,
    )
    await save(spent)
    expect((await coupon()).coupons).toMatchObject({ syncedAt: '2026-11-02T21:00:00.000Z', count: 0 })
  })

  it('packs_star_coupon says the same for the model', async () => {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${readToken}` } } }),
    )
    clients.push(client)
    const { tools } = await client.listTools()
    const tool = tools.find((item) => item.name === 'packs_star_coupon')
    expect(tool?.annotations?.readOnlyHint).toBe(true)
    const result = (await client.callTool({ name: 'packs_star_coupon', arguments: { limit: 2 } })) as {
      structuredContent?: Record<string, unknown>
    }
    const json = result.structuredContent ?? {}
    expect(json.best).toEqual([expect.stringMatching(/\(A4a\)$/)])
    expect(json.deckGoals).toEqual(['Bestias'])
    expect(json.morePacks).toBe(25)
    const packs = json.packs as Record<string, unknown>[]
    expect(packs).toHaveLength(2)
    expect(packs[0]).toMatchObject({
      packId: 'A4a/suicunepack',
      starCards: 12,
      forDecks: '3 de 12 (25 %)',
      newEditions: '12 de 12 (100 %)',
    })
    // The latest import is the version 2 one holding none.
    expect(json.coupons).toMatchObject({ status: 'known', count: 0 })
    expect(json.knownCoupons).toEqual([{ coupon: 'Cupón del 2.º aniversario', usableUntil: '15/12/2026, 03:59' }])
    const bad = (await client.callTool({ name: 'packs_star_coupon', arguments: { copies: 9 } })) as {
      isError?: boolean
    }
    expect(bad.isError).toBe(true)
  })
})
