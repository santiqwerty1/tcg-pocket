import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { todayInOwnerZone } from '../src/config/time-zone.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Pedido de Santi del 14/10: ranked by season and rank. The seasons are set relative to today (the tests truncate the
 * ones the migration seeds), the rank is noted when it changes, and the summary reads the competitive matches.
 */
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')
const DAY_MS = 24 * 60 * 60 * 1000
const day = (offset: number) => todayInOwnerZone(new Date(Date.now() + offset * DAY_MS))

describe('ranked by season and rank (e2e)', () => {
  let test: TestApp
  let cookie: string
  let decks: { id: string; name: string }[]
  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)
  const del = (path: string) => test.http().delete(path).set('Cookie', cookie)

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
      .slice(0, 2)
      .map((d) => ({ name: d.title, energies: d.draft?.energies, cards: d.draft?.cards }))
    const created = await post('/api/decks/import/commit').send({ decks: inputs })
    expect(created.status).toBe(201)
    decks = created.body.created
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  it('seasons: created and corrected by code; days may not overlap or run backwards', async () => {
    expect(
      (await put('/api/ranked/seasons/NOW').send({ name: 'Temporada de hoy', startsOn: day(-2), endsOn: day(12) }))
        .status,
    ).toBe(200)
    expect(
      (await put('/api/ranked/seasons/OLD').send({ name: 'Temporada vieja', startsOn: day(-40), endsOn: day(-26) }))
        .status,
    ).toBe(200)
    // A day belongs to one season: one that starts the day another ends overlaps it too (decided: by days).
    const sharedDay = await put('/api/ranked/seasons/EDGE').send({
      name: 'Al borde',
      startsOn: day(12),
      endsOn: day(20),
    })
    expect(sharedDay.status).toBe(400)
    expect(
      (await put('/api/ranked/seasons/EDGE').send({ name: 'Al borde', startsOn: day(13), endsOn: day(20) })).status,
    ).toBe(200)
    expect((await del('/api/ranked/seasons/EDGE')).status).toBe(204)
    const overlap = await put('/api/ranked/seasons/BAD').send({ name: 'Encima', startsOn: day(-5), endsOn: day(-1) })
    expect(overlap.status).toBe(400)
    expect(overlap.body.error.message).toMatch(/Se superpone con Temporada de hoy/)
    expect(
      (await put('/api/ranked/seasons/BAD').send({ name: 'Al revés', startsOn: day(-50), endsOn: day(-60) })).status,
    ).toBe(400)
    // Correcting its own days is no overlap.
    expect(
      (await put('/api/ranked/seasons/NOW').send({ name: 'Temporada de hoy', startsOn: day(-3), endsOn: day(12) }))
        .status,
    ).toBe(200)
    const view = (await get('/api/ranked')).body
    expect(view.current).toMatchObject({ code: 'NOW', rank: null, endsOn: day(12) })
    expect(view.seasons.map((season: { code: string }) => season.code)).toEqual(['OLD', 'NOW'])
    expect(view.ranks).toHaveLength(17)
  })

  it('the rank noted, the matches at each rank, the curve and the decks it went up with', async () => {
    const ago = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    const log = (deck: number, result: string, hours: number, mode = 'competitive') =>
      post('/api/matches').send({ deckId: decks[deck]?.id, result, mode, playedAt: ago(hours) })
    expect((await log(0, 'loss', 30)).status).toBe(201)
    expect((await post('/api/ranked/ranks').send({ rank: 'ultra-2', at: ago(29) })).status).toBe(201)
    expect((await log(0, 'win', 20)).status).toBe(201)
    expect((await log(1, 'win', 19)).status).toBe(201)
    // A casual one does not count.
    expect((await log(1, 'win', 18, 'casual')).status).toBe(201)
    const up = await post('/api/ranked/ranks').send({ rank: 'ultra-3', at: ago(17) })
    expect(up.body).toMatchObject({ rank: 'ultra-3', label: 'Ultra Ball 3' })
    expect((await log(0, 'loss', 2)).status).toBe(201)
    const view = (await get('/api/ranked')).body
    expect(view.current.rank).toMatchObject({ label: 'Ultra Ball 3' })
    const summary = view.summary
    expect(summary.season.code).toBe('NOW')
    expect(summary.record).toEqual({ wins: 2, losses: 2, ties: 0 })
    expect(summary.text).toMatch(/^50\u00a0% \(n = 4, IC\u00a0.*orientativo\)$/)
    expect(summary.steps.map((step: { label: string; move: string | null }) => [step.label, step.move])).toEqual([
      ['Ultra Ball 2', null],
      ['Ultra Ball 3', 'up'],
    ])
    expect(
      summary.steps[1].decks.map((deck: { deckId: string; record: unknown }) => [deck.deckId, deck.record]),
    ).toEqual([
      [decks[0]?.id, { wins: 1, losses: 0, ties: 0 }],
      [decks[1]?.id, { wins: 1, losses: 0, ties: 0 }],
    ])
    expect(summary.byRank.map((row: { label: string; games: number }) => [row.label, row.games])).toEqual([
      ['Sin rango anotado', 1],
      ['Ultra Ball 2', 2],
      ['Ultra Ball 3', 1],
    ])
    // Another season by its code.
    expect((await get('/api/ranked?season=OLD')).body.summary).toMatchObject({ season: { code: 'OLD' }, games: 0 })
    expect((await get('/api/ranked?season=NOPE')).status).toBe(404)
    // Self-review: the code is found whatever its case.
    expect((await get('/api/ranked?season=old')).body.summary).toMatchObject({ season: { code: 'OLD' } })
    // Deleting a rank noted by mistake.
    const wrong = await post('/api/ranked/ranks').send({ rank: 'master', points: 1200 })
    expect(wrong.body.label).toBe('Master Ball, 1.200 puntos')
    expect((await del(`/api/ranked/ranks/${wrong.body.id}`)).status).toBe(204)
    expect((await get('/api/ranked')).body.current.rank.label).toBe('Ultra Ball 3')
  })

  it('18/10 (Santi): matches already registered get the rank they were played at, from one of them on', async () => {
    const ago = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    const log = async (deck: number, result: string, hours: number, mode = 'competitive') => {
      const created = await post('/api/matches').send({ deckId: decks[deck]?.id, result, mode, playedAt: ago(hours) })
      expect(created.status).toBe(201)
      return created.body.id as string
    }
    const first = await log(0, 'win', 8)
    const second = await log(1, 'loss', 7)
    await log(0, 'win', 6)
    const casual = await log(1, 'win', 5, 'casual')
    // Logged without a rank: played at the last one noted before them.
    expect((await get(`/api/ranked/matches/${first}`)).body).toMatchObject({
      matchId: first,
      competitive: true,
      season: { code: 'NOW' },
      rank: { label: 'Ultra Ball 3' },
    })
    // «Estaba en Master Ball desde esta partida»: noted just before it, for it and the ones after it.
    const noted = await post('/api/ranked/ranks').send({ rank: 'master', beforeMatch: first })
    expect(noted.status).toBe(201)
    const playedAt = (await get(`/api/matches/${first}`)).body.playedAt as string
    expect(new Date(noted.body.at).getTime()).toBe(new Date(playedAt).getTime() - 1)
    expect((await get(`/api/ranked/matches/${first}`)).body.rank).toMatchObject({ label: 'Master Ball' })
    expect((await get(`/api/ranked/matches/${second}`)).body).toMatchObject({
      rank: { label: 'Master Ball' },
      next: null,
    })
    const summary = (await get('/api/ranked')).body.summary
    expect(summary.byRank.map((row: { label: string; games: number }) => [row.label, row.games])).toEqual([
      ['Sin rango anotado', 1],
      ['Ultra Ball 2', 2],
      ['Master Ball', 4],
    ])
    // A casual match has no season nor rank, and gets none; an unknown match, or `at` with it, is refused.
    expect((await get(`/api/ranked/matches/${casual}`)).body).toEqual({
      matchId: casual,
      competitive: false,
      season: null,
      rank: null,
      next: null,
    })
    expect((await post('/api/ranked/ranks').send({ rank: 'master', beforeMatch: casual })).status).toBe(400)
    expect((await post('/api/ranked/ranks').send({ rank: 'master', beforeMatch: '999999' })).status).toBe(404)
    expect((await post('/api/ranked/ranks').send({ rank: 'master', beforeMatch: first, at: ago(1) })).status).toBe(400)
    expect((await get('/api/ranked/matches/999999')).status).toBe(404)
    expect((await del(`/api/ranked/ranks/${noted.body.id}`)).status).toBe(204)
  })

  it('refused: an unknown rank, points below Master Ball, a date ahead; and it needs a session', async () => {
    expect((await post('/api/ranked/ranks').send({ rank: 'ultra-9' })).status).toBe(400)
    expect((await post('/api/ranked/ranks').send({ rank: 'ultra-1', points: 10 })).status).toBe(400)
    const ahead = new Date(Date.now() + 2 * DAY_MS).toISOString()
    expect((await post('/api/ranked/ranks').send({ rank: 'ultra-1', at: ahead })).status).toBe(400)
    expect((await test.http().get('/api/ranked')).status).toBe(401)
    expect((await test.http().post('/api/ranked/ranks').send({ rank: 'ultra-1' })).status).toBe(401)
    expect(
      (
        await test
          .http()
          .put('/api/ranked/seasons/X')
          .send({ name: 'X', startsOn: day(40), endsOn: day(41) })
      ).status,
    ).toBe(401)
  })
})
