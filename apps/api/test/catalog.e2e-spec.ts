import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { createTestApp, login, seedOwner, type TestApp, waitForSync } from './helpers.js'

/** Expected values from docs/PLAN.md §7 (M1 acceptance) for the pinned commit 3ab58f1. */
const EXPECTED = { cards: 4317, expansions: 24, groups: 2319, stockUnits: 3866 }
const COPYCAT_GROUP = ['B1-225', 'B1-270', 'B4b-225', 'B4b-391', 'B4b-424']

describe('catalog (e2e)', () => {
  let test: TestApp
  let cookie: string
  let sync: CatalogSyncService

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    sync = test.app.get(CatalogSyncService)
  })

  afterAll(async () => {
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)

  it('reports an empty catalog before the first sync', async () => {
    const status = await get('/api/catalog/status')
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      loaded: false,
      trackerCommit: null,
      engineRev: null,
      syncedAt: null,
      counts: null,
      lastSync: null,
    })
    expect(status.body.pinned).toEqual({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev })
    const cards = await get('/api/cards?q=Copiona')
    expect(cards.status).toBe(503)
    expect(cards.body.error.code).toBe('unavailable')
  })

  it('syncs from the fixtures and loads 4317 cards', async () => {
    const summary = await sync.sync({
      trackerCommit: test.env.catalogCommit,
      engineRev: test.env.engineRev,
      source: 'fixtures',
    })
    expect(summary.status).toBe('applied')
    expect(summary.counts.cards).toBe(EXPECTED.cards)
    expect(summary.diff).toBeNull()
    expect(summary.nameFallbacks).toBe(0)

    const status = await get('/api/catalog/status')
    expect(status.body.loaded).toBe(true)
    expect(status.body.trackerCommit).toBe(test.env.catalogCommit)
    expect(status.body.engineRev).toBe(test.env.engineRev)
    expect(status.body.syncedAt).not.toBeNull()
    expect(status.body.counts).toEqual({ ...EXPECTED, packs: status.body.counts.packs })
    expect(status.body.lastSync).toMatchObject({
      id: summary.syncId,
      status: 'applied',
      source: 'fixtures',
      commitSha: test.env.catalogCommit,
    })
    expect(status.body.lastSync.finishedAt).not.toBeNull()
    expect(status.body.lastSync.report.build.counts.cards).toBe(EXPECTED.cards)

    const health = await test.http().get('/healthz')
    expect(health.body.catalogCommit).toBe(test.env.catalogCommit)
    expect(health.body.engineRev).toBe(test.env.engineRev)

    const row = await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: summary.syncId } })
    expect(Object.keys(row.fileHashes as Record<string, unknown>)).toHaveLength(9)
    expect(await test.prisma.card.count()).toBe(EXPECTED.cards)
    expect(await test.prisma.functionalGroup.count()).toBe(EXPECTED.groups)
    expect(await test.prisma.expansion.count()).toBe(EXPECTED.expansions)
    expect(await test.prisma.rarityRule.count()).toBeGreaterThan(0)
    expect(await test.prisma.evolutionAlias.count()).toBeGreaterThan(0)
  })

  it('finds the same functional group for Copiona and Copycat', async () => {
    const es = await get('/api/cards?q=Copiona')
    const en = await get('/api/cards?q=Copycat')
    expect(es.status).toBe(200)
    expect(en.status).toBe(200)
    type Hit = { card: { functionalGroupId: string }; group: { id: string } }
    const groupsOf = (body: { items: Hit[] }) => [...new Set(body.items.map((hit) => hit.group.id))].sort()
    expect(groupsOf(es.body)).toEqual(['B1-225'])
    expect(groupsOf(en.body)).toEqual(['B1-225'])
    expect(es.body.items.every((hit: Hit) => hit.card.functionalGroupId === hit.group.id)).toBe(true)
    expect(es.body.items[0].card).not.toHaveProperty('attacks')

    const group = await get('/api/groups/B1-225')
    expect(group.status).toBe(200)
    expect(group.body.group).toMatchObject({
      id: 'B1-225',
      nameEs: 'Copiona',
      nameEn: 'Copycat',
      cardType: 'trainer',
      editionCount: COPYCAT_GROUP.length,
      playable: 0,
      fromStock: 0,
      adjustment: null,
      decks: [],
    })
    expect(group.body.group.editions.map((edition: { card: { id: string } }) => edition.card.id)).toEqual(COPYCAT_GROUP)
  })

  it('finds Iono by her Spanish name and resolves linked reprints to one stock unit', async () => {
    const enigma = await get('/api/cards?q=e-Nigma&limit=5')
    expect(enigma.body.items.length).toBeGreaterThan(0)
    expect(enigma.body.items[0].card.nameEn).toBe('Iono')

    const twin = await get('/api/cards/A4b-1')
    expect(twin.status).toBe(200)
    expect(twin.body.card.id).toBe('A4b-1')
    expect(twin.body.card.attacks.length).toBeGreaterThan(0)
    expect(twin.body.group.id).toBe('A1-1')
    const twinEdition = twin.body.group.editions.find(
      (edition: { card: { id: string } }) => edition.card.id === 'A4b-1',
    )
    expect(twinEdition.card.stockCardId).toBe('A1-1')
    expect(twinEdition.twinCardIds).toEqual(['A1-1'])
    const promo = await get('/api/cards/P-A-23')
    expect(promo.body.group.id).toBe('A1-1')
    const promoEdition = promo.body.group.editions.find(
      (edition: { card: { id: string } }) => edition.card.id === 'P-A-23',
    )
    expect(promoEdition.card.stockCardId).toBe('P-A-23')
    expect(promoEdition.twinCardIds).toEqual([])

    const missing = await get('/api/cards/Z9-999')
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('not_found')
    const expansions = await get('/api/expansions')
    expect(expansions.body.items).toHaveLength(EXPECTED.expansions)
    expect(expansions.body.items[0].id).toBe('A1')
    expect(expansions.body.items[0].packs.length).toBeGreaterThan(0)
    expect(expansions.body.items[0].packs[0]).not.toHaveProperty('cardIds')
    const bySet = await get('/api/cards?expansion=A1&limit=3')
    expect(bySet.body.items.map((card: { id: string }) => card.id)).toEqual(['A1-1', 'A1-2', 'A1-3'])
    expect(bySet.body.total).toBeGreaterThan(200)
  })

  it('joins the owner data into the group detail (stock, playable copies, adjustment, decks)', async () => {
    // Stock lives per stock unit (invariant I3): B4b-225 is a linked reprint of B1-225 and shares its row.
    type Edition = { card: { id: string; stockCardId: string }; owned: number; twinCardIds: string[] }
    const empty = await get('/api/groups/B1-225')
    const stockUnits = [...new Set((empty.body.group.editions as Edition[]).map((edition) => edition.card.stockCardId))]
    expect(stockUnits.length).toBeGreaterThanOrEqual(2)
    expect(stockUnits.length).toBeLessThan(COPYCAT_GROUP.length)
    const [firstUnit, secondUnit] = stockUnits as [string, string]
    await test.prisma.collectionStock.createMany({
      data: [
        { cardId: firstUnit, amountOwned: 2, collected: true, source: 'manual' },
        { cardId: secondUnit, amountOwned: 1, collected: true, source: 'manual' },
      ],
    })
    const deck = await test.prisma.deck.create({ data: { name: 'Prueba', energies: ['psychic'], tags: [] } })
    await test.prisma.deckCard.create({ data: { deckId: deck.id, cardId: 'B4b-225', count: 2, position: 0 } })

    const withStock = await get('/api/groups/B1-225')
    expect(withStock.body.group).toMatchObject({ playable: 3, fromStock: 3, adjustment: null })
    for (const edition of withStock.body.group.editions as Edition[]) {
      const expected = edition.card.stockCardId === firstUnit ? 2 : edition.card.stockCardId === secondUnit ? 1 : 0
      expect(edition.owned, edition.card.id).toBe(expected)
    }
    expect(withStock.body.group.decks).toEqual([{ id: String(deck.id), name: 'Prueba', count: 2, builtInGame: false }])

    const adjustment = await test.prisma.collectionAdjustment.create({
      data: { functionalGroupId: 'B1-225', playableCopies: 2, reason: 'una está en otro mazo' },
    })
    const adjusted = await get('/api/groups/B1-225')
    expect(adjusted.body.group).toMatchObject({ playable: 2, fromStock: 3 })
    expect(adjusted.body.group.adjustment).toMatchObject({
      id: String(adjustment.id),
      playableCopies: 2,
      reason: 'una está en otro mazo',
    })

    await test.prisma.collectionAdjustment.deleteMany({})
    await test.prisma.deck.deleteMany({})
    await test.prisma.collectionStock.deleteMany({})
  })

  it('re-syncing the same commit through the API yields an empty diff and keeps group ids', async () => {
    const before = await get('/api/groups/B1-225')
    const started = await test.http().post('/api/catalog/sync').set('Cookie', cookie).send({ fromFixtures: true })
    expect(started.status).toBe(202)
    expect(typeof started.body.syncId).toBe('number')
    const status = await waitForSync(test, cookie, started.body.syncId)
    expect(status.lastSync.status).toBe('applied')
    expect(status.lastSync.report.diff.counts).toEqual({
      added: 0,
      removed: 0,
      internalIdChanged: 0,
      stockChanged: 0,
      groupChanged: 0,
      nameChanged: 0,
      expansionsAdded: 0,
      expansionsRemoved: 0,
    })
    expect(await test.prisma.catalogSyncChange.count({ where: { syncId: started.body.syncId } })).toBe(0)
    const after = await get('/api/groups/B1-225')
    expect(after.body).toEqual(before.body)
    expect(await test.prisma.card.count()).toBe(EXPECTED.cards)
  })

  it('guards the sync trigger and the read API behind the session', async () => {
    expect((await test.http().post('/api/catalog/sync').send({ fromFixtures: true })).status).toBe(401)
    expect((await test.http().get('/api/cards?q=Pikachu')).status).toBe(401)
    const badSha = await test.http().post('/api/catalog/sync').set('Cookie', cookie).send({ commit: 'abc' })
    expect(badSha.status).toBe(400)
    expect(badSha.body.error.code).toBe('validation')
  })
})
