import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
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

    const cancelled = await call(client, 'simulations_cancel', { job: jobId, archive: true })
    expect(cancelled.isError, cancelled.content[0]?.text).toBeFalsy()
    expect(cancelled.structuredContent).toMatchObject({ cancelled: true, archived: true, job: { status: 'cancelada' } })
    const again = await call(client, 'simulations_cancel', { job: jobId })
    expect(again.structuredContent).toMatchObject({ cancelled: false })
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
    expect(mine).toContainEqual(expect.objectContaining({ level: 'info', title: expect.stringContaining('«claude»') }))
    expect(mine).toContainEqual(
      expect.objectContaining({ level: 'warning', title: expect.stringContaining('Intruso') }),
    )
    const listed = await call(other, 'alerts_list')
    expect((listed.structuredContent.alerts as { title: string }[]).map((alert) => alert.title)).toContainEqual(
      expect.stringContaining('Intruso'),
    )
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
