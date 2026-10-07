import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { DecksService } from '../src/decks/decks.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Pedidos del 7/10/2026 against the real collection and the 40 decks: the closest saved deck to a new list, a random
 * deck, and the best owned print of every card.
 */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

interface Distance {
  deckId: string
  name: string
  swaps: number
  keep: number
  toAdd: { nameEs: string; count: number; cardIds: string[] }[]
  toRemove: { nameEs: string; count: number; cardIds: string[] }[]
  energies: { change: boolean }
}

describe('deck assistance (e2e)', () => {
  let test: TestApp
  let cookie: string

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
  })

  afterAll(async () => {
    await test.close()
  })

  function get(path: string) {
    return test.http().get(path).set('Cookie', cookie)
  }
  function post(path: string) {
    return test.http().post(path).set('Cookie', cookie)
  }
  function patch(path: string) {
    return test.http().patch(path).set('Cookie', cookie)
  }

  it('closest: with nothing marked as built it says so; then the built deck needing fewest swaps wins', async () => {
    const none = await post('/api/decks/closest').send({ deckId: '13' })
    expect(none.status).toBe(200)
    expect(none.body).toMatchObject({ scope: 'built', candidates: 0, builtInGameDecks: 0, results: [] })

    // Built in the game: decks 19 (shares Hoopa ex and Mega-Absol ex with 13), 2 and 6.
    for (const id of ['19', '2', '6']) {
      expect((await patch(`/api/decks/${id}`).send({ builtInGame: true })).status).toBe(200)
    }
    const built = await post('/api/decks/closest').send({ deckId: '13' })
    expect(built.body).toMatchObject({
      target: { deckId: '13', name: 'Hoopa ex / Mega-Absol ex', cardCount: 20 },
      scope: 'built',
      candidates: 3,
      builtInGameDecks: 3,
    })
    const results = built.body.results as Distance[]
    expect(results).toHaveLength(3)
    expect(results[0]?.deckId).toBe('19')
    for (const result of results) {
      const added = result.toAdd.reduce((sum, change) => sum + change.count, 0)
      expect(result.keep + added).toBe(20)
      expect(result.swaps).toBe(added)
    }
    expect(results[0]?.toRemove.some((change) => change.nameEs === 'Hydreigon')).toBe(true)
    expect(results[0]?.toAdd.some((change) => change.nameEs === 'Darkrai ex')).toBe(true)

    // Every saved deck as candidate: the target itself is excluded.
    const all = await post('/api/decks/closest').send({ deckId: '13', scope: 'all', limit: 10 })
    expect(all.body.candidates).toBe(39)
    expect(all.body.results).toHaveLength(10)
    expect((all.body.results as Distance[]).some((result) => result.deckId === '13')).toBe(false)
  })

  it('closest: a pasted list one card away from a built deck finds it with exactly that swap', async () => {
    const exported = await get('/api/decks/6/export?format=limitless')
    const text = exported.text.replace(/^1 Riolu A2 91\r?\n/m, '')
    expect(text).not.toBe(exported.text)
    // A 19-card list: closeness does not validate, it only counts swaps.
    const result = await post('/api/decks/closest').send({ text })
    expect(result.status).toBe(200)
    const best = (result.body.results as Distance[])[0]
    expect(best).toMatchObject({ deckId: '6', swaps: 1, keep: 19 })
    expect(best?.toRemove).toEqual([expect.objectContaining({ nameEs: 'Riolu', count: 1, cardIds: ['A2-91'] })])
    expect(best?.energies.change).toBe(false)

    expect((await post('/api/decks/closest').send({})).status).toBe(400)
    const garbage = await post('/api/decks/closest').send({ text: '2 Cartaquenoexiste X9 999' })
    expect(garbage.status).toBe(400)
    expect(garbage.body.error.code).toBe('invalid_deck_text')
    expect((await post('/api/decks/closest').send({ deckId: '999999' })).status).toBe(404)
  })

  it('random: picks an active deck with the filters, preferring the least played when asked', async () => {
    const any = await get('/api/decks/random')
    expect(any.status).toBe(200)
    expect(any.body).toMatchObject({ games: 0, candidates: 40 })
    expect(typeof any.body.deck.id).toBe('string')

    const builtOnly = await get('/api/decks/random?builtInGame=true')
    expect(['19', '2', '6']).toContain(builtOnly.body.deck.id)
    expect(builtOnly.body.candidates).toBe(3)

    // Deck 2 and 6 played once: «least played» among the built ones leaves only 19.
    for (const deckId of ['2', '6']) {
      expect((await post('/api/matches').send({ deckId, result: 'win' })).status).toBe(201)
    }
    const least = await get('/api/decks/random?builtInGame=true&leastPlayed=true')
    expect(least.body).toMatchObject({ deck: { id: '19' }, games: 0, candidates: 1 })
    // «Otro»: the previous pick is left out first, then the least played of the rest.
    const again = await get('/api/decks/random?builtInGame=true&leastPlayed=true&exclude=19')
    expect(['2', '6']).toContain(again.body.deck.id)
    expect(again.body.candidates).toBe(2)

    // A fixed source makes the choice deterministic.
    const service = test.app.get(DecksService)
    const first = await service.random({ builtInGame: true }, () => 0)
    const last = await service.random({ builtInGame: true }, () => 0.999)
    expect([first.deck.id, last.deck.id]).toEqual(['2', '19'])

    const none = await get('/api/decks/random?tag=inexistente')
    expect(none.status).toBe(404)
    expect(none.body.error.code).toBe('no_decks')
  })

  it('best versions: the detail recommends owned prints of the same card and they can be applied', async () => {
    const deck = await get('/api/decks/1')
    const best = deck.body.bestVersions as {
      changed: boolean
      groups: { nameEs: string; current: { cardId: string }[]; recommended: { cardId: string; holo: boolean }[] }[]
      cards: { cardId: string; count: number }[]
    }
    expect(best.changed).toBe(true)
    const copiona = best.groups.find((group) => group.nameEs === 'Copiona')
    expect(copiona?.current).toEqual([{ cardId: 'B1-225', count: 1 }])
    expect(copiona?.recommended).toEqual([{ cardId: 'B4b-391', nameEs: 'Copiona', rarity: '◊◊', holo: true, count: 1 }])
    expect(best.cards.reduce((sum, entry) => sum + entry.count, 0)).toBe(20)

    const applied = await patch('/api/decks/1').send({ cards: best.cards, note: 'Mejores versiones' })
    expect(applied.status).toBe(200)
    expect(applied.body).toMatchObject({ revisionNumber: 2, valid: true, complete: true })
    expect(applied.body.bestVersions).toMatchObject({ changed: false, groups: [] })
    const prints = (applied.body.cards as { card: { id: string } }[]).map((entry) => entry.card.id)
    expect(prints).toContain('B4b-391')
    expect(prints).not.toContain('B1-225')
  })
})
