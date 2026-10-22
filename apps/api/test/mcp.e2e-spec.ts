import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * docs/PLAN.md §7 Fase 3 (M8 read tools) with the official MCP client against the real HTTP endpoint, the
 * 6/10/2026 collection and the 40 decks. Both protocol eras: the 2025 `initialize` handshake (what the Claude apps
 * and Claude Code speak) and 2026-07-28.
 */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

type Structured = Record<string, unknown>

describe('MCP endpoint (e2e)', () => {
  let test: TestApp
  let cookie: string
  let url: URL
  let readToken: string
  let workerToken: string
  const clients: Client[] = []

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const post = (path: string) => test.http().post(path).set('Cookie', cookie)
    const preview = await post('/api/collection/imports').attach('file', readFileSync(CSV_PATH), 'export.csv')
    expect((await post(`/api/collection/imports/${preview.body.id}/apply`)).status).toBe(200)
    const drafts = (await post('/api/decks/import').send({ text: readFileSync(DECKS_PATH, 'utf8') })).body.drafts as {
      title: string
      draft: { energies: string[]; cards: unknown[] }
    }[]
    const inputs = drafts.map((d) => ({
      name: d.title,
      // Deck 10 says «Cualquiera»: the importer leaves the choice to the user.
      energies: d.draft.energies.length > 0 ? d.draft.energies : ['psychic'],
      cards: d.draft.cards,
    }))
    expect((await post('/api/decks/import/commit').send({ decks: inputs })).status).toBe(201)
    readToken = (await post('/api/tokens').send({ name: 'claude', kind: 'mcp', scopes: ['mcp:read'] })).body.token
    workerToken = (await post('/api/tokens').send({ name: 'pc', kind: 'worker', scopes: ['worker:claim'] })).body.token
    expect(readToken).toMatch(/^tcg_mcp_/)

    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    url = new URL(`http://127.0.0.1:${port}/api/mcp`)
  })

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined)
    await test.close()
  })

  async function connect(era: 'legacy' | 'modern' = 'legacy', token = readToken): Promise<Client> {
    const client = new Client(
      { name: 'e2e', version: '1.0.0' },
      era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
    )
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    )
    clients.push(client)
    return client
  }

  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args })
    const typed = result as {
      structuredContent?: Structured
      content: { type: string; text?: string }[]
      isError?: boolean
    }
    return { ...typed, structuredContent: typed.structuredContent ?? {} }
  }

  it('requires a valid mcp token with mcp:read', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    const none = await fetch(url, { method: 'POST', headers, body })
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toMatch(/^Bearer/)
    const bad = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer tcg_mcp_nope' },
      body,
    })
    expect(bad.status).toBe(401)
    const worker = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${workerToken}` },
      body,
    })
    expect(worker.status).toBe(403)
    // The session cookie is not a way in: the endpoint is bearer-only.
    expect((await fetch(url, { method: 'POST', headers: { ...headers, Cookie: cookie }, body })).status).toBe(401)
    // No sessions and no standalone stream: GET and DELETE are 405 for an authenticated caller.
    const get = await fetch(url, { headers: { Accept: 'text/event-stream', Authorization: `Bearer ${readToken}` } })
    expect(get.status).toBe(405)
    const del = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${readToken}` } })
    expect(del.status).toBe(405)
  })

  it('serves the 2025 initialize handshake (Claude apps, Claude Code) statelessly with every read tool', async () => {
    const client = await connect('legacy')
    expect(client.getServerVersion()?.name).toBe('tcg-pocket')
    expect(client.getInstructions()).toContain('carta funcional')
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'alerts_list',
      'cards_search',
      'collection_editions',
      'collection_missions',
      'collection_pack_luck',
      'collection_playable_copies',
      'collection_summary',
      'collection_tracker_gap',
      'collection_trades',
      'decks_closest',
      'decks_consistency',
      'decks_draw_odds',
      'decks_find_by_card',
      'decks_get',
      'decks_list',
      'decks_missing',
      'decks_next_build',
      'decks_pick_today',
      'decks_random',
      'decks_validate',
      'events_check',
      'lab_build_from_core',
      'lab_meta_bank',
      'lab_results',
      'matches_list',
      'matches_luck',
      'matches_my_meta',
      'matches_rival_suggest',
      'matches_stats',
      'packs_recommend',
      'play_game_review',
      'play_games',
      'ranked_season',
      'rivals_notes',
      'simulations_analysis',
      'simulations_calibration',
      'simulations_results',
      'system_status',
      'tournaments_archetype_cards',
      'tournaments_buildable',
      'tournaments_matchups',
      'tournaments_stats',
      'tournaments_trends',
      'tournaments_unlock_cards',
      'week_summary',
      'workers_status',
    ])
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tool.description?.length).toBeGreaterThan(30)
      expect(tool.inputSchema.type).toBe('object')
    }
    const playable = tools.find((tool) => tool.name === 'collection_playable_copies')
    expect(playable?.inputSchema.required).toEqual(['query'])
  })

  it('serves 2026-07-28 clients from the same endpoint', async () => {
    const client = await connect('modern')
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(46)
    // Fase 29: the games against the bot (none here) and the review of one.
    expect((await call(client, 'play_games')).structuredContent).toEqual({ games: [] })
    // 14/10: the rival by the cards seen (no tournaments here: nothing suggested, nothing to classify).
    const rival = (await call(client, 'matches_rival_suggest', { cards: ['2 Greninja'] })).structuredContent as {
      suggestions: unknown[]
      note?: string
    }
    expect(rival.suggestions).toEqual([])
    expect(rival.note).toMatch(/^Ninguna lista/)
    expect((await call(client, 'matches_rival_suggest')).structuredContent).toMatchObject({
      toClassify: [],
      ownRivals: [],
    })
    // Fase 38: the server's own state, with the alerts in force.
    const system = (await call(client, 'system_status')).structuredContent as {
      version: string
      memory: { heapLimitMb: number }
      alerts: unknown[]
    }
    expect(system.version).toBeTruthy()
    expect(system.memory.heapLimitMb).toBeGreaterThan(0)
    expect(Array.isArray(system.alerts)).toBe(true)
    const missing = await client.callTool({ name: 'play_game_review', arguments: { id: 999 } })
    expect(missing.isError).toBe(true)
    const summary = await call(client, 'collection_summary')
    expect(summary.structuredContent).toMatchObject({
      copies: 4714,
      functionalCardsWithAtLeastOne: 1853,
      functionalCardsWithAtLeastTwo: 1255,
    })
  })

  it('lista de intercambio (Fase 31): the 40 decks lack nothing; spares by rarity and the text to paste', async () => {
    const client = await connect()
    const trades = (await call(client, 'collection_trades', { rarities: ['✵', '✵✵'], limit: 1 })).structuredContent as {
      rarities: string[]
      totals: { wants: number; gives: number; spare: number }
      byRarity: { rarity: string; gives: unknown[]; moreGives: number }[]
      text: string
    }
    expect(trades.rarities).toEqual(['✵', '✵✵'])
    expect(trades.totals).toEqual({ wants: 0, gives: 758, spare: 1548 })
    expect(trades.byRarity.map((row) => [row.rarity, row.gives.length])).toEqual([
      ['✵', 1],
      ['✵✵', 1],
    ])
    expect(trades.text.split('\n').slice(0, 4)).toEqual([
      'Intercambio en TCG Pocket (misma rareza)',
      '',
      'Busco:',
      '· nada por ahora',
    ])
    // The same over HTTP; without rarities and nothing to ask for, ◊◊◊ and up.
    const http = (await test.http().get('/api/trades').set('Cookie', cookie)).body
    expect(http.rarities).toEqual(['◊◊◊', '◊◊◊◊', '☆', '☆☆', '✵', '✵✵'])
    expect((await test.http().get('/api/trades?rarities=nope').set('Cookie', cookie)).status).toBe(400)
  })

  it('BRIEF M8 acceptance: Hoopa ex has 1 playable copy (B4-103) and decks 13 and 19 use it', async () => {
    const client = await connect()
    const copies = await call(client, 'collection_playable_copies', { query: 'Hoopa ex' })
    expect(copies.isError).toBeFalsy()
    const card = (copies.structuredContent.cards as Structured[])[0] as Structured
    expect(copies.structuredContent.exactMatch).toBe(true)
    expect(card).toMatchObject({ nameEs: 'Hoopa ex', playableCopies: 1, adjustment: null })
    // B4b-149 is the Deluxe reprint that shares the tracker row with B4-103: one copy, not two.
    expect(card.ownedEditions).toEqual([{ cardIds: ['B4-103', 'B4b-149'], rarity: '◊◊◊◊', owned: 1 }])
    // Imported like the PWA does (name without the number): ids 1–40 follow the file, so «mazo 13» is id 13.
    const used = card.decksUsingIt as { id: string; name: string }[]
    expect(used.map((deck) => [deck.id, deck.name])).toEqual([
      ['13', 'Hoopa ex / Mega-Absol ex'],
      ['19', 'Hydreigon'],
    ])
    const names = used.map((deck) => deck.name)

    const byCard = await call(client, 'decks_find_by_card', { query: 'hoopa EX' })
    const decks = ((byCard.structuredContent.cards as Structured[])[0] as Structured).decks as { name: string }[]
    expect(decks.map((deck) => deck.name)).toEqual(names)
    // The text content carries the same JSON for clients that ignore structuredContent.
    expect(JSON.parse(byCard.content[0]?.text ?? '{}')).toEqual(byCard.structuredContent)
  })

  it('resolves names in both languages, ids, and cards with the same name and different text', async () => {
    const client = await connect()
    const copycat = await call(client, 'cards_search', { q: 'Copycat' })
    const ids = (copycat.structuredContent.results as { cardId: string; nameEs: string }[]).map((hit) => hit.cardId)
    expect(ids).toEqual(expect.arrayContaining(['B1-225', 'B1-270', 'B4b-225', 'B4b-391', 'B4b-424']))
    const copiona = await call(client, 'cards_search', { q: 'Copiona', limit: 5 })
    expect((copiona.structuredContent.results as { nameEs: string }[])[0]?.nameEs).toBe('Copiona')

    const riolu = await call(client, 'collection_playable_copies', { query: 'Riolu' })
    const groups = riolu.structuredContent.cards as { functionalGroupId: string; playableCopies: number }[]
    // Three Riolu with different text in the catalog; the plan's two (A2-91 = 1, B3-79 = 9) are among them.
    expect(groups.map((group) => [group.functionalGroupId, group.playableCopies])).toEqual([
      ['A2-91', 1],
      ['A2b-42', 8],
      ['B3-79', 9],
    ])
    const bulbasaur = await call(client, 'collection_editions', { query: 'a4b-1' })
    const editions = ((bulbasaur.structuredContent.cards as Structured[])[0] as Structured).editions as {
      cardId: string
      sharesRowWith?: string[]
    }[]
    expect(editions.find((edition) => edition.cardId === 'A1-1')?.sharesRowWith).toEqual(['A4b-1'])

    const unknown = await call(client, 'collection_playable_copies', { query: 'Pikachu Galáctico Supremo' })
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0]?.text).toContain('No encontré ninguna carta')
  })

  it('lists and shows decks by their number, and says what a deck is missing with the cheapest edition', async () => {
    const client = await connect()
    const list = await call(client, 'decks_list')
    expect(list.structuredContent.count).toBe(40)
    const all = list.structuredContent.decks as { valid: boolean; complete: boolean }[]
    expect(all.every((deck) => deck.valid && deck.complete)).toBe(true)

    const deck13 = await call(client, 'decks_get', { deck: '13' })
    expect(deck13.structuredContent).toMatchObject({
      id: '13',
      name: 'Hoopa ex / Mega-Absol ex',
      cardCount: 20,
      valid: true,
    })
    // Fase 43: compact by default (each card once, no export text); «full» adds the text.
    expect(deck13.structuredContent.text).toBeUndefined()
    expect(deck13.structuredContent.cards).toContainEqual(expect.stringMatching(/^1 Hoopa ex \(B4-103\)$/))
    const full13 = await call(client, 'decks_get', { deck: '13', detail: 'full' })
    expect(full13.structuredContent.text).toContain('Hoopa ex (B4-103)')
    expect(JSON.stringify(deck13.structuredContent).length).toBeLessThan(
      JSON.stringify(full13.structuredContent).length,
    )
    expect((await call(client, 'decks_get', { deck: 'mazo 1' })).structuredContent.name).toBe(
      'Butterfree / Mega-Sceptile ex',
    )
    expect((await call(client, 'decks_get', { deck: 'hydreigon' })).structuredContent.id).toBe('19')
    const ambiguous = await call(client, 'decks_get', { deck: 'Mega' })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.content[0]?.text).toContain('varios mazos')

    // A second Hoopa ex (the note of deck 13 says it is missing): one copy short, cheapest edition 500 points.
    const detail = full13.structuredContent.cards as { cardId: string; count: number }[]
    const cards = detail.map((entry) => ({ cardId: entry.cardId, count: entry.cardId === 'B4-103' ? 2 : entry.count }))
    const darkrai = cards.findIndex((entry) => entry.cardId === 'A2-110')
    cards.splice(darkrai, 1)
    const created = await test
      .http()
      .post('/api/decks')
      .set('Cookie', cookie)
      .send({ name: '41. Hoopa x2', energies: ['darkness'], cards })
    expect(created.status).toBe(201)
    const missing = await call(client, 'decks_missing', { deck: '41' })
    expect(missing.structuredContent).toMatchObject({ complete: false, totalPackPoints: 500 })
    expect(missing.structuredContent.missing).toEqual([
      expect.objectContaining({
        nameEs: 'Hoopa ex',
        need: 2,
        have: 1,
        missingCopies: 1,
        cheapestEdition: { cardId: 'B4-103', rarity: '◊◊◊◊', points: 500, pointsVerified: false, tradeable: true },
      }),
    ])
  })

  it('validates a pasted Limitless list without saving it', async () => {
    const client = await connect()
    const decks = (await test.http().get('/api/decks').set('Cookie', cookie)).body.items as {
      id: string
      name: string
    }[]
    const deck6 = decks.find((deck) => deck.id === '6')
    expect(deck6?.name).toBe('Mega-Lucario ex / Lucario')
    const exported = await test.http().get(`/api/decks/${deck6?.id}/export?format=limitless`).set('Cookie', cookie)
    const valid = await call(client, 'decks_validate', { text: exported.text })
    const first = (valid.structuredContent.decks as Structured[])[0] as Structured
    expect(first).toMatchObject({ parsed: true, valid: true, complete: true, errors: [] })
    expect((first.cards as { nameEs: string | null }[]).every((card) => card.nameEs !== null)).toBe(true)

    // Without one of its two Riolu the list has 19 cards: a concrete Spanish message, nothing saved.
    const broken = exported.text.replace(/^1 Riolu A2 91\r?\n/m, '')
    expect(broken).not.toBe(exported.text)
    const invalid = await call(client, 'decks_validate', { text: broken })
    const result = (invalid.structuredContent.decks as Structured[])[0] as Structured
    expect(result.valid).toBe(false)
    expect((result.errors as string[]).join(' ')).toMatch(/19 cartas/)
    expect((await test.http().get('/api/decks').set('Cookie', cookie)).body.items).toHaveLength(41)

    const nothing = await call(client, 'decks_validate', {})
    expect(nothing.isError).toBe(true)
  })

  it('reports own match statistics with the canonical text, and the modules that are not there yet', async () => {
    const client = await connect()
    const decks = (await test.http().get('/api/decks').set('Cookie', cookie)).body.items as {
      id: string
      name: string
    }[]
    const deck2 = decks.find((deck) => deck.id === '2')
    for (let i = 0; i < 10; i += 1) {
      const logged = await test
        .http()
        .post('/api/matches')
        .set('Cookie', cookie)
        .send({ deckId: deck2?.id, result: i < 7 ? 'win' : 'loss', opponent: 'Gardevoir ex' })
      expect(logged.status).toBe(201)
    }
    const stats = await call(client, 'matches_stats', { deck: '2' })
    expect(stats.structuredContent.overall).toMatchObject({
      record: { wins: 7, losses: 3, ties: 0 },
      rate: {
        text: '70\u00a0% (n = 10, IC\u00a039,7–89,2\u00a0%, orientativo)',
        value: 70,
        games: 10,
        source: 'matches',
      },
    })
    expect(stats.structuredContent.source).toContain('no incluye torneos')
    const recent = await call(client, 'matches_list', { limit: 3 })
    expect(recent.structuredContent.total).toBe(10)
    expect((recent.structuredContent.matches as Structured[])[0]).toMatchObject({
      deck: 'Mega-Blaziken ex',
      opponent: 'Gardevoir ex',
    })
    const list = await call(client, 'decks_list')
    const withMatches = (list.structuredContent.decks as { name: string; myMatches: Structured | null }[]).find(
      (deck) => deck.name === 'Mega-Blaziken ex',
    )
    expect(withMatches?.myMatches).toMatchObject({ record: { wins: 7, losses: 3, ties: 0 } })

    // Tournament tools answer with the era even before the first sync (no lists yet); simulations with no job yet.
    const noTournaments = await call(client, 'tournaments_stats')
    expect(noTournaments.isError).toBeFalsy()
    expect(noTournaments.structuredContent.scope).toMatchObject({ lists: 0, tournaments: 0 })
    const noSimulations = await call(client, 'simulations_results', { deck: '13' })
    expect(noSimulations.isError).toBeFalsy()
    expect(noSimulations.structuredContent.jobs).toEqual([])
    expect(noSimulations.structuredContent.simulation).toMatchObject({ record: null, rate: null })
    const missingJob = await call(client, 'simulations_results', { job: 999 })
    expect(missingJob.isError).toBe(true)
  })

  it('recommends packs (Fase 4): deck 13 with priority and a missing Hoopa ex points to the Deluxe Mega', async () => {
    const client = await connect()
    const noGoals = await call(client, 'packs_recommend', { collection: null })
    expect((noGoals.structuredContent.goals as Structured).note).toContain('prioridad de sobres')

    const detail = (await test.http().get('/api/decks/13').set('Cookie', cookie)).body as {
      cards: { card: { id: string }; count: number }[]
    }
    const cards = detail.cards
      .filter((entry) => entry.card.id !== 'A2-110')
      .map((entry) => ({ cardId: entry.card.id, count: entry.card.id === 'B4-103' ? 2 : entry.count }))
    const patched = await test.http().patch('/api/decks/13').set('Cookie', cookie).send({ cards, packPriority: 3 })
    expect(patched.status).toBe(200)

    // The Deluxe Mega is limited: a last day far away keeps this test independent of the clock.
    await test.prisma.pack.update({
      where: { id: 'B4b/deluxepackmega' },
      data: { limitedUntil: new Date('2099-12-31T00:00:00Z') },
    })
    const result = await call(client, 'packs_recommend', { collection: null, limit: 3 })
    expect(result.isError).toBeFalsy()
    const packs = result.structuredContent.packs as Structured[]
    expect(packs).toHaveLength(3)
    expect(packs[0]).toMatchObject({ probability: '1,43 %', packsFor50: 49, packsFor90: 161 })
    expect(String(packs[0]?.pack)).toContain('(B4b)')
    expect(String(packs[0]?.otherModel)).toContain('tracker: 0 %')
    expect(String(packs[0]?.limited)).toContain('tiempo limitado hasta el 31/12/2099')
    // For the decks every B4b card is a reprint: nothing only it gives.
    expect(packs[0]?.onlyHere).toMatchObject({ decks: [], collectionVersions: 0 })
    expect(result.structuredContent.missingCards).toEqual([
      expect.objectContaining({
        nameEs: 'Hoopa ex',
        cheapest: 'B4-103 ◊◊◊◊: 500 puntos (sin verificar), intercambiable',
        tradeable: true,
        afterLimited: expect.stringContaining('cuando termine: '),
        advice: 'conviene abrir sobres',
      }),
    ])
    expect(String((result.structuredContent.missingCards as Structured[])[0]?.bestPack)).toContain('(tiempo limitado)')
    expect(result.structuredContent.limitedBoost).toBe(3)
    const completion = (result.structuredContent.deckCompletion as Structured[])[0]
    expect(String((completion?.bestPacks as string[] | undefined)?.[0])).toMatch(
      /cubre 1 de 1 copias en ~5\d sobres \(simulación\)/,
    )

    // With the collection goal the B4b versions no other pack gives weigh more; some can only be traded.
    const collection = await call(client, 'packs_recommend', { alpha: 0, limit: 29, onlyAvailable: false })
    const b4b = (collection.structuredContent.packs as Structured[]).find((pack) => String(pack.pack).includes('(B4b)'))
    expect((b4b?.onlyHere as Structured | undefined)?.collectionVersions).toBeGreaterThan(0)
    expect(String(collection.structuredContent.collectionOutOfPacks)).toMatch(/^\d+ versiones buscadas/)
    await test.prisma.pack.update({
      where: { id: 'B4b/deluxepackmega' },
      data: { limitedUntil: new Date('2026-10-28T00:00:00Z') },
    })
  })

  it('finds the closest saved deck to a pasted list, picks a random deck and recommends the best prints', async () => {
    const client = await connect()
    const exported = await test.http().get('/api/decks/6/export?format=limitless').set('Cookie', cookie)
    const text = exported.text.replace(/^1 Riolu A2 91\r?\n/m, '')
    expect(text).not.toBe(exported.text)
    const builtOnly = await call(client, 'decks_closest', { text })
    expect(builtOnly.structuredContent.note).toContain('armado en el juego')
    const closest = await call(client, 'decks_closest', { text, scope: 'all', limit: 2 })
    const best = (closest.structuredContent.closest as Structured[])[0] as Structured
    expect(best).toMatchObject({ deckId: '6', swaps: 1, keep: 19, add: [], energy: 'sin cambios' })
    expect(best.remove).toEqual(['1× Riolu (A2-91)'])
    const byDeck = await call(client, 'decks_closest', { deck: '13', scope: 'all', limit: 1 })
    expect((byDeck.structuredContent.closest as Structured[])[0]?.deckId).not.toBe('13')

    const random = await call(client, 'decks_random', { leastPlayed: true })
    expect(random.isError).toBeFalsy()
    expect(random.structuredContent.myMatches).toBe(0)
    expect(String((random.structuredContent.deck as Structured).id)).not.toBe('2')

    const draws = await call(client, 'decks_draw_odds', { deck: '2', alsoCards: ['Investigación de Profesores'] })
    expect(draws.isError, JSON.stringify(draws.content)).toBeFalsy()
    const byTurn = draws.structuredContent.byTurn as Structured[]
    expect(byTurn[0]).toMatchObject({ turn: 'mano inicial', cardsSeen: 5, both: expect.stringMatching(/ %$/) })
    expect(byTurn).toHaveLength(7)

    const deck1 = await call(client, 'decks_get', { deck: '1', detail: 'full' })
    const changes = (deck1.structuredContent.bestVersions as { changes: Structured[] }).changes
    expect(changes).toContainEqual({ nameEs: 'Copiona', listed: ['1× B1-225'], use: ['1× B4b-391 ◊◊ holográfica'] })
    const compact1 = await call(client, 'decks_get', { deck: '1' })
    expect(compact1.structuredContent.bestVersions).toContain('Copiona: 1× B4b-391 ◊◊ holo')
  })

  it('a revoked token stops working at once', async () => {
    const created = await test
      .http()
      .post('/api/tokens')
      .set('Cookie', cookie)
      .send({ name: 'temporal', kind: 'mcp', scopes: ['mcp:read'] })
    const client = await connect('legacy', created.body.token)
    expect((await client.listTools()).tools.length).toBe(46)
    expect((await test.http().delete(`/api/tokens/${created.body.id}`).set('Cookie', cookie)).status).toBe(204)
    await expect(client.listTools()).rejects.toThrow()
  })
})
