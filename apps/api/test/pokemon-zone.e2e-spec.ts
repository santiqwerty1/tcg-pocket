import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { POKEMON_ZONE_LOCK, PokemonZoneService } from '../src/pokemon-zone/pokemon-zone.service.js'
import { ADVISORY_LOCKS } from '../src/prisma/advisory-locks.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * pokemon-zone (2/11/2026): the payload the bookmarklet reads on pokemon-zone.com (the domain's made-up fixture on
 * the site's real shape), previewed, saved, compared with the previous import and with the matches logged.
 */
const FIXTURE = join(REPO_ROOT, 'packages/domain/test/fixtures/pokemon-zone/payload.json')
/** What the bookmarklet sends instead of the friend id: its SHA-256 (of the made-up 1111222233334444). */
const ACCOUNT_HASH = 'c6b25ffac5d2c50f41af3ac4d97d07d95fd4f2d5f9fcef98dc709e5741060508'

interface Stat {
  id: string
  value: number
}
/** What the tests change of the fixture; the rest goes through as read. */
interface Payload {
  mine: {
    player: { accountHash: string }
    resourceData: { packCeilPoints: { value: unknown }[]; packPowerChargers: { value: number }[] }
  }
  stats: {
    syncedAt: string
    battles?: Stat[]
    headline: Stat[]
    packsByExpansion: { expansionId: string; packsOpened: number; cardsObtained: number }[]
    packs: { packId: string; opened: number }[]
    cardsByRarity: { rarity: string; obtained: number }[]
  }
}
const payload = (): Payload => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Payload
const first = <T>(items: T[]): T => items[0] as T

const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

/** The fixture read by pokemon-zone at `syncedAt`, with `more` added to some counters. */
function later(syncedAt: string, more: { ranked?: [number, number]; versus?: [number, number]; b4bPacks?: number }) {
  const next = payload()
  next.stats.syncedAt = syncedAt
  const add = (id: string, value: number) => {
    const row = next.stats.battles?.find((item) => item.id === id)
    if (row) row.value += value
  }
  if (more.ranked) {
    add('ranked_battles', more.ranked[0])
    add('ranked_wins', more.ranked[1])
    add('ranked_points', 10)
  }
  if (more.versus) {
    add('pvp_battles', more.versus[0])
    add('pvp_wins', more.versus[1])
  }
  if (more.b4bPacks) {
    const packs = more.b4bPacks
    const headline = (id: string, value: number) => {
      const row = next.stats.headline.find((item) => item.id === id)
      if (row) row.value += value
    }
    headline('packs_opened', packs)
    headline('cards_obtained', packs * 4)
    const expansion = next.stats.packsByExpansion.find((row) => row.expansionId === 'B4b')
    if (expansion) {
      expansion.packsOpened += packs
      expansion.cardsObtained += packs * 4
    }
    const pack = next.stats.packs.find((row) => row.packId === 'BN011_0010_00_000')
    if (pack) pack.opened += packs
    const common = next.stats.cardsByRarity.find((row) => row.rarity === 'C')
    if (common) common.obtained += packs * 4
  }
  return next
}

describe('pokemon-zone (e2e)', () => {
  let test: TestApp
  let cookie: string
  let deckId: string

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const deck = await post('/api/decks').send({ name: 'Mazo de prueba', energies: ['fire'], cards: [] })
    expect(deck.status).toBe(201)
    deckId = deck.body.id
  })

  afterAll(async () => {
    await test.close()
  })

  /** Dates the two settings an import writes `hoursAgo` (as if written then: before or after a read). */
  const settingsWritten = (hoursAgo: number) =>
    test.prisma
      .$executeRaw`UPDATE app_settings SET updated_at = now() - make_interval(hours => ${hoursAgo}) WHERE key IN ('packPoints', 'hourglasses')`

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)

  it('needs the session, and answers an empty summary before the first import', async () => {
    expect((await test.http().get('/api/pokemon-zone')).status).toBe(401)
    expect((await test.http().post('/api/pokemon-zone/imports').send(payload())).status).toBe(401)
    expect((await test.http().post('/api/pokemon-zone/preview').send(payload())).status).toBe(401)
    expect((await get('/api/pokemon-zone')).body).toEqual({
      imports: 0,
      latest: null,
      previous: null,
      settings: { packPoints: null, hourglasses: null },
      battles: null,
      luck: null,
    })
  })

  it('refuses another shape with 400, naming the fields and never echoing what was sent', async () => {
    const broken = payload()
    delete broken.stats.battles
    const response = await post('/api/pokemon-zone/imports').send(broken)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('validation')
    const paths = (response.body.error.details as { path: string }[]).map((item) => item.path)
    expect(paths).toEqual(['stats.battles'])
    expect(JSON.stringify(response.body)).not.toContain(ACCOUNT_HASH)
    // A field the app reads, with something that is not a count.
    const points = payload()
    first(points.mine.resourceData.packCeilPoints).value = 'muchos'
    const refusedPoints = await post('/api/pokemon-zone/imports').send(points)
    expect(refusedPoints.status).toBe(400)
    expect((refusedPoints.body.error.details as { path: string }[]).map((item) => item.path)).toEqual([
      'mine.resourceData.packCeilPoints.0.value',
    ])
    expect(JSON.stringify(refusedPoints.body)).not.toContain('muchos')
    expect((await post('/api/pokemon-zone/preview').send({ v: 1 })).status).toBe(400)
    // Review of pz/import: a read of the game in the future (it would make every real import «older») or before the
    // game existed is refused, and so is anything whose stored form would not read back.
    for (const syncedAt of ['9999-12-31T00:00:00Z', ago(-3 * 24 * HOUR), '2024-01-01T00:00:00Z']) {
      const dated = payload()
      dated.stats.syncedAt = syncedAt
      const refused = await post('/api/pokemon-zone/imports').send(dated)
      expect(refused.status, syncedAt).toBe(400)
      expect(refused.body.error.details).toEqual([{ path: 'stats.syncedAt', message: 'fecha fuera de rango' }])
    }
    const coupons = payload() as Payload & { mine: { resourceData: { tickets: unknown[] } } }
    coupons.mine.resourceData.tickets = Array.from({ length: 1001 }, (_, i) => ({
      key: `T${i}`,
      value: 1,
      name: 'Promo Card Exchange Ticket (X)',
    }))
    expect((await post('/api/pokemon-zone/imports').send(coupons)).status).toBe(400)
    expect(await test.prisma.pokemonZoneImport.count()).toBe(0)
  })

  it('previews without writing, then saves: the import, the pack points and the pack hourglasses', async () => {
    // Saved by hand before the game was read: A1 and a promo expansion the game does not list, and 3 hourglasses.
    expect((await put('/api/settings/packPoints').send({ value: { A1: 100, 'P-A': 5 } })).status).toBe(200)
    expect((await put('/api/settings/hourglasses').send({ value: 3 })).status).toBe(200)
    await settingsWritten(50)
    const first = payload()
    first.stats.syncedAt = ago(48 * HOUR)

    const preview = await post('/api/pokemon-zone/preview').send(first)
    expect(preview.status).toBe(200)
    expect(preview.body).toMatchObject({
      account: 'first',
      duplicate: false,
      older: false,
      level: 40,
      hourglasses: { before: 3, after: 18, game: 18, kept: false, editedAt: null },
      since: null,
      battles: { ranked: { battles: 340, wins: 160, orientative: false }, rankedPoints: 430 },
      totals: { packsOpened: 1226, wonderPicks: 387 },
    })
    expect(preview.body.packPoints.changes).toContainEqual({
      expansionId: 'A1',
      before: 100,
      after: 5,
      nameEs: 'Genes Formidables',
    })
    expect(preview.body.packPoints.changes).toContainEqual({ expansionId: 'C1', before: 0, after: 310, nameEs: null })
    expect(preview.body.coupons.map((coupon: { key: string; count: number }) => [coupon.key, coupon.count])).toEqual(
      expect.arrayContaining([
        ['TICKET_2610000_EV_03', 2],
        ['TICKET_2610000_EV_04', 2],
      ]),
    )
    expect(JSON.stringify(preview.body)).not.toContain(ACCOUNT_HASH)
    expect(await test.prisma.pokemonZoneImport.count()).toBe(0)
    expect((await get('/api/settings')).body).toMatchObject({ packPoints: { A1: 100, 'P-A': 5 }, hourglasses: 3 })

    const saved = await post('/api/pokemon-zone/imports').send(first)
    expect(saved.status).toBe(201)
    expect(saved.body).toMatchObject({
      duplicate: false,
      applied: {
        packPoints: preview.body.packPoints.changes.length,
        packPointsKept: 0,
        hourglasses: { before: 3, after: 18, game: 18, kept: false },
      },
    })
    const settings = (await get('/api/settings')).body
    expect(settings.hourglasses).toBe(18)
    expect(settings.packPoints).toMatchObject({ A1: 5, A3: 70, C1: 310, 'P-A': 5 })
    expect(settings.packPoints).not.toHaveProperty('B4b')

    // Not even the hash the bookmarklet sends is in the database: only the server's keyed fingerprint of it.
    const rows = await test.prisma.pokemonZoneImport.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.account).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(rows)).not.toContain(ACCOUNT_HASH)
    expect(JSON.stringify(rows)).not.toContain('jugador')

    // The same numbers saved again are the same row, and write back what was changed by hand before the read.
    expect((await put('/api/settings/hourglasses').send({ value: 4 })).status).toBe(200)
    await settingsWritten(49)
    const again = await post('/api/pokemon-zone/imports').send(first)
    expect(again.body).toMatchObject({ duplicate: true, import: { id: saved.body.import.id } })
    expect(await test.prisma.pokemonZoneImport.count()).toBe(1)
    expect((await get('/api/settings')).body.hourglasses).toBe(18)
    expect((await post('/api/pokemon-zone/preview').send(first)).body.duplicate).toBe(true)

    // Review of pz/import: changed by hand after the read, the value stays — per setting and per expansion — and the
    // preview says so; what does not differ from the last import is not a hand edit.
    expect((await put('/api/settings/hourglasses').send({ value: 6 })).status).toBe(200)
    const points = (await get('/api/settings')).body.packPoints as Record<string, number>
    expect((await put('/api/settings/packPoints').send({ value: { ...points, A1: 100 } })).status).toBe(200)
    const kept = (await post('/api/pokemon-zone/preview').send(first)).body
    expect(kept.hourglasses).toMatchObject({ before: 6, after: 6, game: 18, kept: true, editedAt: expect.any(String) })
    expect(kept.packPoints.kept).toEqual([{ expansionId: 'A1', value: 100, game: 5, nameEs: 'Genes Formidables' }])
    expect(kept.packPoints.changes).toEqual([])
    expect((await post('/api/pokemon-zone/imports').send(first)).body.applied).toMatchObject({
      packPointsKept: 1,
      hourglasses: { kept: true, after: 6 },
    })
    const now = (await get('/api/settings')).body
    expect(now.hourglasses).toBe(6)
    expect(now.packPoints).toMatchObject({ A1: 100, C1: 310 })
    // They still read as changed by hand.
    expect((await get('/api/pokemon-zone')).body.settings).toEqual({ packPoints: 'edited', hourglasses: 'edited' })
    // Back to the game's values by hand: nothing to keep any more.
    expect((await put('/api/settings/hourglasses').send({ value: 18 })).status).toBe(200)
    expect((await put('/api/settings/packPoints').send({ value: { ...points } })).status).toBe(200)
    await settingsWritten(47)
  })

  it('the summary: the latest import, where the settings came from, the counters next to the logged matches', async () => {
    // One competitive match logged a day ago (after the first import's read of the game).
    expect(
      (await post('/api/matches').send({ deckId, result: 'win', mode: 'competitive', playedAt: ago(24 * HOUR) }))
        .status,
    ).toBe(201)
    const summary = (await get('/api/pokemon-zone')).body
    expect(summary).toMatchObject({
      imports: 1,
      previous: null,
      settings: { packPoints: 'imported', hourglasses: 'imported' },
      latest: {
        level: 40,
        hourglasses: { pack: 18, wonder: 100 },
        currencies: { shopTickets: 3000 },
        totals: { packsOpened: 1226 },
      },
      battles: {
        game: {
          versus: { battles: 500, wins: 240 },
          ranked: { battles: 340, wins: 160 },
          solo: { battles: 1380, wins: 930 },
          rental: { battles: 10, wins: 7, orientative: true },
          rankedPoints: 430,
        },
        // The match was played after the import's read of the game: not counted against it.
        logged: { all: 0, competitive: 0 },
        window: null,
      },
    })
    expect(summary.battles.lifetime).toEqual([
      { kind: 'ranked', game: 340, logged: 0, notLogged: 340 },
      { kind: 'versus', game: 500, logged: 0, notLogged: 500 },
    ])
    expect(summary.luck.lifetime).toMatchObject({ packs: 1226, cards: 6883, unknownPacks: 64 })
    expect(summary.luck.lifetime.rare.observed).toBe(314)
    expect(summary.luck.since).toBeNull()
    // Edited by hand afterwards: the summary says so, for each setting.
    expect((await put('/api/settings/hourglasses').send({ value: 30 })).status).toBe(200)
    expect((await get('/api/pokemon-zone')).body.settings).toEqual({ packPoints: 'imported', hourglasses: 'edited' })
    const points = (await get('/api/settings')).body.packPoints as Record<string, number>
    expect((await put('/api/settings/packPoints').send({ value: { ...points, A1: 6 } })).status).toBe(200)
    expect((await get('/api/pokemon-zone')).body.settings).toEqual({ packPoints: 'edited', hourglasses: 'edited' })
  })

  it('a second import: since the previous one, the packs opened and the ranked matches not logged', async () => {
    // The hand edits of the test before, dated before this read (after it they would stay: see the save test).
    await settingsWritten(2)
    const firstRead = (await get('/api/pokemon-zone')).body.latest.syncedAt as string
    const secondRead = ago(HOUR)
    // The window is (previous read, latest read]: a match at the previous read was counted by it, one at the latest
    // read is in this one.
    for (const playedAt of [firstRead, secondRead]) {
      expect((await post('/api/matches').send({ deckId, result: 'loss', mode: 'casual', playedAt })).status).toBe(201)
    }
    const second = later(secondRead, { ranked: [3, 2], versus: [4, 2], b4bPacks: 5 })
    const preview = await post('/api/pokemon-zone/preview').send(second)
    expect(preview.body).toMatchObject({ account: 'same', older: false, since: { packs: 5, cards: 20 } })
    expect((await post('/api/pokemon-zone/imports').send(second)).status).toBe(201)

    const summary = (await get('/api/pokemon-zone')).body
    expect(summary.imports).toBe(2)
    expect(summary.previous).not.toBeNull()
    expect(summary.battles.window).toMatchObject({
      game: { ranked: { battles: 3, wins: 2 }, versus: { battles: 4, wins: 2 }, rankedPoints: 10 },
      logged: { all: 2, competitive: 1 },
      comparison: [
        { kind: 'ranked', game: 3, logged: 1, notLogged: 2 },
        { kind: 'versus', game: 4, logged: 2, notLogged: 2 },
      ],
    })
    expect(summary.battles.logged).toMatchObject({ all: 3, competitive: 1 })
    expect(summary.settings).toEqual({ packPoints: 'imported', hourglasses: 'imported' })
    expect(summary.luck.since).toMatchObject({ packs: 5, cards: 20, packCards: 20, otherCards: 0 })
    expect(summary.luck.since.byPack).toEqual([
      expect.objectContaining({ appPackId: 'B4b/deluxepackmega', nameEs: 'Sobre Deluxe Mega', opened: 5 }),
    ])
    expect(summary.settings.hourglasses).toBe('imported')
  })

  it('an older read is kept but does not change the settings; another account does not count as «since»', async () => {
    expect((await put('/api/settings/hourglasses').send({ value: 7 })).status).toBe(200)
    const old = payload()
    old.stats.syncedAt = ago(30 * 24 * HOUR)
    first(old.mine.resourceData.packPowerChargers).value = 99
    expect((await post('/api/pokemon-zone/preview').send(old)).body).toMatchObject({ older: true })
    const saved = await post('/api/pokemon-zone/imports').send(old)
    expect(saved.status).toBe(201)
    expect(saved.body.applied).toBeNull()
    expect((await get('/api/settings')).body.hourglasses).toBe(7)
    expect((await get('/api/pokemon-zone')).body.imports).toBe(3)
    // An older read of another account changes nothing either: the settings follow the newest read of the game.
    const otherOld = payload()
    otherOld.stats.syncedAt = ago(20 * 24 * HOUR)
    otherOld.mine.player.accountHash = 'e'.repeat(64)
    first(otherOld.mine.resourceData.packPowerChargers).value = 55
    expect((await post('/api/pokemon-zone/preview').send(otherOld)).body).toMatchObject({
      account: 'other',
      older: true,
    })
    expect((await post('/api/pokemon-zone/imports').send(otherOld)).body.applied).toBeNull()
    expect((await get('/api/settings')).body.hourglasses).toBe(7)
    // A duplicate of an older read is still older: nothing applied.
    expect((await post('/api/pokemon-zone/imports').send(old)).body).toMatchObject({ duplicate: true, applied: null })
    expect((await get('/api/pokemon-zone')).body.imports).toBe(4)

    const other = later(ago(30 * 60 * 1000), {})
    other.mine.player.accountHash = 'f'.repeat(64)
    const preview = (await post('/api/pokemon-zone/preview').send(other)).body
    expect(preview).toMatchObject({ account: 'other', since: null })
    expect((await post('/api/pokemon-zone/imports').send(other)).status).toBe(201)
    const summary = (await get('/api/pokemon-zone')).body
    expect(summary.previous).toBeNull()
    expect(summary.battles.window).toBeNull()
    expect(summary.luck.since).toBeNull()
  })

  it('saves at once, newer and older mixed, leave the newest read in the settings (the lock)', async () => {
    await settingsWritten(1)
    // Newer than every import so far (the other account's, 30 minutes ago): 20, 19, … 15 minutes ago.
    const reads = Array.from({ length: 6 }, (_, i) => {
      const next = later(ago((20 - i) * 60 * 1000), {})
      first(next.mine.resourceData.packPowerChargers).value = 10 + i
      return next
    })
    // Interleaved: newest, oldest, the second newest…
    const order = [5, 0, 4, 1, 3, 2]
    const answers = await Promise.all(order.map((i) => post('/api/pokemon-zone/imports').send(reads[i])))
    for (const answer of answers) expect(answer.status).toBe(201)
    expect((await get('/api/settings')).body.hourglasses).toBe(15)
    expect((await get('/api/pokemon-zone')).body.settings.hourglasses).toBe('imported')
  })

  it('Codex on #170: two imports with the same read — the one applied is the one shown as latest', async () => {
    const read = ago(10 * 60 * 1000)
    const tied = (hourglasses: number) => {
      const next = later(read, {})
      first(next.mine.resourceData.packPowerChargers).value = hourglasses
      return next
    }
    expect((await post('/api/pokemon-zone/imports').send(tied(31))).body.applied).not.toBeNull()
    expect((await post('/api/pokemon-zone/imports').send(tied(32))).body.applied).not.toBeNull()
    expect((await get('/api/settings')).body.hourglasses).toBe(32)
    // The first one again: a duplicate saved before the second, with the same read. It is not the latest, so it does
    // not write the settings, and what Sobres has stays the latest's.
    expect((await post('/api/pokemon-zone/preview').send(tied(31))).body).toMatchObject({
      duplicate: true,
      older: true,
    })
    expect((await post('/api/pokemon-zone/imports').send(tied(31))).body).toMatchObject({
      duplicate: true,
      applied: null,
    })
    expect((await get('/api/settings')).body.hourglasses).toBe(32)
    const summary = (await get('/api/pokemon-zone')).body
    expect(summary.latest.hourglasses.pack).toBe(32)
    expect(summary.settings.hourglasses).toBe('imported')
    // The latest one again is still the latest: it writes them back (when they were changed before its read)…
    expect((await put('/api/settings/hourglasses').send({ value: 1 })).status).toBe(200)
    await settingsWritten(1)
    expect((await post('/api/pokemon-zone/imports').send(tied(32))).body).toMatchObject({
      duplicate: true,
      applied: { hourglasses: { before: 1, after: 32, kept: false } },
    })
    // …and keeps a value changed by hand after it (review of pz/import).
    expect((await put('/api/settings/hourglasses').send({ value: 2 })).status).toBe(200)
    expect((await post('/api/pokemon-zone/imports').send(tied(32))).body).toMatchObject({
      duplicate: true,
      applied: { hourglasses: { before: 2, after: 2, game: 32, kept: true } },
    })
    expect((await get('/api/settings')).body.hourglasses).toBe(2)
  })

  it('Codex on #170: the luck is computed once per import, and again when a new one comes', async () => {
    const service = test.app.get(PokemonZoneService)
    const first = await service.summary()
    const again = await service.summary()
    expect(first.luck).not.toBeNull()
    expect(again.luck).toBe(first.luck)
    const next = later(ago(5 * 60 * 1000), { b4bPacks: 1 })
    expect((await post('/api/pokemon-zone/imports').send(next)).status).toBe(201)
    const after = await service.summary()
    expect(after.luck).not.toBe(first.luck)
    expect(after.luck?.since?.packs).toBe(1)
  })

  it('Sobres de promoción carries the coupons of the latest import', async () => {
    const promo = await get('/api/promo-packs')
    expect(promo.status).toBe(200)
    expect(promo.body.coupons.syncedAt).toBeTruthy()
    expect(promo.body.coupons.items.map((item: { key: string }) => item.key).sort()).toEqual([
      'TICKET_2610000_EV_03',
      'TICKET_2610000_EV_04',
    ])
    expect(promo.body.coupons.items.find((item: { key: string }) => item.key === 'TICKET_2610000_EV_03')).toMatchObject(
      {
        eventId: 'botin-bis-promo-2026',
        nameEs: 'Evento botín bis PROMO 2026',
        count: 2,
      },
    )
  })

  it('review of pz/import: a save while a restore holds the lock is a 503, not a 500', async () => {
    const waitMs = POKEMON_ZONE_LOCK.waitMs
    POKEMON_ZONE_LOCK.waitMs = 300
    let release = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = () => {}
    const holding = new Promise<void>((resolve) => {
      held = resolve
    })
    // What a restore does: the pokemon-zone lock, held for a while.
    const restore = test.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCKS.pokemonZoneImport}::bigint)`
        held()
        await released
      },
      { timeout: 20_000 },
    )
    try {
      await holding
      const busy = await post('/api/pokemon-zone/imports').send(later(ago(60 * 1000), {}))
      expect(busy.status).toBe(503)
      expect(busy.body.error).toMatchObject({
        code: 'pokemon_zone_busy',
        message: expect.stringMatching(/restauración/),
      })
    } finally {
      release()
      await restore
      POKEMON_ZONE_LOCK.waitMs = waitMs
    }
  })

  it('review of pz/import: the first import ever, saves at once — the lock alone keeps the newest read', async () => {
    // No import and no settings rows: nothing to lock with FOR UPDATE, only the advisory lock serializes.
    await test.prisma.$executeRawUnsafe('TRUNCATE pokemon_zone_imports RESTART IDENTITY')
    await test.prisma.appSetting.deleteMany({ where: { key: { in: ['packPoints', 'hourglasses'] } } })
    const reads = Array.from({ length: 6 }, (_, i) => {
      const next = later(ago((40 - i) * 60 * 1000), {})
      first(next.mine.resourceData.packPowerChargers).value = 10 + i
      return next
    })
    const answers = await Promise.all([5, 0, 4, 1, 3, 2].map((i) => post('/api/pokemon-zone/imports').send(reads[i])))
    for (const answer of answers) expect(answer.status).toBe(201)
    expect((await get('/api/settings')).body.hourglasses).toBe(15)
    expect((await get('/api/pokemon-zone')).body.settings.hourglasses).toBe('imported')
  })
})
