import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { type Clock, type FetchLike, LimitlessClient, LimitlessTransport } from '../src/tournaments/limitless.client.js'
import { TournamentDataVersion } from '../src/tournaments/tournament-settings.js'
import { TournamentSyncService } from '../src/tournaments/tournament-sync.service.js'
import { TournamentsService } from '../src/tournaments/tournaments.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * docs/PLAN.md §7 Fase 5 (M5) against a fake Limitless that serves the responses saved on 6/10/2026
 * (docs/fase0/limitless/): the 400 most recent tournaments, PMPT #45 (393 players) and a NOEX tournament (79), with
 * their pairings (saved on 8/10/2026, Fase 9).
 * The other tournaments answer «no decklists», so they are excluded after their details.
 */
const LIMITLESS = join(REPO_ROOT, 'docs/fase0/limitless')
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')
const BIG = '6a95b87b629039f77d8a6954'
const NOEX = '6a9ebbfcab080c8c957fcc9a'
const SYNC_NOW = new Date('2026-10-07T00:00:00Z')

const read = (file: string): unknown => JSON.parse(readFileSync(join(LIMITLESS, file), 'utf8'))
const tournaments = [...(read('t1.json') as { id: string }[]), ...(read('t2.json') as { id: string }[])]

type Structured = Record<string, unknown>

interface Rate {
  value: number
  games: number
  sampleKind?: string
  samples: number
  orientative: boolean
  ci95: [number, number]
}
interface RecordRow {
  lists: number
  record: { wins: number; losses: number; ties: number }
  rate: Rate | null
}

describe('tournaments (e2e)', () => {
  let test: TestApp
  let cookie: string
  const paths: string[] = []
  let maxInWindow = 0
  let throttled = false

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
    const decks = drafts.map((d) => ({
      name: d.title,
      energies: d.draft.energies.length > 0 ? d.draft.energies : ['psychic'],
      cards: d.draft.cards,
    }))
    expect((await post('/api/decks/import/commit').send({ decks })).status).toBe(201)

    // Fake Limitless: instant sleeps on a fake clock; one 429 on the second page of the listing.
    let now = Date.parse('2026-10-07T00:00:00Z')
    const clock: Clock = {
      now: () => now,
      sleep: async (ms) => {
        now += ms
      },
    }
    const limitless = test.app.get(LimitlessClient)
    const fake: FetchLike = async (url) => {
      const path = url.replace(test.env.limitlessBaseUrl, '')
      paths.push(path)
      maxInWindow = Math.max(maxInWindow, limitless.callsInWindow())
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
        status,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        json: async () => body,
      })
      const listing = /^\/tournaments\?game=POCKET&limit=(\d+)&page=(\d+)$/.exec(path)
      if (listing) {
        const [limit, page] = [Number(listing[1]), Number(listing[2])]
        if (page === 2 && !throttled) {
          throttled = true
          return json(429, { message: 'Too Many Requests' }, { 'retry-after': '75' })
        }
        return json(200, tournaments.slice((page - 1) * limit, page * limit))
      }
      const detail = /^\/tournaments\/([0-9a-f]+)\/(details|standings|pairings)$/.exec(path)
      if (detail) {
        const [, id, what] = detail
        if (what === 'details') {
          if (id === BIG) return json(200, read('big_details.json'))
          if (id === NOEX) return json(200, { id, decklists: true, isOnline: true, phases: [] })
          return json(200, { id, decklists: false })
        }
        if (what === 'pairings') {
          if (id === BIG) return json(200, read('big_pairings.json'))
          if (id === NOEX) return json(200, read('noex_pairings.json'))
          return json(404, { message: 'not found' })
        }
        if (id === BIG) return json(200, read('big_standings.json'))
        if (id === NOEX) return json(200, read('noex_standings.json'))
        return json(404, { message: 'not found' })
      }
      return json(404, { message: 'unknown path' })
    }
    const transport = test.app.get(LimitlessTransport)
    transport.fetch = fake
    transport.clock = clock
    await test.app.get(TournamentSyncService).run({ now: SYNC_NOW })
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  function get(path: string) {
    return test.http().get(path).set('Cookie', cookie)
  }
  function post(path: string) {
    return test.http().post(path).set('Cookie', cookie)
  }
  function put(path: string) {
    return test.http().put(path).set('Cookie', cookie)
  }
  function patch(path: string) {
    return test.http().patch(path).set('Cookie', cookie)
  }

  it('sync: lists 60 days, downloads what counts, survives a 429 and never passes 40 calls per 5 minutes', async () => {
    expect(throttled).toBe(true)
    expect(maxInWindow).toBeLessThanOrEqual(40)
    expect(paths.filter((path) => path.includes('&page=2'))).toHaveLength(2)
    // Acceptance: era B4a (from 27/8), ≥ 12 players, CUSTOM out, cut at 6/10 → 154 tournaments, 12.616 players.
    const b4a = await test.prisma.tournament.aggregate({
      where: {
        format: 'STANDARD',
        players: { gte: 12 },
        date: { gte: new Date('2026-08-27T00:00:00Z'), lt: new Date('2026-10-07T00:00:00Z') },
      },
      _count: { _all: true },
      _sum: { players: true },
    })
    expect(b4a._count._all).toBe(154)
    expect(b4a._sum.players).toBe(12_616)
    expect(await test.prisma.tournament.count({ where: { status: 'complete' } })).toBe(2)
    expect(await test.prisma.tournament.count({ where: { excludedReason: 'custom_format' } })).toBeGreaterThan(90)
    expect(await test.prisma.tournament.count({ where: { excludedReason: 'no_decklists' } })).toBeGreaterThan(100)
    // A small tournament is not downloaded at all.
    const small = await test.prisma.tournament.findFirst({ where: { players: { lt: 12 }, format: 'STANDARD' } })
    expect(small?.status).toBe('listed')
    const run = await test.prisma.limitlessSyncRun.findFirstOrThrow({ orderBy: { id: 'desc' } })
    expect(run).toMatchObject({ kind: 'backfill', status: 'done' })
    expect(run.calls).toBe(paths.length)

    // An incremental run reads one page (everything known and older than two days) and downloads nothing new.
    // Fase 38 (R-008): the cached datasets expire once per run that saved something, not after every tournament.
    const version = test.app.get(TournamentDataVersion)
    const expiredBefore = version.current()
    expect(expiredBefore).toBe(1)
    const before = paths.length
    await test.app.get(TournamentSyncService).run({ now: SYNC_NOW })
    expect(paths.slice(before)).toEqual(['/tournaments?game=POCKET&limit=100&page=1'])
    expect(version.current()).toBe(expiredBefore)
    const status = (await get('/api/tournaments/status')).body
    expect(status).toMatchObject({
      currentEra: { code: 'B4a', from: '2026-08-27', to: null },
      minPlayers: 12,
      sync: { enabled: false, running: false, lastRun: { kind: 'incremental', status: 'done' } },
    })
    expect(status.sync.counts.complete).toBe(2)
    // H-006: the last era-opening release (the Deluxe B4b does not open one).
    expect(status.newEra).toMatchObject({ lastRelease: 'B4a' })
  })

  it('archetypes of the era: n, interval, «orientativo» and the era mean (48,0 % for PMPT #45, not 50 %)', async () => {
    const response = await get('/api/tournaments/archetypes')
    expect(response.status).toBe(200)
    const { scope, rows } = response.body as {
      scope: Structured & { mean: RecordRow }
      rows: (RecordRow & Structured)[]
    }
    expect(scope).toMatchObject({ era: { code: 'B4a' }, format: 'STANDARD', tournaments: 1, lists: 393, games: 2190 })
    expect(scope.mean.record).toEqual({ wins: 1051, losses: 1119, ties: 20 })
    expect(scope.mean.rate?.value).toBeCloseTo((1051 / 2190) * 100, 9)
    expect(String(scope.attribution)).toContain('Limitless')
    expect(rows).toHaveLength(128)
    for (const row of rows) expect(row.rate?.orientative).toBe(row.lists < 30)
    expect(rows.reduce((sum, row) => sum + row.lists, 0)).toBe(393)

    const noex = (await get('/api/tournaments/archetypes?format=NOEX')).body as {
      scope: { mean: RecordRow; lists: number }
    }
    expect(noex.scope.lists).toBe(79)
    expect(noex.scope.mean.record).toEqual({ wins: 190, losses: 204, ties: 40 })
    expect((await get('/api/tournaments/archetypes?era=Z9')).status).toBe(404)
    expect((await get('/api/tournaments/archetypes?format=CUSTOM')).status).toBe(400)
    expect((await test.http().get('/api/tournaments/archetypes')).status).toBe(401)
  })

  it('exact lists by name (275) and by functional card, and the detail of one list', async () => {
    const byName = (await get('/api/tournaments/lists?kind=name&limit=5')).body as { total: number; rows: Structured[] }
    expect(byName.total).toBe(275)
    const byGroup = (await get('/api/tournaments/lists?limit=3')).body as {
      total: number
      rows: (RecordRow & { key: string; cards: { count: number; nameEs: string }[] })[]
    }
    expect(byGroup.total).toBeGreaterThanOrEqual(275)
    const top = byGroup.rows[0]
    expect(top?.cards.reduce((sum, card) => sum + card.count, 0)).toBe(20)
    const detail = (await get(`/api/tournaments/lists/${top?.key}`)).body as {
      list: RecordRow & { missing: unknown[] }
      text: string
      entries: unknown[]
    }
    expect(detail.entries).toHaveLength(top?.lists ?? 0)
    expect(detail.text).toMatch(/\r\n\r\nEnergy: /)
    expect(Array.isArray(detail.list.missing)).toBe(true)
    expect((await get('/api/tournaments/lists/zzz')).status).toBe(400)
    expect((await get('/api/tournaments/lists/0123456789abcd')).status).toBe(404)
  })

  it('an archetype with and without a card: two rows that add up to the archetype', async () => {
    const [top] = (await get('/api/tournaments/archetypes')).body.rows as { archetype: { id: string }; lists: number }[]
    const detail = (await get(`/api/tournaments/archetypes/${top?.archetype.id}`)).body as {
      cards: { groupId: string; lists: number }[]
      lists: unknown[]
    }
    const split = detail.cards.find((card) => card.lists > 0 && card.lists < (top?.lists ?? 0))
    expect(split).toBeDefined()
    const both = (await get(`/api/tournaments/archetypes/${top?.archetype.id}?card=${split?.groupId}`)).body as {
      withWithout: { with: RecordRow; without: RecordRow }
    }
    expect(both.withWithout.with.lists).toBe(split?.lists)
    expect(both.withWithout.with.lists + both.withWithout.without.lists).toBe(top?.lists)
  })

  it('Fase 44: núcleo, techs with the difference and its interval, and conversion to the top 8', async () => {
    const [top] = (await get('/api/tournaments/archetypes')).body.rows as { archetype: { id: string }; lists: number }[]
    const bootstrap = vi.spyOn(test.app.get(TournamentsService), 'bootstrapCards')
    const response = await get(`/api/tournaments/archetypes/${top?.archetype.id}/cards`)
    expect(response.status).toBe(200)
    const cards = response.body as {
      lists: number
      incomplete: number
      coreSlots: number
      freeSlots: number
      core: { share: number }[]
      techs: {
        share: number
        with: RecordRow
        without: RecordRow
        difference: { ci95: number[]; text: string } | null
      }[]
      conversion: { lists: number; topLists: number; excluded: { lists: number }; text: string } | null
    }
    // Lists with a card the catalog does not map are left out of the card tables.
    expect(cards.lists + cards.incomplete).toBe(top?.lists)
    expect(cards.coreSlots + cards.freeSlots).toBeCloseTo(20)
    for (const core of cards.core) expect(core.share).toBeGreaterThanOrEqual(90)
    for (const tech of cards.techs) expect(tech.with.lists + tech.without.lists).toBe(cards.lists)
    const compared = cards.techs.find((tech) => tech.difference)
    expect(compared?.difference?.text).toMatch(/puntos \(IC\u00a0/)
    // Every list counts toward the top 8 or is left out with its tournament (published too little).
    expect((cards.conversion?.lists ?? 0) + (cards.conversion?.excluded.lists ?? 0)).toBe(top?.lists)
    expect(cards.conversion?.text).toMatch(/llegaron al top 8/)
    // Cached per dataset: the same answer again, without running the bootstrap a second time.
    expect((await get(`/api/tournaments/archetypes/${top?.archetype.id}/cards`)).body).toEqual(cards)
    expect(bootstrap).toHaveBeenCalledTimes(1)
    bootstrap.mockRestore()
    expect((await get('/api/tournaments/archetypes/no-such-archetype/cards')).status).toBe(404)
  })

  it('what I can build today and which card unlocks the most lists', async () => {
    const buildable = (await get('/api/tournaments/buildable')).body as {
      buildable: { missing: unknown[] }[]
      near: { missingCopies: number }[]
    }
    expect(buildable.buildable.length).toBeGreaterThan(0)
    expect(buildable.buildable.every((row) => row.missing.length === 0)).toBe(true)
    expect(buildable.near.every((row) => row.missingCopies >= 1 && row.missingCopies <= 2)).toBe(true)
    const unlock = (await get('/api/tournaments/unlock')).body as {
      cards: { lists: number; nameEs: string; copies: number; unlocked: { missing: { groupId: string }[] }[] }[]
    }
    expect(unlock.cards.length).toBeGreaterThan(0)
    for (let i = 1; i < unlock.cards.length; i++) {
      expect(unlock.cards[i - 1]?.lists).toBeGreaterThanOrEqual(unlock.cards[i]?.lists ?? 0)
    }
    expect(unlock.cards[0]?.nameEs.length).toBeGreaterThan(0)
  })

  it('the era table is the owner’s: moving B4a’s release moves PMPT #45 to the B4 era', async () => {
    const sets = (await get('/api/tournaments/sets')).body.items as {
      code: string
      releaseDate: string
      opensEra: boolean
    }[]
    expect(sets.find((set) => set.code === 'B4b')).toMatchObject({ releaseDate: '2026-09-30', opensEra: false })
    const moved = await put('/api/tournaments/sets/B4a').send({
      nameEn: "Team Rocket's Ambition",
      releaseDate: '2026-09-06',
      opensEra: true,
    })
    expect(moved.status).toBe(200)
    expect((await get('/api/tournaments/archetypes?era=B4')).body.scope.lists).toBe(393)
    expect((await get('/api/tournaments/archetypes?era=B4a')).body.scope.lists).toBe(0)
    await put('/api/tournaments/sets/B4a').send({
      nameEn: "Team Rocket's Ambition",
      releaseDate: '2026-08-27',
      opensEra: true,
    })
    expect((await get('/api/tournaments/archetypes')).body.scope.lists).toBe(393)
    expect(
      (await put('/api/tournaments/sets/B4a').send({ nameEn: 'x', releaseDate: '27/8', opensEra: true })).status,
    ).toBe(400)
  })

  it('a set loaded ahead of its release (C1 on 22/10) is in the table but not yet an era', async () => {
    const ahead = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    expect(
      (await put('/api/tournaments/sets/Z9').send({ nameEn: 'Ahead', releaseDate: ahead, opensEra: true })).status,
    ).toBe(200)
    try {
      const sets = (await get('/api/tournaments/sets')).body.items as { code: string }[]
      expect(sets.map((set) => set.code)).toContain('Z9')
      const status = (await get('/api/tournaments/status')).body as {
        currentEra: { code: string; to: string | null }
        eras: { code: string }[]
        newEra: { lastRelease: string }
      }
      expect(status.eras.map((era) => era.code)).not.toContain('Z9')
      expect(status.eras[0]?.code).toBe('B4a')
      // B4a now ends when Z9 comes out and is still the era of today; the warning does not ask for a set already loaded.
      expect(status.currentEra).toMatchObject({ code: 'B4a', to: ahead })
      expect(status.newEra).toMatchObject({ lastRelease: 'B4a', likely: false })
      expect((await get('/api/tournaments/archetypes')).body.scope.lists).toBe(393)
    } finally {
      await test.prisma.setRelease.delete({ where: { code: 'Z9' } })
      test.app.get(TournamentDataVersion).bump()
    }
  })

  it('archetype merges: the owner folds one Limitless archetype into another', async () => {
    const rows = (await get('/api/tournaments/archetypes')).body.rows as { archetype: { id: string }; lists: number }[]
    const [first, second] = rows
    const merged = await put(`/api/tournaments/archetypes/${second?.archetype.id}/alias`).send({
      canonicalId: first?.archetype.id,
    })
    expect(merged.status).toBe(200)
    const after = (await get('/api/tournaments/archetypes')).body.rows as { archetype: { id: string }; lists: number }[]
    expect(after).toHaveLength(127)
    expect(after[0]?.lists).toBe((first?.lists ?? 0) + (second?.lists ?? 0))
    expect((await get(`/api/tournaments/archetypes/${first?.archetype.id}`)).body.merged).toEqual([
      second?.archetype.id,
    ])
    await put(`/api/tournaments/archetypes/${second?.archetype.id}/alias`).send({ canonicalId: null })
    expect((await get('/api/tournaments/archetypes')).body.rows).toHaveLength(128)
  })

  it('matches: opponents from the tournament archetypes, and the «torneo» column of a deck', async () => {
    const suggestions = (await get('/api/matches/suggestions')).body as {
      tournamentArchetypes: { name: string; lists: number }[]
    }
    expect(suggestions.tournamentArchetypes.length).toBeGreaterThan(0)
    expect(suggestions.tournamentArchetypes.every((item) => item.lists >= 5)).toBe(true)

    const decks = (await get('/api/decks')).body.items as { id: string; name: string }[]
    const blaziken = decks.find((deck) => deck.name === 'Mega-Blaziken ex')
    const comparison = (await get(`/api/decks/${blaziken?.id}/comparison`)).body as {
      columns: { source: string; available: boolean; note: string; rows?: { label: string; rate: Rate | null }[] }[]
    }
    const tournament = comparison.columns.find((column) => column.source === 'tournament')
    expect(tournament?.available).toBe(true)
    expect(tournament?.note).toContain('Limitless')
    const archetypeRow = tournament?.rows?.find((row) => row.label.startsWith('Arquetipo'))
    expect(archetypeRow?.label).toMatch(/Blaziken/i)
    expect(comparison.columns.map((column) => column.source)).toEqual(['matches', 'tournament', 'simulation'])

    // The owner pins another archetype for the deck: the column says so.
    const [top] = (await get('/api/tournaments/archetypes')).body.rows as { archetype: { id: string; name: string } }[]
    expect((await patch(`/api/decks/${blaziken?.id}`).send({ tournamentArchetypeId: top?.archetype.id })).status).toBe(
      200,
    )
    const pinned = (await get(`/api/decks/${blaziken?.id}/comparison`)).body.columns[1] as {
      rows: { label: string; note?: string }[]
    }
    expect(pinned.rows.find((row) => row.label.startsWith('Arquetipo'))?.note).toContain('elegido')
    expect((await patch(`/api/decks/${blaziken?.id}`).send({ tournamentArchetypeId: null })).status).toBe(200)
  })

  it('matchups (Fase 9): the rounds of PMPT #45 under each player’s archetype, per archetype and per deck', async () => {
    expect(paths.filter((path) => path.endsWith('/pairings')).sort()).toEqual(
      [`/tournaments/${BIG}/pairings`, `/tournaments/${NOEX}/pairings`].sort(),
    )
    expect(await test.prisma.tournamentPairing.count({ where: { tournamentId: BIG } })).toBe(1143)
    expect((await get('/api/tournaments/status')).body.sync.pairings).toEqual({ fetched: 2, missing: 0 })

    interface Cell {
      a: string
      b: string
      record: { wins: number; losses: number; ties: number }
      rate: Rate | null
    }
    const matrix = (await get('/api/tournaments/matchups?top=6')).body as {
      coverage: { tournaments: number; tournamentsWithPairings: number; matches: number; skipped: Structured }
      archetypes: { archetype: { id: string; name: string }; share: number; expected: { value: number } | null }[]
      cells: Cell[]
      attribution: string
    }
    expect(matrix.coverage).toMatchObject({
      tournaments: 1,
      tournamentsWithPairings: 1,
      skipped: { byes: 96, doubleLosses: 41 },
    })
    expect(matrix.archetypes).toHaveLength(6)
    expect(matrix.cells.length).toBeGreaterThan(10)
    for (const cell of matrix.cells) {
      const back = matrix.cells.find((other) => other.a === cell.b && other.b === cell.a)
      expect(back?.record).toEqual({ wins: cell.record.losses, losses: cell.record.wins, ties: cell.record.ties })
      expect(cell.rate?.sampleKind).toBe('matches')
    }
    expect(matrix.attribution).toContain('Limitless')
    expect((await get('/api/tournaments/matchups?top=1')).status).toBe(400)
    const top = matrix.archetypes[0] as { archetype: { id: string; name: string } }
    const detail = (await get(`/api/tournaments/archetypes/${top.archetype.id}`)).body.matchups as {
      rows: { rival: { id: string }; share: number; rate: Rate | null }[]
      expected: { value: number; coverage: number } | null
      tournamentsWithPairings: number
    }
    expect(detail.rows.length).toBeGreaterThan(5)
    expect(detail.tournamentsWithPairings).toBe(1)
    expect(detail.expected?.value).toBeGreaterThan(20)
    expect(detail.expected?.value).toBeLessThan(80)

    // The deck sheet: Mega-Blaziken ex against each rival, own matches next to the tournament matchup.
    const decks = (await get('/api/decks')).body.items as { id: string; name: string }[]
    const blaziken = decks.find((deck) => deck.name === 'Mega-Blaziken ex')
    const won = await post('/api/matches').send({ deckId: blaziken?.id, result: 'win', opponent: top.archetype.name })
    const lost = await post('/api/matches').send({
      deckId: blaziken?.id,
      result: 'loss',
      opponent: 'Un rival inventado',
    })
    const sheet = (await get(`/api/decks/${blaziken?.id}/matchups`)).body as {
      archetype: { name: string; source: string } | null
      rows: {
        rival: { id: string | null; name: string }
        share: number | null
        mine: { record: Structured } | null
        tournament: { rate: Rate | null } | null
      }[]
      expected: { value: number } | null
    }
    expect(sheet.archetype?.name).toMatch(/Blaziken/i)
    expect(sheet.archetype?.source).toBe('guessed')
    const row = sheet.rows.find((item) => item.rival.id === top.archetype.id)
    expect(row?.mine?.record).toEqual({ wins: 1, losses: 0, ties: 0 })
    expect(sheet.rows.filter((item) => item.share !== null).length).toBeGreaterThanOrEqual(10)
    expect(sheet.rows.some((item) => item.tournament?.rate)).toBe(true)
    expect(sheet.rows.find((item) => item.rival.id === null)).toMatchObject({
      rival: { name: 'Un rival inventado' },
      share: null,
      tournament: null,
      mine: { record: { wins: 0, losses: 1, ties: 0 } },
    })
    for (const created of [won, lost]) {
      expect((await test.http().delete(`/api/matches/${created.body.id}`).set('Cookie', cookie)).status).toBe(204)
    }
  })

  it('Fase 40 (H-006): a set the era table lacks comes as a proposed row; one tap adds it', async () => {
    const release = await test.prisma.setRelease.findUniqueOrThrow({ where: { code: 'B4a' } })
    await test.prisma.setRelease.delete({ where: { code: 'B4a' } })
    test.app.get(TournamentDataVersion).bump()
    try {
      const proposals = (await get('/api/tournaments/sets/proposals')).body.items as {
        code: string
        releaseDate: string
        opensEra: boolean
        tournaments: number
        inCatalog: boolean
        nameEn: string
      }[]
      expect(proposals).toEqual([
        expect.objectContaining({
          code: 'B4a',
          releaseDate: '2026-09-05',
          opensEra: true,
          tournaments: 1,
          inCatalog: true,
          nameEn: "Team Rocket's Ambition",
        }),
      ])
      const saved = await put('/api/tournaments/sets/B4a').send({
        nameEn: proposals[0]?.nameEn,
        releaseDate: release.releaseDate.toISOString().slice(0, 10),
        opensEra: true,
      })
      expect(saved.status).toBe(200)
      expect((await get('/api/tournaments/sets/proposals')).body.items).toEqual([])
    } finally {
      await test.prisma.setRelease.upsert({ where: { code: 'B4a' }, create: release, update: release })
      test.app.get(TournamentDataVersion).bump()
    }
  })

  it('Fase 38 (R-008): one dataset build at a time; a failed build does not block the next; old versions leave memory', async () => {
    const service = test.app.get(TournamentsService)
    const internals = service as unknown as {
      scope(query: object): Promise<unknown>
      dataset(scope: unknown): Promise<unknown>
      buildDataset(scope: unknown, key: string): Promise<unknown>
      cache: { key: string }[]
    }
    const original = internals.buildDataset.bind(service)
    let builds = 0
    let failNext = false
    internals.buildDataset = async (scope, key) => {
      builds += 1
      if (failNext) {
        failNext = false
        throw new Error('boom')
      }
      return original(scope, key)
    }
    const version = test.app.get(TournamentDataVersion)
    try {
      const scope = await internals.scope({})
      version.bump()
      const [a, b] = await Promise.all([internals.dataset(scope), internals.dataset(scope)])
      expect(builds).toBe(1)
      expect(a).toBe(b)
      // The previous version's datasets are gone from memory.
      expect(internals.cache.every((entry) => entry.key.endsWith(`|${version.current()}`))).toBe(true)

      version.bump()
      failNext = true
      const [failed, next] = await Promise.allSettled([internals.dataset(scope), internals.dataset(scope)])
      expect(failed.status).toBe('rejected')
      // The second request shared the failed build; a new one builds again.
      expect(next.status).toBe('rejected')
      const again = await internals.dataset(scope)
      expect(again).toBeTruthy()
      expect(builds).toBe(3)
    } finally {
      internals.buildDataset = original
    }
  })

  it('¿mala racha? (Fase 13): eight losses in a row against the most played archetype are rare', async () => {
    const decks = (await get('/api/decks')).body.items as { id: string; name: string }[]
    const blaziken = decks.find((deck) => deck.name === 'Mega-Blaziken ex')
    const [top] = (await get('/api/tournaments/archetypes')).body.rows as { archetype: { name: string } }[]
    const ids: string[] = []
    for (let i = 0; i < 8; i++) {
      const logged = await post('/api/matches').send({
        deckId: blaziken?.id,
        result: 'loss',
        opponent: top?.archetype.name,
      })
      ids.push(logged.body.id)
    }
    const luck = (
      await get(`/api/matches/luck?deckId=${blaziken?.id}&opponent=${encodeURIComponent(top?.archetype.name ?? '')}`)
    ).body as {
      record: { wins: number; losses: number }
      expected: {
        kind: string
        value: number
        label: string
        perGame: { wins: number; losses: number } | null
        era: string | null
        from: string | null
      } | null
      check: { verdict: string; lowerTail: number; games: number } | null
      streak: { losses: number; somewhere: number } | null
      text: string
    }
    expect(luck.record).toMatchObject({ wins: 0, losses: 8 })
    expect(luck.expected?.label).toMatch(/Blaziken/i)
    expect(luck.check?.verdict).toBe('unlucky')
    expect(luck.check?.lowerTail).toBeLessThan(0.025)
    // H-009: per game (the PMPT phases are BO3), with the tournament record behind it, in the same era.
    expect(luck.expected?.label).toMatch(/por partida/)
    expect(luck.expected?.perGame?.wins).toBeGreaterThan(0)
    expect(luck.expected?.era).toBeTruthy()
    expect(luck.expected?.from).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(luck.text).toContain(`en la era ${luck.expected?.era}`)
    expect(luck.streak?.losses).toBe(8)
    expect(luck.text).toContain('Es raro')
    expect(luck.text).toContain('8 derrotas seguidas')
    // Overall with the deck: the same eight games here.
    const overall = (await get(`/api/matches/luck?deckId=${blaziken?.id}`)).body as {
      opponent: string | null
      expected: { kind: string }
    }
    expect(overall.opponent).toBeNull()
    expect(overall.expected.kind).toBe('archetype')
    // The deck sheet marks the row.
    const sheet = (await get(`/api/decks/${blaziken?.id}/matchups`)).body as {
      rows: { rival: { name: string }; luck: string | null }[]
    }
    const row = sheet.rows.find((item) => item.rival.name === top?.archetype.name)
    expect(['unlucky', null]).toContain(row?.luck)
    for (const id of ids)
      expect((await test.http().delete(`/api/matches/${id}`).set('Cookie', cookie)).status).toBe(204)
    expect((await get('/api/matches/luck?deckId=99999')).status).toBe(404)
  })

  it('¿qué mazo llevo hoy? (Fase 15): built decks with three separate numbers, sorted by tournament', async () => {
    const decks = (await get('/api/decks')).body.items as { id: string; name: string }[]
    const blaziken = decks.find((deck) => deck.name === 'Mega-Blaziken ex')
    const hoopa = decks.find((deck) => deck.name.startsWith('Hoopa ex'))
    for (const deck of [blaziken, hoopa]) {
      expect((await patch(`/api/decks/${deck?.id}`).send({ builtInGame: true })).status).toBe(200)
    }
    const today = (await get('/api/decks-today')).body as {
      sort: string
      meta: { era: string; kind: string; lists: number }
      items: {
        deck: { id: string }
        archetype: { name: string } | null
        tournament: { value: number } | null
        lab: unknown
        mine: unknown
      }[]
      note: string
    }
    expect(today.sort).toBe('tournament')
    expect(today.meta).toMatchObject({ era: 'B4a', kind: 'recent', lists: 393 })
    expect(today.items.map((item) => item.deck.id).sort()).toEqual([blaziken?.id, hoopa?.id].sort())
    const row = today.items.find((item) => item.deck.id === blaziken?.id)
    expect(row?.archetype?.name).toMatch(/Blaziken/i)
    expect(row?.tournament?.value).toBeGreaterThan(20)
    expect(row?.lab).toBeNull()
    const values = today.items.map((item) => item.tournament?.value ?? -1)
    expect(values[0]).toBeGreaterThanOrEqual(values[1] ?? -1)
    expect(today.note).toContain('No se combinan')
    expect((await get('/api/decks-today?sort=matches')).body.sort).toBe('matches')
    expect((await get('/api/decks-today?sort=nope')).status).toBe(400)
    for (const deck of [blaziken, hoopa]) await patch(`/api/decks/${deck?.id}`).send({ builtInGame: false })
  })

  it('mi meta (Fase 44): my rivals as tournament archetypes, as weights for today and for the deck sheet', async () => {
    const decks = (await get('/api/decks')).body.items as { id: string; name: string }[]
    const blaziken = decks.find((deck) => deck.name === 'Mega-Blaziken ex')
    const rows = (await get('/api/tournaments/archetypes')).body.rows as { archetype: { id: string; name: string } }[]
    const [first, second] = rows
    const ids: string[] = []
    const log = async (opponent: string, times: number, extra: { mode?: string; playedAt?: string } = {}) => {
      for (let i = 0; i < times; i++) {
        const created = await post('/api/matches').send({
          deckId: blaziken?.id,
          result: 'win',
          opponent,
          mode: 'competitive',
          ...extra,
        })
        expect(created.status).toBe(201)
        ids.push(created.body.id)
      }
    }
    expect((await get('/api/matches/my-meta')).body).toMatchObject({ era: 'B4a', enough: false, matched: 0 })
    await log(first?.archetype.name ?? '', 8)
    await log((second?.archetype.name ?? '').toUpperCase(), 4)
    await log('el de los fantasmas', 2)
    // Review of #52: matches before the era (B4a starts on 27/8) and friendly matches stay out by default.
    await log(second?.archetype.name ?? '', 3, { playedAt: '2026-08-01T15:00:00.000Z' })
    await log(second?.archetype.name ?? '', 3, { mode: 'friend' })
    const meta = (await get('/api/matches/my-meta')).body as {
      enough: boolean
      matched: number
      effectiveMatches: number
      orientative: boolean
      from: string
      filters: { modes: string[] }
      shares: { archetypeId: string; share: number; ci95: [number, number]; games: number }[]
      unmatched: { label: string; games: number }[]
      text: string
    }
    expect(meta.enough).toBe(true)
    expect(meta.matched).toBe(12)
    expect(meta.from.slice(0, 10)).toBe('2026-08-27')
    expect(meta.filters.modes).toEqual(['competitive', 'casual'])
    // All of today: the effective matches are the matches, and 12 are still few.
    expect(meta.effectiveMatches).toBeCloseTo(12, 6)
    expect(meta.orientative).toBe(true)
    expect(meta.shares[0]?.ci95[0]).toBeLessThan(meta.shares[0]?.share ?? 0)
    const friends = (await get('/api/matches/my-meta?mode=friend')).body as { matched: number; enough: boolean }
    expect(friends).toMatchObject({ matched: 3, enough: false })
    expect(meta.shares.map((row) => [row.archetypeId, row.games])).toEqual([
      [first?.archetype.id, 8],
      [second?.archetype.id, 4],
    ])
    expect(meta.shares[0]?.share).toBeCloseTo((8 / 12) * 100, 1)
    expect(meta.unmatched).toEqual([{ key: 'el de los fantasmas', label: 'el de los fantasmas', games: 2 }])
    expect(meta.text).toMatch(/^Tu meta \(12 partidas/)
    expect((await get('/api/matches/my-meta?days=0')).status).toBe(400)

    expect((await patch(`/api/decks/${blaziken?.id}`).send({ builtInGame: true })).status).toBe(200)
    const mine = (await get('/api/decks-today?meta=mine')).body as {
      weights: { asked: string; used: string; mine: { enough: boolean } }
      items: { deck: { id: string }; tournament: { value: number; ci95: number[] } | null }[]
      note: string
    }
    expect(mine.weights).toMatchObject({ asked: 'mine', used: 'mine', mine: { enough: true, orientative: true } })
    expect(mine.note).toContain('pesado por tus rivales de la era')
    const row = mine.items.find((item) => item.deck.id === blaziken?.id)
    expect(row?.tournament?.ci95).toHaveLength(2)
    const plain = (await get('/api/decks-today')).body as { weights: { used: string } }
    expect(plain.weights.used).toBe('tournament')
    expect((await get('/api/decks-today?meta=nope')).status).toBe(400)
    await patch(`/api/decks/${blaziken?.id}`).send({ builtInGame: false })

    const sheet = (await get(`/api/decks/${blaziken?.id}/matchups`)).body as {
      expected: { value: number } | null
      expectedMine: { value: number; ci95: number[] } | null
      myMeta: { enough: boolean; matched: number; effectiveMatches: number } | null
    }
    expect(sheet.myMeta).toMatchObject({ enough: true, matched: 12 })
    expect(sheet.expectedMine?.value).toBeGreaterThan(0)
    expect(sheet.expectedMine?.ci95).toHaveLength(2)
    // The sheet's mode filter reaches «mi meta» too: three friendly matches are not enough to weigh with.
    const friendly = (await get(`/api/decks/${blaziken?.id}/matchups?mode=friend`)).body as typeof sheet
    expect(friendly.myMeta).toMatchObject({ matched: 3, enough: false })
    expect(friendly.expectedMine).toBeNull()
    for (const id of ids)
      expect((await test.http().delete(`/api/matches/${id}`).set('Cookie', cookie)).status).toBe(204)
  })

  it('¿qué mazo armo después? (Fase 44): per archetype its closest list, the cost and whether I have one', async () => {
    const view = (await get('/api/decks-next')).body as {
      maxMissing: number
      rows: {
        archetype: { archetype: { id: string; name: string }; lists: number; rate: { ci95: number[] } | null }
        closest: { missingCopies: number; missing: { nameEs: string; need: number; have: number }[] }
        points: number | null
        unpriced: number
        built: boolean
      }[]
      note: string
    }
    expect(view.maxMissing).toBe(8)
    expect(view.rows.length).toBeGreaterThan(0)
    for (const row of view.rows) {
      expect(row.closest.missingCopies).toBeLessThanOrEqual(8)
      expect(row.archetype.lists).toBeGreaterThanOrEqual(10)
      if (row.closest.missingCopies === 0) expect(row.points).toBe(0)
    }
    // Not built first, then by the low end of the interval.
    const firstBuilt = view.rows.findIndex((row) => row.built)
    if (firstBuilt >= 0) expect(view.rows.slice(firstBuilt).every((row) => row.built)).toBe(true)
    const ready = (await get('/api/decks-next?maxMissing=0')).body as typeof view
    expect(ready.rows.every((row) => row.closest.missingCopies === 0)).toBe(true)
    expect(view.note).toContain('extremo bajo')
    expect((await get('/api/decks-next?maxMissing=99')).status).toBe(400)
  })

  it('eventos (Fase 16): which decks and which tournament lists comply with an event', async () => {
    const created = await post('/api/events').send({
      name: 'Copa sin ex',
      startsOn: '2026-10-10',
      endsOn: '2026-10-17',
      rules: { noEx: true },
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ name: 'Copa sin ex', startsOn: '2026-10-10', rulesEs: ['Sin Pokémon ex.'] })
    const id = created.body.id as string
    const detail = (await get(`/api/events/${id}`)).body as {
      decks: { name: string; ok: boolean; problems: string[] }[]
      lists: { pokemon: string[]; missingCopies: number; lists: number }[]
      era: string
    }
    expect(detail.era).toBe('B4a')
    const blaziken = detail.decks.find((deck) => deck.name === 'Mega-Blaziken ex')
    expect(blaziken?.ok).toBe(false)
    expect(blaziken?.problems.some((problem) => problem.includes('es un Pokémon ex'))).toBe(true)
    // Decks that comply come first.
    const firstBad = detail.decks.findIndex((deck) => !deck.ok)
    expect(detail.decks.slice(firstBad).every((deck) => !deck.ok)).toBe(true)
    for (let i = 1; i < detail.lists.length; i++) {
      expect(detail.lists[i - 1]?.missingCopies).toBeLessThanOrEqual(detail.lists[i]?.missingCopies ?? 0)
    }
    // A stricter rule: only Fire Pokémon and at least 8 of them.
    const patched = await patch(`/api/events/${id}`).send({
      rules: { types: ['fire'], minOfType: { type: 'fire', count: 8 } },
    })
    expect(patched.body.rulesEs).toEqual(['Solo Pokémon de tipo Fuego.', 'Al menos 8 Pokémon de tipo Fuego.'])
    expect((await get('/api/events')).body.items).toHaveLength(1)
    expect((await post('/api/events').send({ name: 'x', rules: { banned: ['ZZ-999'] } })).status).toBe(400)
    expect((await post('/api/events').send({ name: 'x', rules: { types: ['plasma'] } })).status).toBe(400)
    expect((await test.http().delete(`/api/events/${id}`).set('Cookie', cookie)).status).toBe(204)
    expect((await get(`/api/events/${id}`)).status).toBe(404)
  })

  it('meta semanal (Fase 11): the week of PMPT #45 against the week before (empty here)', async () => {
    const trends = (await get('/api/tournaments/trends')).body as {
      days: number
      now: { tournaments: number; lists: number; from: string; to: string }
      before: { tournaments: number; lists: number }
      archetypes: { archetype: { name: string }; delta: number; clear: boolean; isNew: boolean }[]
      cards: { nameEs: string; delta: number }[]
      attribution: string
    }
    expect(trends).toMatchObject({ days: 7, now: { tournaments: 1, lists: 393 }, before: { tournaments: 0, lists: 0 } })
    expect(new Date(trends.now.to).getTime() - new Date(trends.now.from).getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    expect(trends.archetypes.length).toBeGreaterThan(5)
    expect(trends.archetypes.every((row) => !row.clear && !row.isNew)).toBe(true)
    expect(trends.cards[0]?.nameEs.length).toBeGreaterThan(0)
    expect(trends.attribution).toContain('Limitless')
    expect((await get('/api/tournaments/trends?days=2')).status).toBe(400)
  })

  it('«versión de torneo» of each deck, and Sobres aiming «Completar mazos» at it', async () => {
    interface Version {
      deckId: string
      deckName: string
      archetype: { name: string; source: string } | null
      version: {
        list: { key: string; lists: number; cards: { count: number }[] }
        swaps: number
        add: { groupId: string; count: number }[]
        remove: { count: number }[]
        missing: { groupId: string; need: number; have: number }[]
        missingCopies: number
        alternatives: unknown[]
      } | null
    }
    const all = (await get('/api/tournaments/decks/versions')).body as { scope: { lists: number }; decks: Version[] }
    expect(all.scope.lists).toBe(393)
    expect(all.decks).toHaveLength(40)
    const sum = (items: { count: number }[]) => items.reduce((total, item) => total + item.count, 0)
    for (const deck of all.decks) {
      if (!deck.version) continue
      expect(sum(deck.version.list.cards)).toBe(20)
      expect(sum(deck.version.add)).toBe(deck.version.swaps)
      expect(sum(deck.version.remove)).toBe(deck.version.swaps)
      expect(deck.version.missingCopies).toBe(
        deck.version.missing.reduce((total, item) => total + item.need - item.have, 0),
      )
      expect(deck.version.alternatives).toEqual([])
    }
    const blaziken = all.decks.find((deck) => deck.deckName === 'Mega-Blaziken ex')
    expect(blaziken?.archetype?.name).toMatch(/Blaziken/i)
    const one = (await get(`/api/tournaments/decks/${blaziken?.deckId}/version`)).body as Version & { scope: unknown }
    expect(one.version?.list.key).toBe(blaziken?.version?.list.key)
    expect(one.version?.alternatives.length).toBeLessThanOrEqual(3)
    expect(one.scope).toBeDefined()
    expect((await get('/api/tournaments/decks/999999/version')).status).toBe(404)

    // A complete deck asks nothing of its saved list; aimed at its tournament version, it asks for what that lacks.
    const target = all.decks.find((deck) => (deck.version?.missingCopies ?? 0) > 0)
    if (!target?.version) throw new Error('no deck lacks anything for its tournament version')
    expect((await patch(`/api/decks/${target.deckId}`).send({ packPriority: 3 })).status).toBe(200)
    try {
      const saved = (await post('/api/packs/recommend').send({ collection: null, deckTarget: 'saved' })).body
      expect(saved.deckTarget).toBe('saved')
      expect(saved.goals.decks).toEqual([expect.objectContaining({ id: target.deckId, target: 'saved', list: null })])
      const aimed = (await post('/api/packs/recommend').send({ collection: null, deckTarget: 'tournament' })).body
      expect(aimed.goals.decks[0]).toMatchObject({
        id: target.deckId,
        target: 'tournament',
        list: { key: target.version.list.key },
      })
      const wanted = new Set((aimed.missing as { groupId: string }[]).map((item) => item.groupId))
      for (const item of target.version.missing) expect(wanted.has(item.groupId)).toBe(true)
      // The choice is saved with the other knobs.
      expect((await put('/api/settings/packDeckTarget').send({ value: 'tournament' })).status).toBe(200)
      expect((await post('/api/packs/recommend').send({ collection: null })).body.deckTarget).toBe('tournament')
      expect((await put('/api/settings/packDeckTarget').send({ value: 'saved' })).status).toBe(200)
    } finally {
      await patch(`/api/decks/${target.deckId}`).send({ packPriority: 0 })
    }
  })

  it('MCP tools: stats by archetype and list, with and without a card, buildable lists and unlock cards', async () => {
    const token = (await post('/api/tokens').send({ name: 'claude', kind: 'mcp', scopes: ['mcp:read'] })).body.token
    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        structuredContent?: Structured
        isError?: boolean
        content: { text?: string }[]
      }
      expect(result.isError, result.content[0]?.text).toBeFalsy()
      return result.structuredContent ?? {}
    }
    try {
      const stats = await call('tournaments_stats', { limit: 3 })
      expect(stats.scope).toMatchObject({ lists: 393, tournaments: 1, source: expect.stringContaining('Limitless') })
      expect(String((stats.scope as { eraMean: { text: string } }).eraMean.text)).toContain('n = 2.190 en 393 listas')
      expect(stats.archetypes).toHaveLength(3)
      const top = (stats.archetypes as { name: string }[])[0]
      const detail = await call('tournaments_stats', { archetype: top?.name })
      const card = (detail.cards as { card: string; lists: number }[]).find(
        (item) => item.lists < ((detail.archetype as { lists: number }).lists ?? 0),
      )
      const split = await call('tournaments_stats', { archetype: top?.name, card: card?.card })
      const ww = split.withWithout as { with: { lists: number }; without: { lists: number } }
      expect(ww.with.lists + ww.without.lists).toBe((detail.archetype as { lists: number }).lists)
      expect((await call('tournaments_stats', { by: 'list', limit: 2 })).lists).toHaveLength(2)
      const event = await post('/api/events').send({ name: 'Evento de Claude', rules: { noEx: true } })
      const checked = await call('events_check', { event: 'claude' })
      expect((checked.event as { name: string }).name).toBe('Evento de Claude')
      expect((checked.decksThatDoNot as unknown[]).length).toBeGreaterThan(0)
      expect((await call('events_check')).total).toBe(1)
      await test.http().delete(`/api/events/${event.body.id}`).set('Cookie', cookie)
      const luck = await call('matches_luck', { deck: 'Mega-Blaziken ex' })
      expect(String(luck.text).length).toBeGreaterThan(10)
      const week = await call('tournaments_trends', { limit: 3 })
      expect(week.thisWeek).toMatchObject({ lists: 393 })
      expect((week.archetypesUp as unknown[]).length + (week.archetypesDown as unknown[]).length).toBeGreaterThan(0)
      const table = await call('tournaments_matchups', { top: 4 })
      expect(table.archetypes).toHaveLength(4)
      expect((table.archetypes as { matchups: string[] }[])[0]?.matchups[0]).toMatch(/^vs .+: \d/)
      const one = await call('tournaments_matchups', { archetype: top?.name })
      expect((one.rivals as unknown[]).length).toBeGreaterThan(5)
      expect(one.expectedAgainstMeta).toMatchObject({ value: expect.stringMatching(/ %$/) })
      const next = await call('decks_next_build', { limit: 3 })
      expect((next.archetypes as unknown[]).length).toBeGreaterThan(0)
      expect(String((next.archetypes as { cost: string }[])[0]?.cost)).toMatch(
        /(puntos de sobre|sin precio en puntos) \(\d+ copias intercambiables\)$/,
      )
      const myMeta = await call('matches_my_meta', {})
      expect(typeof myMeta.enough).toBe('boolean')
      expect(String(myMeta.text).length).toBeGreaterThan(10)
      expect((await call('decks_pick_today', { meta: 'mine' })).weights).toMatchObject({ used: 'meta de torneos' })
      const techs = await call('tournaments_archetype_cards', { archetype: top?.name })
      expect((techs.core as { slots: string }).slots).toMatch(/de 20 \(quedan/)
      expect(Array.isArray(techs.techs)).toBe(true)
      expect(String(techs.topConversion)).toMatch(/top 8/)
      const buildable = await call('tournaments_buildable', { limit: 2 })
      expect((buildable.buildable as unknown[]).length).toBeGreaterThan(0)
      const unlock = await call('tournaments_unlock_cards', { limit: 3 })
      expect((unlock.cards as { listsUnlocked: number }[])[0]?.listsUnlocked).toBeGreaterThan(0)
      const deck = await call('decks_get', { deck: 'Mega-Blaziken ex', detail: 'full' })
      const version = deck.tournamentVersion as { archetype: { name: string }; list: { cards: string[] } | null }
      expect(version.archetype.name).toMatch(/Blaziken/i)
      expect(version.list?.cards.length).toBeGreaterThan(0)
      const packs = await call('packs_recommend', { deckTarget: 'tournament', collection: null })
      expect((packs.goals as { deckTarget: string }).deckTarget).toBe('versión de torneo')
      const missing = (await client.callTool({ name: 'tournaments_stats', arguments: { card: 'Hoopa ex' } })) as {
        isError?: boolean
      }
      expect(missing.isError).toBe(true)
    } finally {
      await client.close()
    }
  })

  it('backup version 4 carries the era table, the merges and each deck’s archetype, not the tournaments', async () => {
    const response = await get('/api/backup/export').responseType('blob')
    const { gunzipSync } = await import('node:zlib')
    const document = JSON.parse(gunzipSync(response.body as Buffer).toString('utf8')) as Structured & {
      tournaments: { sets: unknown[]; archetypeAliases: unknown[] }
      decks: { tournamentArchetypeId: string | null }[]
    }
    expect(document.schemaVersion).toBe(10)
    expect(document.tournaments.sets).toHaveLength(22)
    expect(document.tournaments.archetypeAliases).toEqual([])
    expect(document.decks.every((deck) => deck.tournamentArchetypeId === null)).toBe(true)
    expect(JSON.stringify(document)).not.toContain(BIG)
  })
})
