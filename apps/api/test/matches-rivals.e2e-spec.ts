import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { type FetchLike, LimitlessTransport } from '../src/tournaments/limitless.client.js'
import { TournamentSyncService } from '../src/tournaments/tournament-sync.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Pedido de Santi del 14/10: the rival's cards seen in a match, the era's archetypes they suggest (PMPT #45, B4a,
 * served by a fake Limitless), the matches to classify grouped by cards, and classifying them (and reclassifying).
 */
const LIMITLESS = join(REPO_ROOT, 'docs/fase0/limitless')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')
const BIG = '6a95b87b629039f77d8a6954'
const read = (file: string): unknown => JSON.parse(readFileSync(join(LIMITLESS, file), 'utf8'))

// Greninja (A1-89), Suicune ex and Indeedee ex: the rival of 14/10 that fits no archetype of B4a.
const GRENINJA = 'A1-89'
const INDEEDEE = 'B1-121'

interface Seen {
  cardId: string
  count: number
  nameEs: string
}

describe('rivals by the cards seen (e2e)', () => {
  let test: TestApp
  let cookie: string
  let deckId: string
  let suicune: string

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const patch = (path: string) => test.http().patch(path).set('Cookie', cookie)

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const preview = await post('/api/decks/import').send({ text: readFileSync(DECKS_PATH, 'utf8') })
    const inputs = (preview.body.drafts as { title: string; draft: { energies: string[]; cards: unknown[] } | null }[])
      .filter((d) => d.draft && d.draft.energies.length > 0)
      .slice(0, 1)
      .map((d) => ({ name: d.title, energies: d.draft?.energies, cards: d.draft?.cards }))
    const created = await post('/api/decks/import/commit').send({ decks: inputs })
    expect(created.status).toBe(201)
    deckId = created.body.created[0].id
    const listing = [...(read('t1.json') as { id: string }[]), ...(read('t2.json') as { id: string }[])].filter(
      (tournament) => tournament.id === BIG,
    )
    const fake: FetchLike = async (url) => {
      const path = url.replace(test.env.limitlessBaseUrl, '')
      const json = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body })
      if (/^\/tournaments\?/.test(path)) return json(200, /page=1$/.test(path) ? listing : [])
      if (path === `/tournaments/${BIG}/details`) return json(200, read('big_details.json'))
      if (path === `/tournaments/${BIG}/standings`) return json(200, read('big_standings.json'))
      return json(404, { message: 'unknown path' })
    }
    test.app.get(LimitlessTransport).fetch = fake
    await test.app.get(TournamentSyncService).run({ now: new Date('2026-10-07T00:00:00Z') })
    suicune = test.app.get(CatalogService).requireIndex().groupsByNameEn('Suicune ex')[0]?.displayCardId as string
    expect(suicune).toBeTruthy()
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  it('a match keeps the cards seen, one line per name; old matches have none; bad cards are refused', async () => {
    const plain = await post('/api/matches').send({ deckId, result: 'win', opponent: 'Mega-Blaziken ex' })
    expect(plain.status).toBe(201)
    expect(plain.body.opponentCards).toEqual([])
    const seen = await post('/api/matches').send({
      deckId,
      result: 'loss',
      opponentCards: [
        { cardId: GRENINJA, count: 1 },
        { cardId: GRENINJA, count: 1 },
        { cardId: suicune, count: 1 },
      ],
    })
    expect(seen.status).toBe(201)
    expect(seen.body.opponent).toBeNull()
    expect((seen.body.opponentCards as Seen[]).map(({ cardId, count }) => ({ cardId, count }))).toEqual([
      { cardId: GRENINJA, count: 2 },
      { cardId: suicune, count: 1 },
    ])
    expect((seen.body.opponentCards as Seen[])[0]?.nameEs).toBeTruthy()
    // Editing: the cards change, and only them.
    const edited = await patch(`/api/matches/${seen.body.id}`).send({
      opponentCards: [
        { cardId: GRENINJA, count: 2 },
        { cardId: suicune, count: 1 },
        { cardId: INDEEDEE, count: 1 },
      ],
    })
    expect(edited.status).toBe(200)
    expect(edited.body.opponentCards).toHaveLength(3)
    expect(edited.body.result).toBe('loss')
    // Unknown card, three copies, too many cards: 400.
    for (const opponentCards of [
      [{ cardId: 'ZZ-999', count: 1 }],
      [{ cardId: GRENINJA, count: 3 }],
      Array.from({ length: 21 }, () => ({ cardId: GRENINJA, count: 1 })),
    ]) {
      expect((await post('/api/matches').send({ deckId, result: 'win', opponentCards })).status).toBe(400)
    }
    // Statistics by rival do not change: a match without a rival stays one.
    const stats = (await get('/api/matches/stats')).body as { byOpponent: { label: string }[] }
    expect(stats.byOpponent.map((row) => row.label)).toEqual(expect.arrayContaining(['Mega-Blaziken ex']))
  })

  it("the cards suggest the era's archetypes; Santi's rival only gets «parecido»", async () => {
    const suggestions = await get(`/api/matches/rival-suggestions?cards=${GRENINJA}x2,${suicune},${INDEEDEE}`)
    expect(suggestions.status).toBe(200)
    expect(suggestions.body).toMatchObject({ era: 'B4a', lists: 393 })
    const found = suggestions.body.suggestions as { kind: string; best: number; seen: number; text: string }[]
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((fit) => fit.kind === 'similar' && fit.seen === 3)).toBe(true)
    // One card of a played archetype: some list has it.
    const one = await get(`/api/matches/rival-suggestions?cards=${INDEEDEE}`)
    expect((one.body.suggestions as { kind: string }[])[0]?.kind).toBe('fits')
    expect((await get('/api/matches/rival-suggestions?cards=ZZ-999')).status).toBe(400)
    expect((await get(`/api/matches/rival-suggestions?cards=${GRENINJA}x5`)).status).toBe(400)
  })

  it('the matches to classify come grouped by cards; a group gets a name, and a rival can be renamed', async () => {
    // A second match against the same rival (fewer cards seen): same group.
    const other = await post('/api/matches').send({
      deckId,
      result: 'win',
      opponentCards: [
        { cardId: GRENINJA, count: 1 },
        { cardId: suicune, count: 1 },
      ],
    })
    expect(other.status).toBe(201)
    const pending = await get('/api/matches/unclassified')
    expect(pending.status).toBe(200)
    const groups = pending.body.groups as { matches: { id: string }[]; cards: Seen[]; text: string }[]
    expect(groups).toHaveLength(1)
    expect(groups[0]?.matches.map((match) => match.id)).toContain(other.body.id)
    expect(groups[0]?.matches).toHaveLength(2)
    expect(groups[0]?.text).toMatch(/^2 /)
    // Classified as one of the owner's own.
    const ids = groups[0]?.matches.map((match) => match.id) ?? []
    const named = await post('/api/matches/classify').send({ matchIds: ids, opponent: '  Greninja   Suicune ' })
    expect(named.body).toEqual({ updated: 2, opponent: 'Greninja Suicune' })
    expect((await get('/api/matches/unclassified')).body.groups).toEqual([])
    // It is no archetype of the era: it shows among the owner's own, and can be moved to an archetype later.
    const own = (await get('/api/matches/unclassified')).body.own as { key: string; label: string; games: number }[]
    expect(own).toContainEqual(expect.objectContaining({ label: 'Greninja Suicune', games: 2 }))
    const moved = await post('/api/matches/classify').send({
      from: 'greninja suicune',
      opponent: 'Suicune ex Baxcalibur',
    })
    expect(moved.body).toEqual({ updated: 2, opponent: 'Suicune ex Baxcalibur' })
    const list = (await get('/api/matches?opponent=Suicune%20ex%20Baxcalibur&opponentMatch=exact')).body.items as {
      opponent: string
      opponentCards: Seen[]
    }[]
    expect(list).toHaveLength(2)
    expect(list.every((match) => match.opponentCards.length > 0)).toBe(true)
    // Refused: nothing to classify, an empty rival, a match that does not exist.
    expect((await post('/api/matches/classify').send({ opponent: 'X' })).status).toBe(400)
    expect((await post('/api/matches/classify').send({ matchIds: ids, opponent: '   ' })).status).toBe(400)
    expect((await post('/api/matches/classify').send({ matchIds: ['999999'], opponent: 'X' })).status).toBe(404)
  })

  it('needs a session', async () => {
    expect((await test.http().get('/api/matches/unclassified')).status).toBe(401)
    expect((await test.http().get(`/api/matches/rival-suggestions?cards=${GRENINJA}`)).status).toBe(401)
    expect(
      (
        await test
          .http()
          .post('/api/matches/classify')
          .send({ matchIds: ['1'], opponent: 'X' })
      ).status,
    ).toBe(401)
  })
})
