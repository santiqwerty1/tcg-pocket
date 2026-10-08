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
  'decks_create',
  'decks_update',
  'lab_explore',
  'lab_test',
  'matches_delete',
  'matches_log',
  'matches_update',
  'rivals_note_set',
  'simulations_enqueue',
]

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

  async function connect(token = writeToken): Promise<Client> {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
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
      expect(tool?.annotations?.destructiveHint).toBe(name === 'matches_delete')
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
})
