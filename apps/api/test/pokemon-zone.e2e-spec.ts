import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { HAND_EDITS_KEY, POKEMON_ZONE_LOCK } from '../src/pokemon-zone/pack-settings.js'
import { PokemonZoneService } from '../src/pokemon-zone/pokemon-zone.service.js'
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
  v: number
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
/**
 * pz/luck: as the version 2 bookmarklet sends it (no ticket for a pack with a guaranteed card: none held), so the luck
 * does not hang on whether today falls in the anniversary campaign.
 */
const payload = (): Payload => ({ ...(JSON.parse(readFileSync(FIXTURE, 'utf8')) as Payload), v: 2 })
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

  /**
   * Dates the hand edits of the two settings an import writes `msAgo` (as if saved by hand then: before or after a
   * read): all of them, or only the expansions in `only` (the hourglasses' too only without `only`).
   */
  const handEditedAgo = async (msAgo: number, only?: string[]) => {
    const row = await test.prisma.appSetting.findUnique({ where: { key: HAND_EDITS_KEY } })
    const edits = row?.value as { packPoints: Record<string, string>; hourglasses: string | null } | undefined
    if (!edits) return
    const at = ago(msAgo)
    const value = {
      packPoints: Object.fromEntries(
        Object.entries(edits.packPoints).map(([key, time]) => [key, !only || only.includes(key) ? at : time]),
      ),
      hourglasses: edits.hourglasses !== null && !only ? at : edits.hourglasses,
    }
    await test.prisma.appSetting.update({ where: { key: HAND_EDITS_KEY }, data: { value } })
  }
  const settingsWritten = (hoursAgo: number) => handEditedAgo(hoursAgo * HOUR)

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
    // preview says so, with when; an expansion the save did not change is not a hand edit (Codex on #170).
    expect((await put('/api/settings/hourglasses').send({ value: 6 })).status).toBe(200)
    const points = (await get('/api/settings')).body.packPoints as Record<string, number>
    expect((await put('/api/settings/packPoints').send({ value: { ...points, A1: 100 } })).status).toBe(200)
    // When they were changed by hand is the server's: Sobres does not get it.
    expect((await get('/api/settings')).body).not.toHaveProperty(HAND_EDITS_KEY)
    const kept = (await post('/api/pokemon-zone/preview').send(first)).body
    const handEdits = (await test.prisma.appSetting.findUnique({ where: { key: HAND_EDITS_KEY } }))?.value as {
      packPoints: Record<string, string>
      hourglasses: string
    }
    // The time is the hand edit's, not the import's write (that wrote them after the edits of 50 h ago).
    expect(kept.hourglasses).toMatchObject({
      before: 6,
      after: 6,
      game: 18,
      kept: true,
      editedAt: handEdits.hourglasses,
    })
    expect(kept.packPoints.kept).toEqual([
      { expansionId: 'A1', value: 100, game: 5, editedAt: expect.any(String), nameEs: 'Genes Formidables' },
    ])
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
    // pz/luck: a span of packs only counts towards «desde la primera importación».
    expect(summary.luck.sinceFirst).toMatchObject({
      from: firstRead,
      to: new Date(secondRead).toISOString(),
      spans: 1,
      rare: { counted: 1, games: 20, unknown: 0, observed: 0, verdict: 'normal' },
    })
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
      // A save by hand of the same settings waits for the same lock (Codex on #170), and answers the same way.
      const save = await put('/api/settings/hourglasses').send({ value: 9 })
      expect(save.status).toBe(503)
      expect(save.body.error).toMatchObject({ code: 'settings_busy', message: expect.stringMatching(/restauración/) })
      const patch = await test
        .http()
        .patch('/api/settings/packPoints')
        .set('Cookie', cookie)
        .send({ changes: { A1: 1 } })
      expect(patch.status).toBe(503)
      expect(patch.body.error.code).toBe('settings_busy')
      // Other settings do not wait for it.
      expect((await put('/api/settings/packsPerDay').send({ value: 2 })).status).toBe(200)
    } finally {
      release()
      await restore
      POKEMON_ZONE_LOCK.waitMs = waitMs
    }
  })

  it('review of pz/import: the first import ever, saves at once — the lock alone keeps the newest read', async () => {
    // No import and no settings rows: nothing to lock with FOR UPDATE, only the advisory lock serializes.
    await test.prisma.$executeRawUnsafe('TRUNCATE pokemon_zone_imports RESTART IDENTITY')
    await test.prisma.appSetting.deleteMany({ where: { key: { in: ['packPoints', 'hourglasses', HAND_EDITS_KEY] } } })
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

  it('Codex on #170: each expansion is kept by the time of its own hand edit, not by the latest save of any', async () => {
    const reading = (syncedAt: string, points: Record<string, number>) => {
      const next = later(syncedAt, {})
      for (const item of next.mine.resourceData.packCeilPoints as { key: string; value: unknown }[])
        if (Object.hasOwn(points, item.key)) item.value = points[item.key]
      return next
    }
    const points = async () => (await get('/api/settings')).body.packPoints as Record<string, number>
    // An import sets A1 and A2 to 100 (a read 30 minutes ago, the newest so far).
    expect(
      (await post('/api/pokemon-zone/imports').send(reading(ago(30 * 60 * 1000), { A1: 100, A2: 100 }))).status,
    ).toBe(201)
    expect(await points()).toMatchObject({ A1: 100, A2: 100 })
    // A1 changed by hand to 200, 20 minutes ago ("yesterday")… (each request is built after the one before ends:
    // supertest closes the server it opened when its request ends.)
    const imported = await points()
    expect((await put('/api/settings/packPoints').send({ value: { ...imported, A1: 200 } })).status).toBe(200)
    await handEditedAgo(20 * 60 * 1000, ['A1'])
    // …the game read 10 minutes ago ("today at 06:00") says A1 = 250…
    const today = reading(ago(10 * 60 * 1000), { A1: 250, A2: 100 })
    // …and only A2 changed by hand now ("at 09:00").
    const edited = await points()
    expect((await put('/api/settings/packPoints').send({ value: { ...edited, A2: 150 } })).status).toBe(200)

    const preview = (await post('/api/pokemon-zone/preview').send(today)).body
    expect(preview.packPoints.changes).toEqual([
      { expansionId: 'A1', before: 200, after: 250, nameEs: 'Genes Formidables' },
    ])
    // The time shown is A2's own hand edit (review of #170: never an import's write, nor another expansion's save).
    const edits = (await test.prisma.appSetting.findUnique({ where: { key: HAND_EDITS_KEY } }))?.value as {
      packPoints: Record<string, string>
    }
    expect(Date.parse(edits.packPoints.A1 ?? '')).toBeLessThan(Date.parse(today.stats.syncedAt))
    expect(preview.packPoints.kept).toEqual([
      { expansionId: 'A2', value: 150, game: 100, editedAt: edits.packPoints.A2, nameEs: expect.any(String) },
    ])
    const saved = await post('/api/pokemon-zone/imports').send(today)
    expect(saved.status).toBe(201)
    expect(saved.body.applied).toMatchObject({ packPoints: 1, packPointsKept: 1 })
    // The game's A1 is newer than its hand edit; A2's hand edit is newer than the read.
    expect(await points()).toMatchObject({ A1: 250, A2: 150 })
  })

  it('review of #170: a stale screen saves its one row, never the import’s expansions with what it still shows', async () => {
    const reading = (syncedAt: string, points: Record<string, number>) => {
      const next = later(syncedAt, {})
      for (const item of next.mine.resourceData.packCeilPoints as { key: string; value: unknown }[])
        if (Object.hasOwn(points, item.key)) item.value = points[item.key]
      return next
    }
    const points = async () => (await get('/api/settings')).body.packPoints as Record<string, number>
    const edits = async () =>
      ((await test.prisma.appSetting.findUnique({ where: { key: HAND_EDITS_KEY } }))?.value ?? {}) as {
        packPoints: Record<string, string>
      }
    // A tab on the PC shows the points as they are now (A1 250, A2 150 from the test before; A3 70 and B1 10)…
    const onThePc = await points()
    expect(onThePc).toMatchObject({ A1: 250, A2: 150, A3: 70, B1: 10 })
    const editsBefore = await edits()
    // …then an import from the phone lands: the game read 5 minutes ago has A1 300 and A3 80.
    const fromThePhone = await post('/api/pokemon-zone/imports').send(
      reading(ago(5 * 60 * 1000), { A1: 300, A2: 150, A3: 80 }),
    )
    expect(fromThePhone.status).toBe(201)
    // The PC tab, not refreshed, changes B1 only: it sends that row, and the server merges it.
    const saved = await test
      .http()
      .patch('/api/settings/packPoints')
      .set('Cookie', cookie)
      .send({ changes: { B1: 12 } })
    expect(saved.status).toBe(200)
    expect(saved.body.value).toMatchObject({ A1: 300, A2: 150, A3: 80, B1: 12 })
    expect(await points()).toMatchObject({ A1: 300, A2: 150, A3: 80, B1: 12 })
    // Only B1 is a hand edit now; A1 keeps its old time and A3 has none.
    const editsAfter = await edits()
    expect(editsAfter.packPoints.A1).toBe(editsBefore.packPoints.A1)
    expect(editsAfter.packPoints).not.toHaveProperty('A3')
    expect(Date.parse(editsAfter.packPoints.B1 ?? '')).toBeGreaterThan(Date.parse(fromThePhone.body.import.syncedAt))
    // So the next read of the game updates A1 and A3, and keeps only B1, the row really changed by hand.
    const next = reading(ago(2 * 60 * 1000), { A1: 320, A2: 150, A3: 90 })
    const preview = (await post('/api/pokemon-zone/preview').send(next)).body
    expect(preview.packPoints.changes).toEqual([
      { expansionId: 'A1', before: 300, after: 320, nameEs: 'Genes Formidables' },
      { expansionId: 'A3', before: 80, after: 90, nameEs: expect.any(String) },
    ])
    expect(preview.packPoints.kept).toEqual([
      { expansionId: 'B1', value: 12, game: 10, editedAt: editsAfter.packPoints.B1, nameEs: expect.any(String) },
    ])
    // 0 removes an expansion; what is not an expansion's points is refused whole, and nothing is written.
    const remove = await test
      .http()
      .patch('/api/settings/packPoints')
      .set('Cookie', cookie)
      .send({ changes: { B1: 0 } })
    expect(remove.body.value).not.toHaveProperty('B1')
    for (const body of [
      { changes: {} },
      { changes: { A1: -1 } },
      { changes: { A1: 1.5 } },
      { changes: { A1: 1_000_001 } },
      { changes: { 'A 1': 1 } },
      // Review of #171: an id as the import takes it, a capital first.
      { changes: { constructor: 1 } },
      { changes: { a1: 1 } },
      { changes: { '1A': 1 } },
      { value: { A1: 1 } },
    ]) {
      const refused = await test.http().patch('/api/settings/packPoints').set('Cookie', cookie).send(body)
      expect(refused.status, JSON.stringify(body)).toBe(400)
    }
    const proto = await test
      .http()
      .patch('/api/settings/packPoints')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/json')
      .send('{"changes":{"__proto__":1}}')
    expect(proto.status).toBe(400)
    expect(await points()).toMatchObject({ A1: 300, A2: 150, A3: 80 })
    expect(await points()).not.toHaveProperty('B1')
    // Without the session, nothing.
    expect(
      (
        await test
          .http()
          .patch('/api/settings/packPoints')
          .send({ changes: { A1: 1 } })
      ).status,
    ).toBe(401)
  })
})
