import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * docs/PLAN.md §7 Fase 7 (M8 write tools) with the official MCP client against the real HTTP endpoint, the
 * 6/10/2026 collection and the 40 decks: the three acceptance phrases (log a match, create a deck from Spanish text
 * and get its validation, queue a simulation with a chosen seed), plus editing and the read-only token.
 */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

type Structured = Record<string, unknown>

const WRITE_TOOLS = [
  'chat_read',
  'chat_write',
  'collection_set',
  'decks_create',
  'decks_update',
  'lab_explore',
  'lab_test',
  'matches_delete',
  'matches_log',
  'matches_restore',
  'matches_update',
  'rivals_note_set',
  'simulations_cancel',
  'simulations_enqueue',
  'simulations_retry_failed',
]
const DESTRUCTIVE = new Set(['matches_delete', 'simulations_cancel'])

describe('MCP write tools (e2e)', () => {
  let test: TestApp
  let cookie: string
  let url: URL
  let readToken: string
  let writeToken: string
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
      energies: d.draft.energies.length > 0 ? d.draft.energies : ['psychic'],
      cards: d.draft.cards,
    }))
    expect((await post('/api/decks/import/commit').send({ decks: inputs })).status).toBe(201)
    readToken = (await post('/api/tokens').send({ name: 'lectura', kind: 'mcp', scopes: ['mcp:read'] })).body.token
    writeToken = (await post('/api/tokens').send({ name: 'claude', kind: 'mcp', scopes: ['mcp:read', 'mcp:write'] }))
      .body.token
    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    url = new URL(`http://127.0.0.1:${port}/api/mcp`)
  })

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined)
    await test.close()
  })

  function get(path: string) {
    return test.http().get(path).set('Cookie', cookie)
  }

  async function connect(token = writeToken, userAgent = 'Claude-User/1.0'): Promise<Client> {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent } },
      }),
    )
    clients.push(client)
    return client
  }

  async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as {
      structuredContent?: Structured
      content: { type: string; text?: string }[]
      isError?: boolean
    }
    return { ...result, structuredContent: result.structuredContent ?? {} }
  }

  it('a read-only token does not see the write tools; a write token sees them, marked as writes', async () => {
    const reader = await connect(readToken)
    const readNames = (await reader.listTools()).tools.map((tool) => tool.name)
    for (const name of WRITE_TOOLS) expect(readNames).not.toContain(name)
    expect(reader.getInstructions()).not.toContain('permiso de escritura')

    const writer = await connect()
    const tools = (await writer.listTools()).tools
    expect(tools).toHaveLength(readNames.length + WRITE_TOOLS.length)
    for (const name of WRITE_TOOLS) {
      const tool = tools.find((item) => item.name === name)
      expect(tool?.annotations?.readOnlyHint).toBe(false)
      expect(tool?.annotations?.destructiveHint).toBe(DESTRUCTIVE.has(name))
    }
    expect(writer.getInstructions()).toContain('permiso de escritura')
  })

  it('acceptance 1: «registrá una victoria con el mazo 7 contra Mega-Blaziken, empecé yo»; fix it; delete it', async () => {
    const client = await connect()
    const logged = await call(client, 'matches_log', {
      deck: 'mazo 7',
      result: 'win',
      opponent: 'Mega-Blaziken',
      wentFirst: true,
    })
    expect(logged.isError, logged.content[0]?.text).toBeFalsy()
    const match = logged.structuredContent.match as Structured
    expect(match).toMatchObject({ result: 'Victoria', opponent: 'Mega-Blaziken', wentFirst: 'empecé yo' })
    expect(String(match.deck)).toContain('Zoroark ex')
    expect(logged.structuredContent.deckRecord).toMatchObject({ record: { wins: 1, losses: 0, ties: 0 } })

    // The match is in the app, tagged as logged by Claude.
    const list = (await get('/api/matches')).body as { items: { id: string; source: string; deck: { id: string } }[] }
    expect(list.items[0]).toMatchObject({ id: match.id, source: 'mcp', deck: { id: '7' } })

    // A note about the rival: appended by default.
    const note = await call(client, 'rivals_note_set', {
      opponent: 'Mega-Blaziken',
      text: 'Le cuesta el primer turno.',
    })
    expect(note.structuredContent).toMatchObject({
      saved: true,
      rival: 'Mega-Blaziken',
      text: 'Le cuesta el primer turno.',
    })
    const again = await call(client, 'rivals_note_set', { opponent: 'mega blaziken', text: 'Y el segundo.' })
    expect(again.structuredContent.text).toBe('Le cuesta el primer turno.\n\nY el segundo.')
    const read = await call(client, 'rivals_notes', { opponent: 'Mega Blaziken' })
    expect((read.structuredContent.note as Structured).text).toContain('Y el segundo.')

    const fixed = await call(client, 'matches_update', { id: match.id, result: 'loss', wentFirst: false })
    expect(fixed.structuredContent).toMatchObject({
      before: { result: 'Victoria' },
      match: { result: 'Derrota', wentFirst: 'empezó el rival' },
    })
    const deleted = await call(client, 'matches_delete', { id: match.id })
    expect(deleted.structuredContent).toMatchObject({ deleted: true, match: { id: match.id } })
    expect((await get(`/api/matches/${match.id}`)).status).toBe(404)

    // Fase 43: «no, esa no era» — the deleted match comes back with its id, deck and source; only once.
    const restored = await call(client, 'matches_restore', { id: match.id })
    expect(restored.isError, restored.content[0]?.text).toBeFalsy()
    expect(restored.structuredContent).toMatchObject({ restored: true, match: { id: match.id, result: 'Derrota' } })
    expect((await get(`/api/matches/${match.id}`)).body).toMatchObject({ id: match.id, source: 'mcp' })
    expect((await call(client, 'matches_restore', { id: match.id })).isError).toBe(true)
    // Deleted again, and undone from the app this time (Más → Tokens de API).
    expect((await call(client, 'matches_delete', { id: match.id })).isError).toBeFalsy()
    const audit = (await get('/api/mcp-audit')).body.items as {
      id: string
      tool: string
      title: string
      token: { name: string }
      client: string
      ok: boolean
      args: Structured
      undo: { kind: string; label: string } | null
    }[]
    expect(audit[0]).toMatchObject({
      tool: 'matches_delete',
      title: 'Borrar una partida',
      token: { name: 'claude' },
      client: 'Claude-User',
      ok: true,
      args: { id: match.id },
      undo: { kind: 'match_delete', label: expect.stringContaining('Derrota con') },
    })
    expect(audit.map((row) => row.tool)).toEqual(
      expect.arrayContaining(['matches_log', 'rivals_note_set', 'matches_update', 'matches_restore']),
    )
    const undone = await test.http().post(`/api/mcp-audit/${audit[0]?.id}/undo`).set('Cookie', cookie)
    expect(undone.status).toBe(200)
    expect(undone.body).toMatchObject({ undo: null, undoneAt: expect.any(String) })
    expect((await get(`/api/matches/${match.id}`)).status).toBe(200)
    expect((await test.http().post(`/api/mcp-audit/${audit[0]?.id}/undo`).set('Cookie', cookie)).status).toBe(409)
    const unknown = await call(client, 'matches_log', { deck: 'mazo 999', result: 'win' })
    expect(unknown.isError).toBe(true)
  })

  it('acceptance 2: a deck from Spanish text is saved with its validation; an invalid one is not', async () => {
    const client = await connect()
    const text = [
      '### Zoroark de Claude',
      '- Pokémon: 2 Zorua (B3-105), 2 Zoroark ex (B3-106), 1 Darkrai ex (A2-110), 1 Mega-Absol ex (B1-151), 1 Bombirdier (B3-115)',
      '- Entrenadores: 2 Investigación de Profesores, 2 Copiona, 2 Poké Ball, 2 Aguja Granuja, 1 Chica del Centro Pokémon, 1 Helio, 1 Sabrina, 1 Capa Gigante, 1 Helado Suerte',
    ].join('\n')
    const created = await call(client, 'decks_create', { text, energies: ['darkness'] })
    expect(created.isError, created.content[0]?.text).toBeFalsy()
    expect(created.structuredContent.saved).toBe(true)
    const deck = created.structuredContent.deck as Structured
    expect(deck).toMatchObject({ name: 'Zoroark de Claude', valid: true, cardCount: 20, energies: ['darkness'] })
    expect(deck.complete).toBe(true)
    const detail = (await get(`/api/decks/${deck.id}`)).body as { revisions: { source: string }[] }
    expect(detail.revisions[0]?.source).toBe('mcp')

    // 19 cards: not saved, with the reason.
    const short = text.replace('1 Helado Suerte', '').replace(', 1 Capa Gigante, ', ', 1 Capa Gigante')
    const refused = await call(client, 'decks_create', { text: short, energies: ['darkness'] })
    expect(refused.structuredContent.saved).toBe(false)
    expect((refused.structuredContent.errors as string[]).join(' ')).toMatch(/19|20/)
    const decks = (await get('/api/decks')).body.items as { name: string }[]
    expect(decks.filter((item) => item.name === 'Zoroark de Claude')).toHaveLength(1)

    // Editing: new cards make a revision tagged mcp; priority and notes too.
    const swapped = text.replace('1 Bombirdier (B3-115)', '1 Absol (B1-150)')
    const updated = await call(client, 'decks_update', {
      deck: String(deck.id),
      text: swapped,
      revisionNote: 'Absol en lugar de Bombirdier',
      packPriority: 2,
      notes: 'Probado por Claude',
    })
    expect(updated.isError, updated.content[0]?.text).toBeFalsy()
    expect(updated.structuredContent.deck).toMatchObject({ revision: 2, packPriority: 2, valid: true })
    const after = (await get(`/api/decks/${deck.id}`)).body as {
      revisions: { number: number; source: string; note: string }[]
      notes: string
    }
    expect(after.revisions.at(-1)).toMatchObject({ number: 2, source: 'mcp', note: 'Absol en lugar de Bombirdier' })
    expect(after.notes).toBe('Probado por Claude')
    const invalid = await call(client, 'decks_update', { deck: String(deck.id), text: short })
    expect(invalid.structuredContent.saved).toBe(false)
    expect(((await get(`/api/decks/${deck.id}`)).body as { revisionNumber: number }).revisionNumber).toBe(2)
  })

  it('acceptance 3: a simulation queued with a chosen seed; optimize; what cannot be simulated is said first', async () => {
    const client = await connect()
    const queued = await call(client, 'simulations_enqueue', {
      kind: 'compare',
      decksA: ['7'],
      decksB: ['2', '13'],
      games: 50,
      seed: 20261008,
      bots: ['e2', 'e3'],
      label: 'Zoroark contra Blaziken y Hoopa',
    })
    expect(queued.isError, queued.content[0]?.text).toBeFalsy()
    expect(queued.structuredContent).toMatchObject({
      queued: true,
      seed: '20261008',
      pairings: 2,
      totalGames: 100,
      gamesPerPairing: 50,
      workerOnline: false,
    })
    const job = (await get(`/api/simulations/${queued.structuredContent.jobId}`)).body as {
      baseSeed: string
      players: string[]
      label: string
    }
    expect(job).toMatchObject({ baseSeed: '20261008', players: ['e2', 'e3'], label: 'Zoroark contra Blaziken y Hoopa' })

    const optimize = await call(client, 'simulations_enqueue', {
      kind: 'optimize',
      decksA: ['7'],
      decksB: ['2'],
      games: 10,
      remove: [{ card: 'Bombirdier', count: 1 }],
      candidates: ['Helio', 'A1-225'],
    })
    expect(optimize.isError, optimize.content[0]?.text).toBeFalsy()
    expect(optimize.structuredContent).toMatchObject({ queued: true, kind: 'optimize', pairings: 1 })

    // A NOEX-style list without energy is «no simulable»: nothing is queued and the reason is given.
    const bare = await call(client, 'simulations_enqueue', { kind: 'compare', decksA: ['7'] })
    expect(bare.isError).toBe(true)
    const ambiguous = await call(client, 'simulations_enqueue', {
      kind: 'optimize',
      decksA: ['7'],
      decksB: ['2'],
      remove: [{ card: 'Bombirdier', count: 1 }],
      candidates: ['Riolu'],
    })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.content[0]?.text).toMatch(/varias cartas/)
  })

  it('Fase 43: dryRun says the plan without queueing; a long job needs confirmLong; a job can be cancelled', async () => {
    const client = await connect()
    const before = ((await get('/api/simulations')).body as { items: unknown[] }).items.length
    const plan = await call(client, 'simulations_enqueue', {
      kind: 'compare',
      decksA: ['7'],
      decksB: ['2', '13'],
      games: 50,
      dryRun: true,
    })
    expect(plan.structuredContent).toMatchObject({
      queued: false,
      dryRun: true,
      plan: { pairings: 2, totalGames: 100, workerOnline: false },
    })
    // H-011.5: an optimize's plan counts the confirmation it queues when it ends (2 combinations × 1 rival × 10, then
    // both × 200).
    const optimizePlan = await call(client, 'simulations_enqueue', {
      kind: 'optimize',
      decksA: ['7'],
      decksB: ['2'],
      games: 10,
      remove: [{ card: 'Bombirdier', count: 1 }],
      candidates: ['Helio', 'A1-225'],
      dryRun: true,
    })
    expect(optimizePlan.structuredContent).toMatchObject({
      queued: false,
      plan: { pairings: 1, totalGames: 20 + 400, confirmationGames: 400 },
    })
    // An optimize plan is checked like the real job: a card the deck does not have cannot be taken out.
    const notInDeck = await call(client, 'simulations_enqueue', {
      kind: 'optimize',
      decksA: ['7'],
      decksB: ['2'],
      remove: [{ card: 'B4-103', count: 1 }],
      candidates: ['Helio'],
      dryRun: true,
    })
    expect(notInDeck.isError).toBe(true)
    expect(notInDeck.content[0]?.text).toMatch(/no se pueden sacar 1/)
    const fits = await call(client, 'simulations_enqueue', {
      kind: 'optimize',
      decksA: ['7'],
      decksB: ['2'],
      remove: [
        { card: 'Bombirdier', count: 1 },
        { card: 'Helado Suerte', count: 1 },
        { card: 'Capa Gigante', count: 1 },
      ],
      // H-050: counted as the engine plays, with two copies of a candidate and no name past 2. Deck 7 keeps 2
      // Copiona, Poké Ball, Aguja Granuja and Investigación de Profesores (they do not go) and 1 Helio, Sabrina and Chica
      // del Centro Pokémon (one more fits): far under 200, although the old count said 220.
      candidates: [
        'Helio',
        'A1-225',
        'Copiona',
        'Poké Ball',
        'Aguja Granuja',
        'Chica del Centro Pokémon',
        'Investigación de Profesores',
        'Erika',
        'Misty',
      ],
      dryRun: true,
    })
    expect(fits.isError, fits.content[0]?.text).toBeFalsy()
    // Helio, Sabrina, Chica (one each) and Erika, Misty (two each), three places: 2 + 9 + 6 + 1 = 18 combinations
    // (none, one, two or the three singles, the rest from Erika and Misty).
    expect(fits.structuredContent).toMatchObject({ queued: false, plan: { combinations: 18 } })
    // Ten cards the deck does not play, two copies each: 220 multisets minus the 10 with three copies of one.
    const tooMany = await call(client, 'simulations_enqueue', {
      kind: 'optimize',
      decksA: ['7'],
      decksB: ['2'],
      remove: [
        { card: 'Bombirdier', count: 1 },
        { card: 'Helado Suerte', count: 1 },
        { card: 'Capa Gigante', count: 1 },
      ],
      candidates: ['A1-216', 'A1-217', 'A1-218', 'A1-219', 'A1-220', 'A1-221', 'A1-222', 'A1-223', 'A1-224', 'A1-226'],
      dryRun: true,
    })
    expect(tooMany.isError).toBe(true)
    expect(tooMany.content[0]?.text).toMatch(/^210 combinaciones posibles superan el límite de 200/)
    const longOne = await call(client, 'simulations_enqueue', {
      kind: 'matrix',
      decksA: ['1', '2', '3', '4', '5', '6', '7', '8'],
      games: 20_000,
      bots: ['e3', 'e3'],
    })
    expect(longOne.structuredContent).toMatchObject({ queued: false, message: expect.stringContaining('confirmLong') })
    expect(((await get('/api/simulations')).body as { items: unknown[] }).items.length).toBe(before)

    const queued = await call(client, 'simulations_enqueue', {
      kind: 'compare',
      decksA: ['7'],
      decksB: ['2'],
      games: 20,
    })
    const jobId = queued.structuredContent.jobId as number
    const status = await call(client, 'workers_status')
    expect(status.structuredContent).toMatchObject({
      online: 0,
      queueEndsAround: expect.stringContaining('sin worker'),
    })
    expect((status.structuredContent.queue as { id: number }[]).map((job) => job.id)).toContain(jobId)
    // A worker paused after lost results (worker 0.3.4) says so, and until when.
    const prisma = test.app.get(PrismaService)
    await prisma.workerNode.create({
      data: {
        id: 'worker-paused-1',
        name: 'S25',
        engineRev: 'a'.repeat(40),
        pausedUntil: new Date(Date.now() + 30 * 60_000),
        pauseReason: 'lost_results',
        lastSeenAt: new Date(Date.now() - 60 * 60_000),
      },
    })
    try {
      const paused = await call(client, 'workers_status')
      expect((paused.structuredContent.workers as { name: string; paused?: string }[])[0]).toMatchObject({
        name: 'S25',
        paused: expect.stringMatching(/^en pausa hasta .* perdió resultados/),
      })
    } finally {
      await prisma.workerNode.delete({ where: { id: 'worker-paused-1' } })
    }

    const cancelled = await call(client, 'simulations_cancel', { job: jobId, archive: true })
    expect(cancelled.isError, cancelled.content[0]?.text).toBeFalsy()
    expect(cancelled.structuredContent).toMatchObject({ cancelled: true, archived: true, job: { status: 'cancelada' } })
    const again = await call(client, 'simulations_cancel', { job: jobId })
    expect(again.structuredContent).toMatchObject({ cancelled: false })
    // A failed job: only its failed pairings go back to the queue.
    await test.prisma.simulationJob.update({ where: { id: jobId }, data: { status: 'failed' } })
    await test.prisma.simulationChunk.updateMany({
      where: { jobId },
      data: { status: 'failed', attempt: 3, error: 'x' },
    })
    const retried = await call(client, 'simulations_retry_failed', { job: jobId })
    expect(retried.isError, retried.content[0]?.text).toBeFalsy()
    expect(retried.structuredContent).toMatchObject({
      retried: expect.any(Number),
      job: { status: expect.any(String) },
    })
    expect((await test.prisma.simulationChunk.findMany({ where: { jobId } })).every((c) => c.status === 'queued')).toBe(
      true,
    )
    await call(client, 'simulations_cancel', { job: jobId })
  })

  it('Fase 43: collection_set edits one edition by code, asks when a name is ambiguous, and can be undone', async () => {
    const client = await connect()
    const editions = async () =>
      (await call(client, 'collection_editions', { query: 'B4-103' })).structuredContent.cards as {
        playableCopies: number
        editions: { cardId: string; owned: number }[]
      }[]
    const owned = (await editions())[0]?.editions.find((edition) => edition.cardId === 'B4-103')?.owned ?? 0
    const added = await call(client, 'collection_set', { card: 'b4-103', add: 1 })
    expect(added.isError, added.content[0]?.text).toBeFalsy()
    expect(added.structuredContent).toMatchObject({
      changed: true,
      card: { cardId: 'B4-103', nameEs: 'Hoopa ex' },
      before: { amountOwned: owned },
      after: { amountOwned: owned + 1 },
    })
    expect((await editions())[0]?.editions.find((edition) => edition.cardId === 'B4-103')?.owned).toBe(owned + 1)

    const ambiguous = await call(client, 'collection_set', { card: 'Copiona', add: 1 })
    expect(ambiguous.structuredContent).toMatchObject({ changed: false })
    expect((ambiguous.structuredContent.editions as unknown[]).length).toBeGreaterThan(1)
    const tooMany = await call(client, 'collection_set', { card: 'B4-103', add: -99 })
    expect(tooMany.structuredContent).toMatchObject({ changed: false })

    const audit = (await get('/api/mcp-audit?limit=5')).body.items as { id: string; tool: string; undo: unknown }[]
    const edit = audit.find((row) => row.tool === 'collection_set' && row.undo !== null)
    expect(edit?.undo).toMatchObject({ kind: 'collection_stock', label: expect.stringContaining('Hoopa ex') })
    expect((await test.http().post(`/api/mcp-audit/${edit?.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    expect((await editions())[0]?.editions.find((edition) => edition.cardId === 'B4-103')?.owned).toBe(owned)

    // Edited again by Claude, then by hand there and back (3 → 4 → 3): the later write blocks the stale undo.
    expect((await call(client, 'collection_set', { card: 'B4-103', add: 1 })).isError).toBeFalsy()
    const patch = (amountOwned: number) =>
      test.http().patch('/api/collection/stock/B4-103').set('Cookie', cookie).send({ amountOwned })
    expect((await patch(owned + 2)).status).toBe(200)
    expect((await patch(owned + 1)).status).toBe(200)
    const latest = ((await get('/api/mcp-audit?limit=1')).body.items as { id: string }[])[0]
    const stale = await test.http().post(`/api/mcp-audit/${latest?.id}/undo`).set('Cookie', cookie)
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('collection_changed')
    expect((await patch(owned)).status).toBe(200)

    // Two edits in a row: undoing the newest hands the row back to the older one, which can be undone too.
    expect((await call(client, 'collection_set', { card: 'B4-103', add: 1 })).isError).toBeFalsy()
    expect((await call(client, 'collection_set', { card: 'B4-103', add: 1 })).isError).toBeFalsy()
    const [second, first] = (await get('/api/mcp-audit?limit=2')).body.items as { id: string }[]
    expect((await test.http().post(`/api/mcp-audit/${second?.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    expect((await test.http().post(`/api/mcp-audit/${first?.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    expect((await editions())[0]?.editions.find((edition) => edition.cardId === 'B4-103')?.owned).toBe(owned)
  })

  it('Fase 43: a token used by a new client shows up in the tokens and as an alert', async () => {
    const other = await connect(writeToken, 'Intruso/2.0 (algo)')
    expect((await call(other, 'collection_summary')).isError).toBeFalsy()
    const tokens = (await get('/api/tokens')).body.items as { name: string; clients: { client: string }[] }[]
    expect(tokens.find((token) => token.name === 'claude')?.clients.map((row) => row.client)).toEqual([
      'Claude-User',
      'Intruso',
    ])
    const alerts = (await get('/api/alerts')).body.items as { code: string; level: string; title: string }[]
    const mine = alerts.filter((alert) => alert.code === 'mcp_new_client')
    expect(mine).toContainEqual(
      expect.objectContaining({ level: 'info', title: expect.stringMatching(/«claude» \(tcg_mcp_[\w-]{6}…\)/) }),
    )
    expect(mine).toContainEqual(
      expect.objectContaining({ level: 'warning', title: expect.stringContaining('Intruso') }),
    )
    const listed = await call(other, 'alerts_list')
    expect((listed.structuredContent.alerts as { title: string }[]).map((alert) => alert.title)).toContainEqual(
      expect.stringContaining('Intruso'),
    )
  })

  it('Fase 43: the backup drill does not move the sequence back; a restored id never collides', async () => {
    const client = await connect()
    const logged = await call(client, 'matches_log', { deck: '5', result: 'win', opponent: 'Secuencia' })
    const id = Number((logged.structuredContent.match as Structured).id)
    expect((await call(client, 'matches_delete', { id: String(id) })).isError).toBeFalsy()
    // The drill restores (and rolls back) a copy without that match: its setval used to move the sequence back.
    const drill = await test.http().post('/api/backup/drill').set('Cookie', cookie)
    expect(drill.body.drill).toMatchObject({ ok: true })
    const next = await call(client, 'matches_log', { deck: '5', result: 'loss', opponent: 'Secuencia' })
    expect(Number((next.structuredContent.match as Structured).id)).toBeGreaterThan(id)
    // Restored with its own id; the next match does not collide with it.
    const restored = await call(client, 'matches_restore', { id: String(id) })
    expect(restored.structuredContent).toMatchObject({ restored: true, match: { id: String(id) } })
    expect((await call(client, 'matches_log', { deck: '5', result: 'tie', opponent: 'Secuencia' })).isError).toBeFalsy()

    // If something did move it back and another match took the id, the deleted one comes back with a new id.
    expect((await call(client, 'matches_delete', { id: String(id) })).isError).toBeFalsy()
    const prisma = test.app.get(PrismaService)
    await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"matches"', 'id'), ${id - 1}, true)`)
    const squatter = await test
      .http()
      .post('/api/matches')
      .set('Cookie', cookie)
      .send({ deckId: '5', result: 'win', mode: 'casual' })
    expect(Number(squatter.body.id)).toBe(id)
    // The sequence is still behind: the ids after it are taken too, and the new id must not be one of them.
    const moved = await call(client, 'matches_restore', { id: String(id) })
    expect(moved.structuredContent.note).toMatch(/volvió como la partida \d+/)
    expect(Number((moved.structuredContent.match as Structured).id)).not.toBe(id)
  })

  it('Fase 43: a replaced rival note comes back with «Deshacer»', async () => {
    const client = await connect()
    expect(
      (await call(client, 'rivals_note_set', { opponent: 'Gardevoir', text: 'Primera idea.' })).isError,
    ).toBeFalsy()
    const replaced = await call(client, 'rivals_note_set', { opponent: 'Gardevoir', text: 'Otra cosa.', append: false })
    expect(replaced.structuredContent).toMatchObject({ text: 'Otra cosa.' })
    const audit = (await get('/api/mcp-audit?limit=1')).body.items as { id: string; undo: { label: string } | null }[]
    expect(audit[0]?.undo?.label).toContain('cambiada')
    expect((await test.http().post(`/api/mcp-audit/${audit[0]?.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    const read = await call(client, 'rivals_notes', { opponent: 'Gardevoir' })
    expect((read.structuredContent.note as Structured).text).toBe('Primera idea.')
  })

  it('Fase 43: a deletion left «Sin terminar» can still be undone', async () => {
    const client = await connect()
    const logged = await call(client, 'matches_log', { deck: '6', result: 'win', opponent: 'Corte' })
    const id = String((logged.structuredContent.match as Structured).id)
    expect((await call(client, 'matches_delete', { id })).isError).toBeFalsy()
    // The server died after the delete, before closing the entry: it stays pending, with the match kept.
    const prisma = test.app.get(PrismaService)
    const entry = await prisma.mcpAudit.findFirstOrThrow({ where: { tool: 'matches_delete' }, orderBy: { id: 'desc' } })
    await prisma.mcpAudit.update({
      where: { id: entry.id },
      data: { ok: false, error: 'Sin terminar: el servidor no llegó a anotar el resultado.', result: undefined },
    })
    const listed = (await get('/api/mcp-audit?limit=5')).body.items as { id: string; undo: { kind: string } | null }[]
    expect(listed.find((item) => item.id === String(entry.id))?.undo).toMatchObject({ kind: 'match_delete' })
    const restored = await call(client, 'matches_restore', { id })
    expect(restored.structuredContent).toMatchObject({ restored: true, match: { id } })
    expect((await get(`/api/matches/${id}`)).status).toBe(200)

    // The server died before the delete (no deletedAt) and Santi deleted the match himself: nothing to undo.
    const undo = entry.undo as Record<string, unknown>
    const { deletedAt, ...beforeDelete } = undo
    expect(deletedAt).toEqual(expect.any(String))
    const crashed = await prisma.mcpAudit.create({
      data: {
        tokenId: null,
        tokenName: 'claude',
        client: 'Claude-User',
        tool: 'matches_delete',
        args: { id },
        ok: false,
        error: 'Sin terminar: el servidor no llegó a anotar el resultado.',
        ms: 0,
        undo: beforeDelete as never,
      },
    })
    expect((await test.http().delete(`/api/matches/${id}`).set('Cookie', cookie)).status).toBe(204)
    const again = (await get('/api/mcp-audit?limit=5')).body.items as { id: string; undo: unknown }[]
    expect(again.find((item) => item.id === String(crashed.id))?.undo).toBeNull()
    expect((await test.http().post(`/api/mcp-audit/${crashed.id}/undo`).set('Cookie', cookie)).status).toBe(400)
    expect((await call(client, 'matches_restore', { id })).isError).toBe(true)
    expect((await get(`/api/matches/${id}`)).status).toBe(404)
  })

  it('Fase 43: a deleted rival note comes back with its archetype; one changed since is left alone', async () => {
    const client = await connect()
    const saved = await test
      .http()
      .put('/api/rival-notes')
      .set('Cookie', cookie)
      .send({ opponent: 'Mega Gyarados ex', text: 'Ojo con el turno 2.', archetypeId: 'mega-gyarados-ex' })
    expect(saved.status).toBe(200)
    const lookup = async () =>
      (await get('/api/rival-notes/lookup?opponent=mega%20gyarados%20ex')).body.note as {
        label: string
        archetypeId: string | null
        text: string
      } | null
    expect(
      (await call(client, 'rivals_note_set', { opponent: 'mega gyarados ex', text: '', append: false })).isError,
    ).toBeFalsy()
    expect(await lookup()).toBeNull()
    const latest = async () =>
      ((await get('/api/mcp-audit?limit=1')).body.items as { id: string; undo: { label: string } | null }[])[0]
    const deleted = await latest()
    expect(deleted?.undo?.label).toContain('borrada')
    expect((await test.http().post(`/api/mcp-audit/${deleted?.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    expect(await lookup()).toMatchObject({
      label: 'Mega Gyarados ex',
      archetypeId: 'mega-gyarados-ex',
      text: 'Ojo con el turno 2.',
    })

    // Santi edits it after Claude: «Deshacer» does not overwrite his text.
    await call(client, 'rivals_note_set', { opponent: 'Mega Gyarados ex', text: 'Según Claude.', append: false })
    const replaced = await latest()
    await test
      .http()
      .put('/api/rival-notes')
      .set('Cookie', cookie)
      .send({ opponent: 'Mega Gyarados ex', text: 'Lo corrijo yo.' })
    expect((await test.http().post(`/api/mcp-audit/${replaced?.id}/undo`).set('Cookie', cookie)).status).toBe(409)
    expect((await lookup())?.text).toBe('Lo corrijo yo.')

    // Same text, another spelling of the rival: the label changed, and that can be undone too.
    await call(client, 'rivals_note_set', { opponent: 'MEGA GYARADOS EX', text: 'Lo corrijo yo.', append: false })
    expect((await lookup())?.label).toBe('MEGA GYARADOS EX')
    const relabeled = await latest()
    expect(relabeled?.undo?.label).toContain('cambiada')
    expect((await test.http().post(`/api/mcp-audit/${relabeled?.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    expect(await lookup()).toMatchObject({ label: 'Mega Gyarados ex', text: 'Lo corrijo yo.' })

    // Santi only links it to an archetype after Claude's write (same text): «Deshacer» leaves it alone.
    await call(client, 'rivals_note_set', { opponent: 'Mega Gyarados ex', text: 'Otra idea.', append: false })
    const rewritten = await latest()
    await test
      .http()
      .put('/api/rival-notes')
      .set('Cookie', cookie)
      .send({ opponent: 'Mega Gyarados ex', text: 'Otra idea.', archetypeId: 'mega-gyarados-ex' })
    expect((await test.http().post(`/api/mcp-audit/${rewritten?.id}/undo`).set('Cookie', cookie)).status).toBe(409)
    expect(await lookup()).toMatchObject({ text: 'Otra idea.', archetypeId: 'mega-gyarados-ex' })
  })

  it('Fase 43: an undo entry of the first shape (no key, the text before as a string) touches only its note', async () => {
    const put = (opponent: string, text: string) =>
      test.http().put('/api/rival-notes').set('Cookie', cookie).send({ opponent, text })
    await put('Lugia', 'Misma idea.')
    await put('Ho-Oh', 'Misma idea.')
    await put('Suicune', 'Nueva.')
    const prisma = test.app.get(PrismaService)
    const legacy = (undo: Record<string, unknown>) =>
      prisma.mcpAudit.create({
        data: {
          tokenId: null,
          tokenName: 'viejo',
          client: 'Claude-User',
          tool: 'rivals_note_set',
          args: {},
          ok: true,
          error: null,
          ms: 1,
          undo: { kind: 'rival_note', label: 'Nota', ...undo },
        },
      })
    // It had created Lugia's note: undoing deletes that note only, not every note with the same text.
    const created = await legacy({ opponent: 'Lugia', before: null, after: 'Misma idea.' })
    expect((await test.http().post(`/api/mcp-audit/${created.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    const note = async (opponent: string) =>
      (await get(`/api/rival-notes/lookup?opponent=${encodeURIComponent(opponent)}`)).body.note as {
        text: string
      } | null
    expect(await note('Lugia')).toBeNull()
    expect((await note('Ho-Oh'))?.text).toBe('Misma idea.')
    // It had changed Suicune's text: undoing gives the text back.
    const changed = await legacy({ opponent: 'Suicune', before: 'Vieja.', after: 'Nueva.' })
    expect((await test.http().post(`/api/mcp-audit/${changed.id}/undo`).set('Cookie', cookie)).status).toBe(200)
    expect((await note('Suicune'))?.text).toBe('Vieja.')
  })

  it('Fase 43: a match the phone sent again is not restored twice', async () => {
    const client = await connect()
    const clientRef = '6c0a7e2f-1b3d-4c5e-8f9a-0b1c2d3e4f50'
    const body = { deckId: '3', result: 'win', mode: 'casual', clientRef }
    const sent = await test.http().post('/api/matches').set('Cookie', cookie).send(body)
    expect(sent.status).toBe(201)
    expect((await call(client, 'matches_delete', { id: sent.body.id })).isError).toBeFalsy()
    // The phone retries (no answer reached it): the same clientRef comes in again as a new row.
    const again = await test.http().post('/api/matches').set('Cookie', cookie).send(body)
    expect(again.status).toBe(201)
    expect(again.body.id).not.toBe(sent.body.id)
    const restored = await call(client, 'matches_restore', { id: sent.body.id })
    expect(restored.isError).toBe(true)
    expect(restored.content[0]?.text).toContain(`partida ${again.body.id}`)
    expect((await get(`/api/matches/${sent.body.id}`)).status).toBe(404)
  })

  it('Fase 43: matches_list pages, decks_consistency says when there is none, and the prompts', async () => {
    const client = await connect()
    for (const result of ['win', 'loss', 'win'] as const) {
      expect((await call(client, 'matches_log', { deck: '2', result, opponent: 'Pikachu ex' })).isError).toBeFalsy()
    }
    const first = await call(client, 'matches_list', { deck: '2', limit: 2 })
    expect(first.structuredContent).toMatchObject({ total: 3, offset: 0, next: { offset: 2 } })
    const second = await call(client, 'matches_list', { deck: '2', limit: 2, offset: 2 })
    expect((second.structuredContent.matches as unknown[]).length).toBe(1)
    expect(second.structuredContent.next).toBeUndefined()
    const losses = await call(client, 'matches_list', { deck: '2', result: 'loss' })
    expect(losses.structuredContent.total).toBe(1)

    const consistency = await call(client, 'decks_consistency', { deck: '7' })
    expect(consistency.structuredContent).toMatchObject({
      consistency: null,
      message: expect.stringContaining('ficha'),
    })

    const { prompts } = await client.listPrompts()
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(['que_llevo_hoy', 'repaso_semanal', 'revisar_mazo'])
    const review = await client.getPrompt({ name: 'revisar_mazo', arguments: { deck: '13' } })
    const content = review.messages[0]?.content as { text?: string } | undefined
    const text = content?.text ?? ''
    expect(text).toContain('«13»')
    expect(text).toContain('decks_consistency')
  })
})
