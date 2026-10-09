import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatWinRateEs, type WinRate } from '@tcg/domain'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** docs/PLAN.md §7 Fase 2 (M6) against real decks from mazos_40_listas.md. */
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

interface MatchBody {
  id: string
  deck: { id: string; name: string; archived: boolean }
  deckRevision: number
  result: string
  opponent: string | null
  wentFirst: boolean | null
  mode: string
  note: string
  playedAt: string
  source: string
}

interface Row {
  record: { wins: number; losses: number; ties: number }
  rate: WinRate | null
}

describe('matches (e2e)', () => {
  let test: TestApp
  let cookie: string
  /** Three real decks: [A, B, C]. */
  let decks: { id: string; name: string }[]

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const preview = await test
      .http()
      .post('/api/decks/import')
      .set('Cookie', cookie)
      .send({ text: readFileSync(DECKS_PATH, 'utf8') })
    const inputs = (preview.body.drafts as { title: string; draft: { energies: string[]; cards: unknown[] } | null }[])
      .filter((d) => d.draft && d.draft.energies.length > 0)
      .slice(0, 3)
      .map((d) => ({ name: d.title, energies: d.draft?.energies, cards: d.draft?.cards }))
    const created = await test.http().post('/api/decks/import/commit').set('Cookie', cookie).send({ decks: inputs })
    expect(created.status).toBe(201)
    decks = created.body.created.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))
    expect(decks).toHaveLength(3)
  })

  afterAll(async () => {
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const patch = (path: string) => test.http().patch(path).set('Cookie', cookie)
  const del = (path: string) => test.http().delete(path).set('Cookie', cookie)
  const deck = (index: 0 | 1 | 2) => decks[index] as { id: string; name: string }

  async function log(body: Record<string, unknown>): Promise<MatchBody> {
    const response = await post('/api/matches').send(body)
    if (response.status !== 201) throw new Error(`log failed: ${response.status} ${JSON.stringify(response.body)}`)
    return response.body as MatchBody
  }

  it('logs a match with the server time, the current revision and the last mode by default', async () => {
    const before = Date.now()
    const first = await log({ deckId: deck(0).id, result: 'win', opponent: '  Mega-Blaziken   ex ', wentFirst: true })
    expect(first).toMatchObject({
      deck: { id: deck(0).id, name: deck(0).name, archived: false },
      deckRevision: 1,
      result: 'win',
      opponent: 'Mega-Blaziken ex',
      wentFirst: true,
      mode: 'casual',
      note: '',
      source: 'ui',
    })
    expect(typeof first.id).toBe('string')
    const playedAt = Date.parse(first.playedAt)
    expect(playedAt).toBeGreaterThanOrEqual(before - 1000)
    expect(playedAt).toBeLessThanOrEqual(Date.now() + 1000)

    // The mode sticks: the next match without `mode` reuses the last one.
    expect((await log({ deckId: deck(0).id, result: 'loss', mode: 'competitive' })).mode).toBe('competitive')
    const sticky = await log({ deckId: deck(0).id, result: 'tie', opponent: '---', note: '  lag  ' })
    expect(sticky).toMatchObject({ mode: 'competitive', opponent: null, wentFirst: null, note: 'lag' })
  })

  it('validates the input', async () => {
    const missing = await post('/api/matches').send({ deckId: deck(0).id })
    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe('validation')
    expect((await post('/api/matches').send({ deckId: deck(0).id, result: 'draw' })).status).toBe(400)
    expect((await post('/api/matches').send({ deckId: '999999', result: 'win' })).status).toBe(404)
    expect((await post('/api/matches').send({ deckId: 'abc', result: 'win' })).status).toBe(404)
    const long = await post('/api/matches').send({ deckId: deck(0).id, result: 'win', opponent: 'x'.repeat(81) })
    expect(long.status).toBe(400)
    const future = await post('/api/matches').send({
      deckId: deck(0).id,
      result: 'win',
      playedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    expect(future.status).toBe(400)
    expect(future.body.error.code).toBe('played_at_future')
    expect((await post('/api/matches').send({ deckId: deck(0).id, result: 'win', playedAt: 'ayer' })).status).toBe(400)
    expect(
      (
        await test
          .http()
          .post('/api/matches')
          .send({ deckId: deck(0).id, result: 'win' })
      ).status,
    ).toBe(401)
    expect((await test.http().get('/api/matches')).status).toBe(401)
  })

  it('stores the revision that was current when the match was played', async () => {
    const detail = (await get(`/api/decks/${deck(2).id}`)).body as { cards: { card: { id: string }; count: number }[] }
    const cards = detail.cards.map((c) => ({ cardId: c.card.id, count: c.count }))
    ;(cards[0] as { count: number }).count = 1
    expect((await patch(`/api/decks/${deck(2).id}`).send({ cards, note: 'r2' })).body.revisionNumber).toBe(2)

    expect((await log({ deckId: deck(2).id, result: 'win' })).deckRevision).toBe(2)
    // Logged after the fact, dated before the deck existed in the app: revision 1.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const old = await log({ deckId: deck(2).id, result: 'loss', playedAt: yesterday })
    expect(old.deckRevision).toBe(1)
    expect(old.playedAt).toBe(yesterday)
    // Moving the date after revision 2 moves the match to it (a minute ahead: within the future tolerance).
    const moved = await patch(`/api/matches/${old.id}`).send({ playedAt: new Date(Date.now() + 60_000).toISOString() })
    expect(moved.status).toBe(200)
    expect(moved.body.deckRevision).toBe(2)
    // Moving it to another deck takes that deck's revision.
    const other = await patch(`/api/matches/${old.id}`).send({ deckId: deck(0).id })
    expect(other.body).toMatchObject({ deck: { id: deck(0).id }, deckRevision: 1 })
    expect((await patch(`/api/matches/${old.id}`).send({ deckId: deck(2).id })).body.deckRevision).toBe(2)
  })

  it('PLAN §7 Fase 2: 7 wins in 10 show as «70 % (n = 10, IC 39,7–89,2 %, orientativo)»', async () => {
    const spellings = ['Mega-Blaziken ex', 'mega blaziken ex', 'Mega Blaziken EX']
    for (let i = 0; i < 10; i += 1) {
      await log({
        deckId: deck(1).id,
        result: i < 7 ? 'win' : 'loss',
        opponent: spellings[i % 3],
        wentFirst: i % 2 === 0,
        mode: 'casual',
      })
    }
    const stats = await get(`/api/matches/stats?deckId=${deck(1).id}`)
    expect(stats.status).toBe(200)
    const overall = stats.body.overall as Row
    expect(overall.record).toEqual({ wins: 7, losses: 3, ties: 0 })
    expect(overall.rate).toMatchObject({
      source: 'matches',
      value: 70,
      games: 10,
      samples: 10,
      sampleKind: 'matches',
      orientative: true,
    })
    expect(overall.rate?.ci95[0]).toBeCloseTo(39.68, 2)
    expect(overall.rate?.ci95[1]).toBeCloseTo(89.22, 2)
    expect(formatWinRateEs(overall.rate)).toBe('70 % (n = 10, IC 39,7–89,2 %, orientativo)')
    // The three spellings are one opponent, labelled with the most used one.
    expect(stats.body.byOpponent).toHaveLength(1)
    expect(stats.body.byOpponent[0]).toMatchObject({
      key: 'mega blaziken ex',
      label: 'Mega-Blaziken ex',
      record: { wins: 7, losses: 3, ties: 0 },
    })
    expect(stats.body.byRevision).toEqual([expect.objectContaining({ revision: 1 })])
    expect(stats.body.filters).toEqual({ deckId: deck(1).id, mode: null, from: null, to: null })
  })

  it('aggregates overall, by deck, by who went first and by mode, with filters', async () => {
    const stats = await get('/api/matches/stats')
    const body = stats.body as {
      overall: Row
      byDeck: (Row & { deck: { id: string; name: string } })[]
      byWentFirst: (Row & { key: string; label: string })[]
      byMode: (Row & { mode: string; label: string })[]
      byOpponent: (Row & { key: string | null; label: string })[]
      byRevision: unknown[]
    }
    // deck A: win, loss, tie, + the moved-back match is on deck C; deck B: 10; deck C: 2.
    expect(body.overall.record).toEqual({ wins: 9, losses: 5, ties: 1 })
    expect(body.byDeck.map((row) => [row.deck.id, row.rate?.games])).toEqual([
      [deck(1).id, 10],
      [deck(0).id, 3],
      [deck(2).id, 2],
    ])
    expect(body.byDeck[0]?.deck.name).toBe(deck(1).name)
    expect(body.byWentFirst.map((row) => [row.key, row.label, row.rate?.games ?? 0])).toEqual([
      ['first', 'Empecé yo', 6],
      ['second', 'Empezó el rival', 5],
      ['unknown', 'Sin dato', 4],
    ])
    expect(body.byMode.map((row) => [row.mode, row.label])).toEqual([
      ['competitive', 'Competitiva'],
      ['casual', 'Distendida'],
    ])
    expect(body.byOpponent[0]).toMatchObject({ label: 'Mega-Blaziken ex', record: { wins: 8, losses: 3, ties: 0 } })
    expect(body.byOpponent.at(-1)).toMatchObject({ key: null, label: 'Sin rival anotado' })
    expect(body.byRevision).toEqual([])

    const competitive = await get('/api/matches/stats?mode=competitive')
    // The mode sticks: the two deck C matches logged without `mode` inherited «competitive».
    expect(competitive.body.overall.record).toEqual({ wins: 1, losses: 2, ties: 1 })
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const empty = await get(`/api/matches/stats?from=${encodeURIComponent(future)}`)
    expect(empty.body.overall).toEqual({ record: { wins: 0, losses: 0, ties: 0 }, rate: null })
    const backwards = await get(
      `/api/matches/stats?from=${encodeURIComponent(future)}&to=${encodeURIComponent(new Date().toISOString())}`,
    )
    expect(backwards.status).toBe(400)
    expect((await get('/api/matches/stats?mode=ranked')).status).toBe(400)
    expect((await get('/api/matches/stats?deckId=999999')).status).toBe(404)
  })

  it('suggests decks (recent first), the last deck and mode, and merged opponents', async () => {
    const response = await get('/api/matches/suggestions')
    expect(response.status).toBe(200)
    const body = response.body as {
      decks: { id: string; name: string; energies: string[]; lastPlayedAt: string | null; games: number }[]
      lastDeckId: string | null
      lastMode: string
      opponents: { key: string; label: string; games: number }[]
    }
    // The last *logged* match decides the preselected deck and mode…
    expect(body.lastDeckId).toBe(deck(1).id)
    expect(body.lastMode).toBe('casual')
    // …while the picker orders by the last *played* date: deck C has a match dated a minute ahead.
    expect(body.decks.map((d) => d.id)).toEqual([deck(2).id, deck(1).id, deck(0).id])
    expect(body.decks.map((d) => d.games)).toEqual([2, 10, 3])
    expect(body.decks[0]?.energies.length).toBeGreaterThan(0)
    expect(body.opponents[0]).toMatchObject({ key: 'mega blaziken ex', label: 'Mega-Blaziken ex', games: 11 })
  })

  it('lists newest first with filters and pagination, edits and deletes', async () => {
    const page = await get('/api/matches?limit=5')
    expect(page.status).toBe(200)
    expect(page.body.total).toBe(15)
    expect(page.body.items).toHaveLength(5)
    const dates = (page.body.items as MatchBody[]).map((m) => Date.parse(m.playedAt))
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
    expect((await get('/api/matches?offset=10&limit=10')).body.items).toHaveLength(5)
    // Case, accents and hyphens do not matter, and part of the name is enough.
    expect((await get('/api/matches?opponent=mega-blaziken%20EX')).body.total).toBe(11)
    expect((await get('/api/matches?opponent=BLAZ%C3%8DKEN')).body.total).toBe(11)
    expect((await get('/api/matches?opponent=gardevoir')).body.total).toBe(0)
    expect((await get(`/api/matches?deckId=${deck(1).id}&result=loss`)).body.total).toBe(3)
    expect((await get('/api/matches?limit=500')).status).toBe(400)

    const target = (page.body.items as MatchBody[])[0] as MatchBody
    const edited = await patch(`/api/matches/${target.id}`).send({
      result: 'tie',
      opponent: 'Gardevoir ex',
      wentFirst: null,
      mode: 'event',
      note: 'se cortó',
    })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({
      id: target.id,
      result: 'tie',
      opponent: 'Gardevoir ex',
      wentFirst: null,
      mode: 'event',
      note: 'se cortó',
    })
    expect((await get(`/api/matches/${target.id}`)).body.result).toBe('tie')
    expect((await patch(`/api/matches/${target.id}`).send({})).status).toBe(400)
    expect((await patch('/api/matches/999999').send({ result: 'win' })).status).toBe(404)

    expect((await del(`/api/matches/${target.id}`)).status).toBe(204)
    expect((await get(`/api/matches/${target.id}`)).status).toBe(404)
    expect((await del(`/api/matches/${target.id}`)).status).toBe(404)
    expect((await get('/api/matches')).body.total).toBe(14)
  })

  it('compares a deck in three separate columns; without synced tournaments and simulations they say why', async () => {
    const response = await get(`/api/decks/${deck(1).id}/comparison`)
    expect(response.status).toBe(200)
    const columns = response.body.columns as {
      source: string
      label: string
      available: boolean
      rate: WinRate | null
      note: string
    }[]
    expect(response.body.deck).toEqual({ id: deck(1).id, name: deck(1).name, archived: false })
    expect(columns.map((c) => [c.source, c.label, c.available])).toEqual([
      ['matches', 'Mis partidas', true],
      ['tournament', 'Torneo', false],
      ['simulation', 'Simulación', false],
    ])
    expect(columns[0]?.rate?.source).toBe('matches')
    expect(columns[0]?.rate?.games).toBeGreaterThan(0)
    expect(columns[1]).toMatchObject({ rate: null, record: null })
    expect(columns[1]?.note).toContain('Sin listas de torneo en la era')
    expect(columns[2]?.note).toContain('Todavía no se simuló')

    const fresh = await post('/api/decks').send({ name: 'Sin partidas', energies: ['fire'], cards: [] })
    const none = await get(`/api/decks/${fresh.body.id}/comparison`)
    expect(none.body.columns[0]).toMatchObject({
      available: true,
      record: { wins: 0, losses: 0, ties: 0 },
      rate: null,
    })
    expect((await get('/api/decks/999999/comparison')).status).toBe(404)
  })

  it('¿importa empezar? (Fase 25): going first against going second, overall and against each rival', async () => {
    const target = deck(2).id
    for (let i = 0; i < 6; i++) await log({ deckId: target, result: 'win', opponent: 'Hoopa ex', wentFirst: true })
    await log({ deckId: target, result: 'loss', opponent: 'Hoopa ex', wentFirst: true })
    for (let i = 0; i < 5; i++) await log({ deckId: target, result: 'loss', opponent: 'Hoopa ex', wentFirst: false })
    await log({ deckId: target, result: 'win', opponent: 'Hoopa ex', wentFirst: false })
    await log({ deckId: target, result: 'win', opponent: 'Hoopa ex' })
    const stats = (await get(`/api/matches/stats?deckId=${target}`)).body
    expect(stats.turnOrder).toMatchObject({
      first: { wins: 6, losses: 1, ties: 0 },
      second: { wins: 1, losses: 5, ties: 0 },
      verdict: 'clear',
    })
    // The deck already had matches without who went first from the tests above.
    expect(stats.turnOrder.unknown).toBeGreaterThanOrEqual(1)
    expect(stats.turnOrder.text).toMatch(/^Empezando ganás el 86 % \(n = 7\) y yendo segundo el 17 % \(n = 6\)/)
    const matchups = (await get(`/api/decks/${target}/matchups`)).body
    const hoopa = matchups.rows.find((row: { rival: { name: string } }) => row.rival.name === 'Hoopa ex')
    expect(hoopa.turn).toEqual({ first: { wins: 6, losses: 1, ties: 0 }, second: { wins: 1, losses: 5, ties: 0 } })
  })

  it('ejercicios de cálculo (Fase 30): a question from a deck, rebuilt to grade the answer, and the tally', async () => {
    const draw = (await get(`/api/drills?kind=draw&deckId=${deck(0).id}&seed=12345`)).body
    expect(draw).toMatchObject({ kind: 'draw', seed: 12345, deckId: deck(0).id, deck: deck(0).name })
    expect(draw.choices).toHaveLength(4)
    expect(draw).not.toHaveProperty('answer')
    expect((await get(`/api/drills?kind=draw&deckId=${deck(0).id}&seed=12345`)).body).toEqual(draw)
    // Without a deck: one of the decks, decided by the seed.
    const ko = (await get('/api/drills?kind=ko&seed=777')).body
    expect(decks.map((item) => item.id)).toContain(ko.deckId)
    expect(ko.facts.join(' ')).toContain('La debilidad suma 20')

    const results: boolean[] = []
    for (let choice = 0; choice < draw.choices.length; choice++) {
      const graded = await post('/api/drills/answer').send({ kind: 'draw', deckId: deck(0).id, seed: 12345, choice })
      expect(graded.status).toBe(200)
      expect(graded.body.explanation).toMatch(/^Es \d+ %/)
      results.push(graded.body.correct)
    }
    expect(results.filter(Boolean)).toHaveLength(1)
    const stats = (await get('/api/drills/stats')).body
    expect(stats.today).toEqual({ answered: 4, correct: 1 })
    expect(stats.byKind.draw).toEqual({ answered: 4, correct: 1 })
    expect(stats.streak).toBe(results.at(-1) ? 1 : 0)
    expect(
      (await post('/api/drills/answer').send({ kind: 'draw', deckId: deck(0).id, seed: 12345, choice: 7 })).status,
    ).toBe(400)
    expect((await get('/api/drills?kind=draw&deckId=999&seed=1')).status).toBe(400)
    expect((await get('/api/drills?kind=nope&seed=1')).status).toBe(400)
  })

  it('sin señal (Fase 28): a match sent twice with its clientRef is stored once, dated by how long ago it was played', async () => {
    const clientRef = '3f1c2b9e-8a47-4d1e-9c0b-5a6e7d8f9a01'
    const body = {
      deckId: deck(1).id,
      result: 'win',
      opponent: 'Pikachu ex',
      clientRef,
      playedAgoMs: 2 * 60 * 60 * 1000,
    }
    const first = await post('/api/matches').send(body)
    expect(first.status).toBe(201)
    const playedAgo = Date.now() - new Date(first.body.playedAt).getTime()
    expect(playedAgo).toBeGreaterThan(2 * 60 * 60 * 1000 - 60_000)
    expect(playedAgo).toBeLessThan(2 * 60 * 60 * 1000 + 60_000)
    const again = await post('/api/matches').send(body)
    expect(again.status).toBe(201)
    expect(again.body.id).toBe(first.body.id)
    expect((await get(`/api/matches?opponent=${encodeURIComponent('Pikachu ex')}`)).body.total).toBe(1)
    expect((await post('/api/matches').send({ ...body, clientRef: 'nope' })).status).toBe(400)
  })

  it('buscador único (Fase 27): cards, decks, matches and notes, accents and case ignored', async () => {
    await log({ deckId: deck(1).id, result: 'loss', opponent: 'Gyarados ex', note: 'me ganó con Dragonite' })
    await test
      .http()
      .put('/api/rival-notes')
      .set('Cookie', cookie)
      .send({ opponent: 'Gyarados ex', text: 'Guardar el Soplador' })
    const found = (await get('/api/search?q=GYARADOS')).body
    expect(found.q).toBe('GYARADOS')
    expect(found.cards.length).toBeGreaterThan(0)
    expect(found.cards[0].card.nameEn).toMatch(/Gyarados/)
    expect(found.matches[0]).toMatchObject({ opponent: 'Gyarados ex', result: 'loss', deck: deck(1).name })
    expect(found.notes).toEqual([expect.objectContaining({ label: 'Gyarados ex', text: 'Guardar el Soplador' })])
    // Every word counts, accents do not.
    const deckWord =
      deck(0)
        .name.split(/\s+/)
        .find((word) => word.length > 3) ?? deck(0).name
    expect((await get(`/api/search?q=${encodeURIComponent(deckWord.toUpperCase())}`)).body.decks).toContainEqual(
      expect.objectContaining({ id: deck(0).id }),
    )
    expect((await get('/api/search?q=dragonite%20gyarados')).body.matches).toHaveLength(1)
    expect((await get('/api/search?q=investigacion%20profesores')).body.cards.length).toBeGreaterThan(0)
    expect((await get('/api/search?q=a')).body).toMatchObject({ cards: [], decks: [], matches: [] })
    expect((await test.http().get('/api/search?q=pikachu')).status).toBe(401)
  })

  it('a deck with matches is not deleted, even archived: the matches stay in the statistics', async () => {
    expect((await patch(`/api/decks/${deck(0).id}`).send({ archived: true })).status).toBe(200)
    const refused = await del(`/api/decks/${deck(0).id}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('deck_has_matches')
    expect(refused.body.error.message).toContain('partidas registradas')
    expect((await get(`/api/matches?deckId=${deck(0).id}`)).body.total).toBe(3)
    const suggestions = await get('/api/matches/suggestions')
    expect(suggestions.body.decks.map((d: { id: string }) => d.id)).not.toContain(deck(0).id)
    const stats = await get('/api/matches/stats')
    expect(stats.body.byDeck.find((row: { deck: { id: string } }) => row.deck.id === deck(0).id)?.deck.archived).toBe(
      true,
    )
  })
})
