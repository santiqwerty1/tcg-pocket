import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SchedulerRegistry } from '@nestjs/schedule'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogRepository } from '../src/catalog/catalog-repository.js'
import { DEFAULT_FIXTURES_DIR as FIXTURES_DIR } from '../src/catalog/catalog-sources.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { TrackerCommitsService } from '../src/catalog/tracker-commits.service.js'
import type { CatalogSyncStatus } from '../src/generated/prisma/enums.js'
import { createTestApp, login, seedOwner, type TestApp, waitForSync } from './helpers.js'

/** Expected values from docs/PLAN.md §7 (M1 acceptance) for the pinned commit 3ab58f1. */
const EXPECTED = { cards: 4317, expansions: 24, groups: 2319, stockUnits: 3866 }
const COPYCAT_GROUP = ['B1-225', 'B1-270', 'B4b-225', 'B4b-391', 'B4b-424']

const EXPECTED_MISSIONS = 443

describe('catalog (e2e)', () => {
  let test: TestApp
  let cookie: string
  let sync: CatalogSyncService

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    sync = test.app.get(CatalogSyncService)
    // The tests write catalog_syncs rows by hand: the server's minute must not load them in between (they call catchUp).
    test.app.get(SchedulerRegistry).getCronJob('catalog-memory').stop()
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
    const hashes = Object.keys(row.fileHashes as Record<string, unknown>)
    // 9 tracker and engine files, the image manifest (Fase 22) and 21 mission files.
    expect(hashes).toHaveLength(9 + 1 + 21)
    expect(hashes).toContain('imageLocales')
    expect(hashes.filter((key) => key.startsWith('missions:'))).toHaveLength(21)
    expect(row.missions as unknown[]).toHaveLength(EXPECTED_MISSIONS)
    // Missions against an empty collection: none complete, every one listed.
    const missions = await test.http().get('/api/collection/missions').set('Cookie', cookie)
    expect(missions.body).toMatchObject({ total: EXPECTED_MISSIONS, complete: 0 })
    expect(missions.body.items[0].slots[0]).toMatchObject({ have: 0 })
    expect(missions.body.expansions.length).toBe(21)
    expect(await test.prisma.card.count()).toBe(EXPECTED.cards)
    // C1: the printed types as a list, written and read back (one per Pokémon until C1, none for a trainer).
    expect((await test.prisma.card.findUniqueOrThrow({ where: { id: 'A1-1' } })).types).toEqual(['grass'])
    expect((await test.prisma.card.findUniqueOrThrow({ where: { id: 'P-A-1' } })).types).toEqual([])
    expect(await test.prisma.card.count({ where: { cardType: 'pokemon', types: { isEmpty: true } } })).toBe(0)
    expect(test.app.get(CatalogService).requireIndex().cardById('A1-1')?.types).toEqual(['grass'])
    // A row written before the column existed (empty list) loads with its one energy.
    await test.prisma.card.update({ where: { id: 'A1-1' }, data: { types: [] } })
    const loaded = await test.app.get(CatalogRepository).loadCatalog()
    expect(loaded?.catalog.cards.find((card) => card.id === 'A1-1')?.types).toEqual(['grass'])
    await test.prisma.card.update({ where: { id: 'A1-1' }, data: { types: ['grass'] } })
    expect(await test.prisma.functionalGroup.count()).toBe(EXPECTED.groups)
    expect(await test.prisma.expansion.count()).toBe(EXPECTED.expansions)
    expect(await test.prisma.rarityRule.count()).toBeGreaterThan(0)
    expect(await test.prisma.evolutionAlias.count()).toBeGreaterThan(0)
  })

  it('C1: the card_types migration fills each Pokémon’s list from its energy on rows written before it', async () => {
    // The real migration file, run over the synced catalog without the column (as production had it), then undone.
    const sql = readFileSync(
      join(import.meta.dirname, '../prisma/migrations/20261022220000_card_types/migration.sql'),
      'utf8',
    )
    const statements = sql
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '')
    expect(statements).toHaveLength(2)
    class Undo extends Error {
      constructor(readonly counts: unknown) {
        super('undo')
      }
    }
    const counts = await test.prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "cards" DROP COLUMN "types"')
        for (const statement of statements) await tx.$executeRawUnsafe(statement)
        const [row] = await tx.$queryRawUnsafe<{ pokemon: number; trainers: number; other: number }[]>(
          `SELECT count(*) FILTER (WHERE card_type = 'pokemon' AND types = ARRAY[energy])::int AS pokemon,
                  count(*) FILTER (WHERE card_type = 'trainer' AND types = '{}')::int AS trainers,
                  count(*) FILTER (WHERE NOT ((card_type = 'pokemon' AND types = ARRAY[energy])
                                           OR (card_type = 'trainer' AND types = '{}')))::int AS other
             FROM cards`,
        )
        throw new Undo(row)
      })
      .catch((error: unknown) => {
        if (error instanceof Undo) return error.counts
        throw error
      })
    expect(counts).toEqual({ pokemon: 3922, trainers: 395, other: 0 })
    // Undone: the column and what the sync wrote are still there.
    expect((await test.prisma.card.findUniqueOrThrow({ where: { id: 'A1-1' } })).types).toEqual(['grass'])
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

  it("re-syncing never overwrites the owner's rarity rules and only seeds missing rarities (DECISIONES 1.10)", async () => {
    const seeded = await test.prisma.rarityRule.findUniqueOrThrow({ where: { rarity: '◊' } })
    expect(seeded).toMatchObject({ pointsVerified: false, tradeable: true })
    await test.prisma.rarityRule.update({
      where: { rarity: '◊' },
      data: { points: 999, pointsVerified: true, tradeable: false },
    })
    await test.prisma.rarityRule.delete({ where: { rarity: '◊◊' } })

    const summary = await sync.sync({
      trackerCommit: test.env.catalogCommit,
      engineRev: test.env.engineRev,
      source: 'fixtures',
    })
    expect(summary.status).toBe('applied')
    expect(await test.prisma.rarityRule.findUniqueOrThrow({ where: { rarity: '◊' } })).toMatchObject({
      points: 999,
      pointsVerified: true,
      tradeable: false,
    })
    // A rarity that is missing (deleted, or new in the tracker) is seeded with the defaults.
    expect(await test.prisma.rarityRule.findUniqueOrThrow({ where: { rarity: '◊◊' } })).toMatchObject({
      pointsVerified: false,
      tradeable: true,
    })
    await test.prisma.rarityRule.update({ where: { rarity: '◊' }, data: { points: seeded.points } })
  })

  it('closes at startup a sync left running by a previous process, without touching the catalog', async () => {
    const stale = await test.prisma.catalogSync.create({
      data: {
        commitSha: test.env.catalogCommit,
        engineRev: test.env.engineRev,
        source: 'fixtures',
        status: 'running',
        fetchedAt: new Date(),
        fileHashes: {},
        counts: {},
      },
    })
    expect((await get('/api/catalog/status')).body.lastSync).toMatchObject({ id: stale.id, status: 'running' })
    await sync.onModuleInit()
    const status = await get('/api/catalog/status')
    expect(status.body.lastSync).toMatchObject({ id: stale.id, status: 'failed' })
    expect(status.body.lastSync.error).toContain('reinició')
    expect(status.body.loaded).toBe(true)
    expect(status.body.trackerCommit).toBe(test.env.catalogCommit)
    expect(await test.prisma.card.count()).toBe(EXPECTED.cards)
  })

  const syncRow = (heartbeatAt: Date | null, fetchedAt = new Date(), status: CatalogSyncStatus = 'running') =>
    test.prisma.catalogSync.create({
      data: {
        commitSha: test.env.catalogCommit,
        engineRev: test.env.engineRev,
        source: 'fixtures',
        status,
        fetchedAt,
        heartbeatAt,
        fileHashes: {},
        counts: {},
      },
    })
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

  it('closes a sync without signs of life for 5 minutes, without waiting for a restart (the low of #75)', async () => {
    // The alerts need a loaded catalog: run alone, this test syncs it first. Then it stays as it was.
    if ((await test.prisma.card.count()) === 0)
      await sync.sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    const cards = await test.prisma.card.count()
    // Finished ones with an old sign of life are not touched.
    const finished = [
      await syncRow(minutesAgo(30), minutesAgo(31), 'applied'),
      await syncRow(minutesAgo(30), minutesAgo(31), 'needs_review'),
      await syncRow(null, minutesAgo(31), 'failed'),
    ]
    // A CLI cut in `flyctl machine exec`: its last sign of life, 6 minutes ago. One of before the heartbeat, 10.
    const cut = await syncRow(minutesAgo(6), minutesAgo(7))
    const old = await syncRow(null, minutesAgo(10))
    // Still alive: its sign of life is a minute old; and one of before the heartbeat that started a minute ago.
    const alive = await syncRow(minutesAgo(1), minutesAgo(2))
    const young = await syncRow(null, minutesAgo(1))
    const ids = [...finished, cut, old, alive, young].map((row) => row.id)
    try {
      // What the server's cron runs (registered by name). The states, not the count: the real cron may get there first.
      expect(test.app.get(SchedulerRegistry).getCronJob('catalog-sync-stale')).toBeDefined()
      await sync.everyMinute()
      const byId = async (id: number) => test.prisma.catalogSync.findUniqueOrThrow({ where: { id } })
      for (const closed of [cut, old]) {
        expect(await byId(closed.id)).toMatchObject({
          status: 'failed',
          error: expect.stringContaining('Interrumpida'),
        })
      }
      for (const running of [alive, young]) expect((await byId(running.id)).status).toBe('running')
      for (const row of finished) expect(await byId(row.id)).toEqual(row)
      // The catalog stays as it was, and the alert of a failed sync says it once the last one is a closed one.
      expect(await test.prisma.card.count()).toBe(cards)
      await test.prisma.catalogSync.deleteMany({ where: { id: { in: [alive.id, young.id] } } })
      const alerts = (await get('/api/alerts')).body.items as { code: string; detail: string }[]
      const detail = alerts.find((alert) => alert.code === 'catalog_sync')?.detail
      expect(detail).toContain('Interrumpida')
      expect(detail).not.toContain('..')
    } finally {
      await test.prisma.catalogSync.deleteMany({ where: { id: { in: ids } } })
    }
  })

  it('a sync with signs of life in another process is a 409, and a silent one does not block (the low of #75)', async () => {
    const request = {
      trackerCommit: test.env.catalogCommit,
      engineRev: test.env.engineRev,
      source: 'fixtures' as const,
    }
    // A CLI running next to the API (and one of before the heartbeat that started a minute ago).
    const other = await syncRow(minutesAgo(1), minutesAgo(2))
    try {
      for (const data of [{}, { heartbeatAt: null, fetchedAt: minutesAgo(1) }]) {
        await test.prisma.catalogSync.update({ where: { id: other.id }, data })
        await expect(sync.sync(request)).rejects.toThrow(`otro proceso (#${other.id}`)
        expect(sync.isRunning).toBe(false)
        expect(await test.prisma.catalogSync.count({ where: { id: { gt: other.id } } })).toBe(0)
      }
      // Silent for 6 minutes: dead even if the cron has not closed it yet.
      await test.prisma.catalogSync.update({
        where: { id: other.id },
        data: { heartbeatAt: minutesAgo(6), fetchedAt: minutesAgo(7) },
      })
      expect((await sync.sync(request)).status).toBe('applied')
    } finally {
      await test.prisma.catalogSync.delete({ where: { id: other.id } })
    }
  })

  it('a running sync renews its sign of life, so the API never closes it while it runs (the low of #75)', async () => {
    sync.heartbeatMs = 20
    try {
      const summary = await sync.sync({
        trackerCommit: test.env.catalogCommit,
        engineRev: test.env.engineRev,
        source: 'fixtures',
      })
      const done = await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: summary.syncId } })
      // Renewed after it started (the first sign of life is the start itself, at the same instant).
      expect(done.heartbeatAt?.getTime() ?? 0).toBeGreaterThan(done.fetchedAt.getTime())
      expect(done.status).toBe('applied')
    } finally {
      sync.heartbeatMs = 30_000
    }
  })

  it('a sync closed as interrupted that was still alive ends applied, without the error (the low of #75)', async () => {
    // A process that went 5 minutes without a sign of life but was not dead: the API closes it, and then it commits.
    const repository = test.app.get(CatalogRepository)
    const replace = repository.replaceCatalog.bind(repository)
    const spy = vi.spyOn(repository, 'replaceCatalog').mockImplementation(async (...args) => {
      const [, outcome] = args
      expect(await sync.closeStale(new Date(Date.now() + 10 * 60_000))).toBe(1)
      // Once closed, its own heartbeat no longer renews it (several beats go by).
      const beatAt = async () =>
        (await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: outcome.syncId } })).heartbeatAt
      const closedAt = await beatAt()
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(await beatAt()).toEqual(closedAt)
      return replace(...args)
    })
    sync.heartbeatMs = 20
    try {
      const summary = await sync.sync({
        trackerCommit: test.env.catalogCommit,
        engineRev: test.env.engineRev,
        source: 'fixtures',
      })
      expect(spy).toHaveBeenCalledOnce()
      expect(summary.status).toBe('applied')
      expect(await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: summary.syncId } })).toMatchObject({
        status: 'applied',
        error: null,
      })
    } finally {
      sync.heartbeatMs = 30_000
      spy.mockRestore()
    }
  })

  it('a sync applied by another process is loaded within a minute; until then the alert says it (the low 4 of #95)', async () => {
    if ((await test.prisma.card.count()) === 0)
      await sync.sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    const catalog = test.app.get(CatalogService)
    const before = catalog.loadedSyncId
    expect(before).not.toBeNull()
    expect(test.app.get(SchedulerRegistry).getCronJob('catalog-memory')).toBeDefined()
    const memoryAlert = async () =>
      ((await get('/api/alerts')).body.items as { code: string; detail: string }[]).find(
        (alert) => alert.code === 'catalog_memory',
      )
    expect(await memoryAlert()).toBeUndefined()
    // A `catalog-sync.js` next to the API: the database has a newer applied sync than the one in memory, of another
    // commit (the tables are the same: only the row says it).
    const other = await test.prisma.catalogSync.update({
      where: { id: (await syncRow(new Date(), new Date(), 'applied')).id },
      data: { commitSha: 'f'.repeat(40) },
    })
    expect(catalog.trackerCommit).not.toBe(other.commitSha)
    try {
      expect(await memoryAlert()).toMatchObject({
        detail: expect.stringContaining(`#${other.id}`),
      })
      expect((await get('/api/ops/status')).body.catalog).toMatchObject({
        loadedSyncId: before,
        latestAppliedSyncId: other.id,
      })
      // «Sincronizar» repeats the database's last commit, not the memory's (that would undo the CLI's sync).
      expect(await catalog.appliedCommit()).toBe(other.commitSha)
      const start = vi.spyOn(sync, 'start').mockResolvedValue({ syncId: 0 })
      try {
        expect(
          (await test.http().post('/api/catalog/sync').set('Cookie', cookie).send({ fromFixtures: true })).status,
        ).toBe(202)
        expect(start).toHaveBeenCalledWith(expect.objectContaining({ trackerCommit: other.commitSha }))
        // Asking for the memory's commit by name is going back from the database's: it needs confirming, even though
        // it is the one in memory (compared with the memory's, it would be «same» and pass).
        const commits = test.app.get(TrackerCommitsService)
        const compared: string[] = []
        commits.fetchImpl = async (input) => {
          compared.push(String(input))
          return Response.json({ status: 'behind', ahead_by: 0, behind_by: 2 })
        }
        try {
          const back = await test
            .http()
            .post('/api/catalog/sync')
            .set('Cookie', cookie)
            .send({ commit: test.env.catalogCommit })
          expect(back.status).toBe(409)
          expect(back.body.error.code).toBe('confirm_required')
          expect(compared[0]).toContain(`/compare/${other.commitSha}...${test.env.catalogCommit}`)
        } finally {
          commits.fetchImpl = fetch
        }
        expect(start).toHaveBeenCalledTimes(1)
      } finally {
        start.mockRestore()
      }
      // Not while this process syncs: it reloads at its end, and the alert does not blame a CLI meanwhile.
      const state = sync as unknown as { running: boolean }
      state.running = true
      try {
        expect(await sync.catchUp()).toBe(false)
        expect(await memoryAlert()).toBeUndefined()
      } finally {
        state.running = false
      }
      // A load that fails keeps the old catalog and says why.
      const repository = test.app.get(CatalogRepository)
      const failing = vi.spyOn(repository, 'loadCatalog').mockRejectedValueOnce(new Error('la base no contestó.'))
      try {
        expect(await sync.catchUp()).toBe(false)
      } finally {
        failing.mockRestore()
      }
      expect(catalog.loadedSyncId).toBe(before)
      expect((await memoryAlert())?.detail).toContain('El último intento falló: la base no contestó.')
      // The next minute loads it, once even if two ticks overlap: the alert goes, and once loaded nothing more happens.
      const reload = vi.spyOn(catalog, 'reload')
      try {
        expect((await Promise.all([sync.catchUp(), sync.catchUp()])).sort()).toEqual([false, true])
        expect(reload).toHaveBeenCalledTimes(1)
      } finally {
        reload.mockRestore()
      }
      expect(catalog.loadedSyncId).toBe(other.id)
      expect(await memoryAlert()).toBeUndefined()
      expect(await sync.catchUp()).toBe(false)
      expect(await test.prisma.card.count()).toBe(EXPECTED.cards)
    } finally {
      await test.prisma.catalogSync.delete({ where: { id: other.id } })
      await catalog.reload()
    }
    expect(catalog.loadedSyncId).toBe(before)
  })

  it('a sync whose load into memory fails after its commit stays applied, and the next minute loads it', async () => {
    const catalog = test.app.get(CatalogService)
    const before = catalog.loadedSyncId
    const failing = vi.spyOn(catalog, 'reload').mockRejectedValueOnce(new Error('sin memoria'))
    try {
      const summary = await sync.sync({
        trackerCommit: test.env.catalogCommit,
        engineRev: test.env.engineRev,
        source: 'fixtures',
      })
      expect(summary.status).toBe('applied')
      expect(await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: summary.syncId } })).toMatchObject({
        status: 'applied',
        error: null,
      })
      expect(catalog.loadedSyncId).toBe(before)
      failing.mockRestore()
      expect(await sync.catchUp()).toBe(true)
      expect(catalog.loadedSyncId).toBe(summary.syncId)
    } finally {
      failing.mockRestore()
    }
  })

  it('an applied sync without cards does not empty the catalog in memory', async () => {
    const catalog = test.app.get(CatalogService)
    const before = catalog.loadedSyncId
    const empty = vi.spyOn(test.app.get(CatalogRepository), 'loadCatalog').mockResolvedValueOnce(null)
    try {
      await expect(catalog.reload()).rejects.toThrow('no tiene cartas')
      expect(catalog.loaded).toBe(true)
      expect(catalog.loadedSyncId).toBe(before)
    } finally {
      empty.mockRestore()
    }
  })

  it('a commit that merges stock units and drops an edition takes the owner data with it (I12, Fase 21)', async () => {
    // A copy of the fixtures where B4b-391 shares B1-225's internal id (one stock unit) and B4b-424 is gone.
    const dir = mkdtempSync(join(tmpdir(), 'tcg-catalog-'))
    cpSync(FIXTURES_DIR, dir, { recursive: true })
    const cardsPath = join(dir, 'tracker/cards.json')
    const original = JSON.parse(readFileSync(cardsPath, 'utf8')) as {
      card_id: string
      internal_id: number
      alternate_versions: number[]
    }[]
    const gone = original.find((card) => card.card_id === 'B4b-424')?.internal_id
    const changed = original
      .filter((card) => card.card_id !== 'B4b-424')
      .map((card) => ({
        ...card,
        internal_id: card.card_id === 'B4b-391' ? 800833 : card.internal_id,
        alternate_versions: card.alternate_versions.filter((id) => id !== gone && id !== 1466817),
      }))
    writeFileSync(cardsPath, JSON.stringify(changed))

    await test.prisma.collectionStock.createMany({
      data: [
        { cardId: 'B1-225', amountOwned: 2, collected: true, source: 'manual' },
        { cardId: 'B4b-391', amountOwned: 1, collected: true, source: 'manual' },
      ],
    })
    const deck = await test.prisma.deck.create({
      data: {
        name: 'Remapeo',
        energies: ['psychic'],
        tags: [],
        keyCards: [{ functionalGroupId: 'B1-225', role: 'setup' }],
      },
    })
    await test.prisma.deckCard.create({ data: { deckId: deck.id, cardId: 'B4b-424', count: 1, position: 0 } })
    const adjustment = await test.prisma.collectionAdjustment.create({
      data: { functionalGroupId: 'B1-225', playableCopies: 2 },
    })
    try {
      const merged = await sync.sync({
        trackerCommit: test.env.catalogCommit,
        engineRev: test.env.engineRev,
        source: 'fixtures',
        fixturesDir: dir,
      })
      expect(merged.status).toBe('needs_review')
      expect(merged.diff).toMatchObject({ removed: 1 })
      expect(merged.warnings.join('\n')).toMatch(/junta ahora ediciones que tenían cantidades distintas \(2, 1\)/)
      expect(await test.prisma.collectionStock.findMany({ orderBy: { cardId: 'asc' } })).toEqual([
        expect.objectContaining({ cardId: 'B1-225', amountOwned: 2, collected: true }),
      ])
      const group = (await get('/api/groups/B1-225')).body.group as { displayCardId: string }
      const cards = await test.prisma.deckCard.findMany({ where: { deckId: deck.id } })
      expect(cards).toEqual([expect.objectContaining({ cardId: group.displayCardId, count: 1, position: 0 })])
      expect(await test.prisma.card.findUnique({ where: { id: 'B4b-424' } })).toBeNull()
      expect((await test.prisma.collectionAdjustment.findUnique({ where: { id: adjustment.id } }))?.active).toBe(true)
      const report = (await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: merged.syncId } })).report as {
        remap: { notes: { kind: string }[] }
      }
      expect(report.remap.notes.map((note) => note.kind)).toEqual(['stock_merge', 'deck_card_replaced'])

      // Back to the pinned fixtures: the unit splits again and both editions keep the copies (for review).
      const split = await sync.sync({
        trackerCommit: test.env.catalogCommit,
        engineRev: test.env.engineRev,
        source: 'fixtures',
      })
      expect(split.status).toBe('needs_review')
      expect(split.warnings.join('\n')).toMatch(/se separó en/)
      expect(
        (await test.prisma.collectionStock.findMany({ orderBy: { cardId: 'asc' } })).map((row) => [
          row.cardId,
          row.amountOwned,
        ]),
      ).toEqual([
        ['B1-225', 2],
        ['B4b-391', 2],
      ])
      expect(await test.prisma.card.count()).toBe(EXPECTED.cards)
    } finally {
      await test.prisma.collectionAdjustment.deleteMany({})
      await test.prisma.deck.deleteMany({})
      await test.prisma.collectionStock.deleteMany({})
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('C1: a cards.json field the catalog does not read shows in the preview and needs confirming; type changes count', async () => {
    // A second type written apart (an invented shape) and Urshifu with two types in the list.
    const dir = mkdtempSync(join(tmpdir(), 'tcg-catalog-'))
    cpSync(FIXTURES_DIR, dir, { recursive: true })
    const cardsPath = join(dir, 'tracker/cards.json')
    const original = JSON.parse(readFileSync(cardsPath, 'utf8')) as { card_id: string; energy: unknown }[]
    writeFileSync(
      cardsPath,
      JSON.stringify(
        original.map((card) =>
          card.card_id === 'B3-51'
            ? { ...card, energy: ['water', 'fighting'] }
            : card.card_id === 'A1-1'
              ? { ...card, energy2: 'darkness' }
              : card,
        ),
      ),
    )
    const request = {
      trackerCommit: test.env.catalogCommit,
      engineRev: test.env.engineRev,
      source: 'fixtures' as const,
      fixturesDir: dir,
    }
    try {
      const preview = await sync.preview(request)
      expect(preview).toMatchObject({
        destructive: true,
        diffEmpty: false,
        diff: { added: 0, removed: 0, typesChanged: 1 },
        unknownFields: [{ field: 'energy2', cards: 1 }],
      })
      expect(preview.warnings).toContain("cards.json has a field the catalog does not read: 'energy2' (1 cards)")
      // From the app without confirming: refused, saying which field.
      await expect(sync.sync({ ...request, guard: true })).rejects.toThrow(/campos que el catálogo no lee \(energy2\)/)
      expect((await test.prisma.card.findUniqueOrThrow({ where: { id: 'B3-51' } })).types).toEqual(['water'])
      // Confirmed: it applies, the change row says the types moved.
      const applied = await sync.sync({ ...request, guard: true, confirm: true })
      expect(applied.status).toBe('applied')
      expect((await test.prisma.card.findUniqueOrThrow({ where: { id: 'B3-51' } })).types).toEqual([
        'water',
        'fighting',
      ])
      const change = await test.prisma.catalogSyncChange.findFirst({
        where: { syncId: applied.syncId, field: 'types' },
      })
      expect(change).toMatchObject({ cardId: 'B3-51', old: 'water', new: 'water/fighting' })
    } finally {
      await sync.sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Fase 40 (H-004): preview first, nothing written; a sync that takes cards away needs confirming', async () => {
    // The same altered fixtures as above: B4b-391 joins B1-225's stock unit and B4b-424 leaves the catalog.
    const dir = mkdtempSync(join(tmpdir(), 'tcg-catalog-'))
    cpSync(FIXTURES_DIR, dir, { recursive: true })
    const cardsPath = join(dir, 'tracker/cards.json')
    const original = JSON.parse(readFileSync(cardsPath, 'utf8')) as {
      card_id: string
      internal_id: number
      alternate_versions: number[]
    }[]
    const gone = original.find((card) => card.card_id === 'B4b-424')?.internal_id
    writeFileSync(
      cardsPath,
      JSON.stringify(
        original
          .filter((card) => card.card_id !== 'B4b-424')
          .map((card) => ({
            ...card,
            internal_id: card.card_id === 'B4b-391' ? 800833 : card.internal_id,
            alternate_versions: card.alternate_versions.filter((id) => id !== gone && id !== 1466817),
          })),
      ),
    )
    const deck = await test.prisma.deck.create({ data: { name: 'Vista previa', energies: ['psychic'], tags: [] } })
    await test.prisma.deckCard.create({ data: { deckId: deck.id, cardId: 'B4b-424', count: 1, position: 0 } })
    const request = {
      trackerCommit: test.env.catalogCommit,
      engineRev: test.env.engineRev,
      source: 'fixtures' as const,
      fixturesDir: dir,
    }
    try {
      const syncsBefore = await test.prisma.catalogSync.count()
      const preview = await sync.preview(request)
      expect(preview).toMatchObject({
        destructive: true,
        diffEmpty: false,
        diff: { removed: 1, added: 0 },
        removed: [{ cardId: 'B4b-424' }],
        remap: { needsReview: false },
      })
      // The deck card moves to another edition of the same card: nothing to review, but a card leaves the catalog.
      expect(preview.remap?.notes.map((note) => note.kind)).toEqual(['deck_card_replaced'])
      // Nothing written: no sync row, the card and the deck card are still there.
      expect(await test.prisma.catalogSync.count()).toBe(syncsBefore)
      expect(await test.prisma.card.findUnique({ where: { id: 'B4b-424' } })).not.toBeNull()

      // From the app (guarded) without confirming: the row fails saying why, and nothing changes.
      await expect(sync.sync({ ...request, guard: true })).rejects.toThrow(/Hace falta confirmar/)
      const refused = await test.prisma.catalogSync.findFirstOrThrow({ orderBy: { id: 'desc' } })
      expect(refused).toMatchObject({ status: 'failed' })
      expect(refused.error).toMatch(/Hace falta confirmar/)
      expect(await test.prisma.card.findUnique({ where: { id: 'B4b-424' } })).not.toBeNull()
      expect(await test.prisma.deckCard.count({ where: { deckId: deck.id, cardId: 'B4b-424' } })).toBe(1)

      // Confirmed: it applies.
      const applied = await sync.sync({ ...request, guard: true, confirm: true })
      expect(applied.status).toBe('applied')
      expect(await test.prisma.card.findUnique({ where: { id: 'B4b-424' } })).toBeNull()
    } finally {
      await sync.sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
      await test.prisma.deck.deleteMany({})
      await test.prisma.collectionStock.deleteMany({})
      rmSync(dir, { recursive: true, force: true })
    }
    // Through HTTP, the loaded commit against itself: nothing changes, nothing to confirm.
    const same = await test.http().post('/api/catalog/preview').set('Cookie', cookie).send({ fromFixtures: true })
    expect(same.status).toBe(200)
    expect(same.body).toMatchObject({ diffEmpty: true, destructive: false, older: false, removed: [] })
    expect(same.body.baseline).toMatch(/^[0-9a-f]{40}@\d+$/)
    // Another sync after the preview: applying what the preview showed is refused (the baseline moved).
    await sync.sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    const stale = await test
      .http()
      .post('/api/catalog/sync')
      .set('Cookie', cookie)
      .send({ fromFixtures: true, baseline: same.body.baseline })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('stale_preview')
    const fresh = await test.http().post('/api/catalog/preview').set('Cookie', cookie).send({ fromFixtures: true })
    const applied = await test
      .http()
      .post('/api/catalog/sync')
      .set('Cookie', cookie)
      .send({ fromFixtures: true, baseline: fresh.body.baseline })
    expect(applied.status).toBe(202)
    await waitForSync(test, cookie, applied.body.syncId)
  })

  it('Fase 40 (H-004): «Sincronizar» repeats the loaded commit, never the configured pin', async () => {
    const loaded = 'a'.repeat(40)
    await sync.sync({ trackerCommit: loaded, engineRev: test.env.engineRev, source: 'fixtures' })
    try {
      const started = await test.http().post('/api/catalog/sync').set('Cookie', cookie).send({ fromFixtures: true })
      expect(started.status).toBe(202)
      await waitForSync(test, cookie, started.body.syncId)
      const row = await test.prisma.catalogSync.findUniqueOrThrow({ where: { id: started.body.syncId } })
      expect(row.commitSha).toBe(loaded)
      expect(row.commitSha).not.toBe(test.env.catalogCommit)
    } finally {
      await sync.sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    }
  })

  it("Fase 40: the tracker's newest commit, and going back to an older one needs confirming", async () => {
    const commits = test.app.get(TrackerCommitsService)
    const newest = 'b'.repeat(40)
    const older = 'c'.repeat(40)
    const calls: string[] = []
    commits.fetchImpl = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/commits/main')) {
        return Response.json({
          sha: newest,
          commit: { message: 'Add B5\n\nlong text', committer: { date: '2026-10-29T12:00:00Z' } },
        })
      }
      if (url.endsWith(`...${newest}`)) return Response.json({ status: 'ahead', ahead_by: 3, behind_by: 0 })
      if (url.endsWith(`...${older}`)) return Response.json({ status: 'behind', ahead_by: 0, behind_by: 7 })
      return new Response('not found', { status: 404 })
    }
    try {
      const latest = await get('/api/catalog/latest')
      expect(latest.body).toEqual({
        current: test.env.catalogCommit,
        latest: { sha: newest, date: '2026-10-29T12:00:00Z', message: 'Add B5' },
        comparison: { status: 'ahead', aheadBy: 3, behindBy: 0 },
        error: null,
      })
      expect(calls[1]).toContain(`/compare/${test.env.catalogCommit}...${newest}`)
      const back = await test.http().post('/api/catalog/sync').set('Cookie', cookie).send({ commit: older })
      expect(back.status).toBe(409)
      expect(back.body.error.code).toBe('confirm_required')
      // GitHub down: the page says so instead of failing.
      commits.fetchImpl = async () => new Response('rate limited', { status: 403 })
      expect((await get('/api/catalog/latest')).body).toMatchObject({
        latest: null,
        error: expect.stringMatching(/403/),
      })
      // And a sync to a commit it cannot compare asks for confirmation (it may be going back).
      const unknown = await test.http().post('/api/catalog/sync').set('Cookie', cookie).send({ commit: newest })
      expect(unknown.status).toBe(409)
      expect(unknown.body.error.message).toMatch(/No se pudo comparar/)
    } finally {
      commits.fetchImpl = fetch
    }
  })

  it('guards the sync trigger and the read API behind the session', async () => {
    expect((await test.http().post('/api/catalog/sync').send({ fromFixtures: true })).status).toBe(401)
    expect((await test.http().get('/api/cards?q=Pikachu')).status).toBe(401)
    const badSha = await test.http().post('/api/catalog/sync').set('Cookie', cookie).send({ commit: 'abc' })
    expect(badSha.status).toBe(400)
    expect(badSha.body.error.code).toBe('validation')
  })
})
