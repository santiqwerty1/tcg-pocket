import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

describe('simulation analysis (e2e, synthetic records)', () => {
  let test: TestApp
  let cookie: string
  let e2: number, f2: number
  let snapshots: number[]
  const get = (query = '') => test.http().get(`/api/simulations/analysis${query}`).set('Cookie', cookie)

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test)
    snapshots = []
    for (const [i, label] of ['Charizard ex', 'Blastoise ex', 'Venusaur ex'].entries()) {
      const s = await test.prisma.deckSnapshot.create({
        data: {
          key: `list-${i}`,
          label,
          sourceType: 'text',
          deckgymText: `list ${i}`,
          energies: ['fire'],
          energySource: 'declared',
          cards: [{ cardId: `B4-${i + 1}`, count: 2 }],
          simulable: true,
        },
      })
      snapshots.push(s.id)
    }
    const create = async (bot: string, archived: boolean) => {
      const job = await test.prisma.simulationJob.create({
        data: {
          kind: 'matrix',
          status: 'done',
          label: `Matriz ${bot}`,
          params: { sideA: snapshots, sideB: snapshots, era: 'B4a' },
          engineRev: test.env.engineRev,
          players: [bot, bot],
          gamesPerPair: 10,
          baseSeed: 1n,
          totalGames: 30,
          archivedAt: archived ? new Date() : null,
        },
      })
      const winners = ['AAAAAAAAAB', 'AAAAAAABBB', 'AAAAAABBBB']
      for (let i = 0; i < 3; i++) {
        const w = (winners[i] as string).replace(/A|B/g, (c) => (bot === 'e2' ? c : c === 'A' ? 'B' : 'A'))
        const turns = Array.from({ length: 10 }, (_, j) => (j % 2 === 0 ? 6 : 10))
        const winsA = [...w].filter((c) => c === 'A').length
        await test.prisma.simulationChunk.create({
          data: {
            jobId: job.id,
            idx: i,
            snapshotAId: snapshots[i],
            snapshotBId: snapshots[(i + 1) % 3],
            games: 10,
            gamesDone: 10,
            seed: BigInt(i),
            status: 'done',
            winsA,
            winsB: 10 - winsA,
            ties: 0,
            turns: 80n,
            finishedAt: new Date(),
            extra: {
              perGame: {
                winners: w,
                starters: 'ABABABABAB',
                turns,
                endings: 'P'.repeat(10),
                stagesA: '0'.repeat(10),
                stagesB: '0'.repeat(10),
              },
            },
          },
        })
      }
      return job.id
    }
    e2 = await create('e2', true)
    f2 = await create('f2', false)
    // In-progress/failed games and a consistency job without opponents must not enter a matchup rate.
    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'consistency',
        status: 'done',
        label: 'Consistencia',
        params: { sideA: snapshots.slice(0, 1), sideB: [] },
        engineRev: test.env.engineRev,
        players: ['r', 'r'],
        gamesPerPair: 5,
        baseSeed: 2n,
        totalGames: 5,
      },
    })
    await test.prisma.simulationChunk.create({
      data: { jobId: job.id, idx: 0, games: 5, gamesDone: 5, seed: 2n, status: 'done', winsA: 0, winsB: 0, ties: 0 },
    })
    await test.prisma.simulationChunk.create({
      data: {
        jobId: e2,
        idx: 4,
        snapshotAId: snapshots[0],
        snapshotBId: snapshots[1],
        games: 10,
        gamesDone: 3,
        seed: 3n,
        status: 'leased',
      },
    })
    await test.prisma.simulationChunk.create({
      data: {
        jobId: e2,
        idx: 5,
        snapshotAId: snapshots[0],
        snapshotBId: snapshots[1],
        games: 10,
        gamesDone: 0,
        seed: 4n,
        status: 'failed',
      },
    })
  })
  afterAll(async () => {
    await test.close()
  })

  it('requires a session, validates filters and has a static analysis route before :id', async () => {
    expect((await test.http().get('/api/simulations/analysis')).status).toBe(401)
    for (const query of ['?bot=h', '?matrix=0', '?era=bad/era', '?expansion=bad!', '?left=9999'])
      expect((await get(query)).status).toBe(400)
  })
  it('counts all jobs once, archived included, keeps sources apart and SQL aggregates perGame', async () => {
    const response = await get(`?matrix=${e2}&left=${e2}&right=${f2}`)
    expect(response.status).toBe(200)
    const view = response.body
    expect(view.source).toBe('simulation')
    expect(view.summary).toMatchObject({ simulations: 3, games: 65, unknownEra: 1, failedChunks: 1 })
    expect(view.summary.byBot).toEqual(
      expect.arrayContaining([{ bot: 'e2/e2', botEs: expect.any(String), simulations: 1, games: 30 }]),
    )
    expect(view.summary.byExpansion).toEqual([{ expansion: 'B4', simulations: 3, games: 65 }])
    expect(view.matrix.rows).toHaveLength(3)
    expect(view.matrix.rows[0].rate).toMatchObject({ source: 'simulation', games: 20, orientative: true })
    expect(view.games).toMatchObject({
      coverage: 30,
      first: { games: 30 },
      second: { games: 30 },
      ties: { games: 30, value: 0 },
      duration: { mean: 8, n: 30 },
    })
    expect(view.games.histogram).toEqual([
      { turns: 6, games: 15 },
      { turns: 10, games: 15 },
    ])
    expect(view.games.first.games + view.games.second.games).toBe(60) // denominators describe the same 30 games
    expect(view.agreement).toMatchObject({
      left: e2,
      right: f2,
      correlation: { rho: -1, n: 3, method: 'bootstrap' },
      orientative: true,
    })
    expect(view.agreement.changes).toHaveLength(3)
    expect(view.matrices.find((m: { id: number }) => m.id === e2).archived).toBe(true)
    expect(view.calibrationJobId).toBeNull()
    expect(view.findings.some((f: { text: string }) => f.text.includes('IC 95 %'))).toBe(true)
  })
  it('filters expansion, declared era and either bot, leaving legacy era unknown', async () => {
    expect((await get('?bot=e2&era=B4a&expansion=B4')).body.summary).toMatchObject({ simulations: 1, games: 30 })
    const empty = await get('?era=B3')
    expect(empty.status).toBe(200)
    expect(empty.body).toMatchObject({
      summary: { simulations: 0, games: 0 },
      matrix: null,
      agreement: null,
      rankings: [],
      findings: [],
    })
    expect((await get('?expansion=B4b')).body.summary.games).toBe(0)
  })
  it('reuses cached analysis, invalidates on new results, metadata changes and deletion', async () => {
    const query = `?matrix=${e2}`
    const before = (await get(query)).body
    const sql = vi.spyOn(test.prisma, '$queryRaw')
    await test.prisma.simulationChunk.updateMany({ where: { jobId: e2, idx: 4 }, data: { gamesDone: 4 } })
    expect((await get(query)).body).toEqual(before)
    expect(sql).toHaveBeenCalledTimes(1) // version query only; pairings and perGame histogram come from cache
    sql.mockRestore()
    await test.prisma.simulationChunk.create({
      data: {
        jobId: e2,
        idx: 6,
        snapshotAId: snapshots[0],
        snapshotBId: snapshots[1],
        games: 10,
        gamesDone: 10,
        seed: 5n,
        status: 'done',
        winsA: 0,
        winsB: 0,
        ties: 10,
        finishedAt: new Date(),
      },
    })
    const after = (await get(query)).body
    expect(after.summary.games).toBe(before.summary.games + 10)
    expect(after.games.coverage).toBe(30)
    expect(after.games.ties).toMatchObject({ games: 40, value: 25 })
    await test.prisma.deckSnapshot.update({ where: { id: snapshots[0] }, data: { label: 'Charizard actualizado' } })
    expect(
      (await get(query)).body.matrix.rows.some((r: { label: string }) => r.label === 'Charizard actualizado'),
    ).toBe(true)
    await test.prisma.simulationChunk.deleteMany({ where: { jobId: e2, idx: 6 } })
    expect((await get(query)).body.summary.games).toBe(before.summary.games)
  })
  it('handles an 81-list, 2,000-game-per-pair matrix with aggregate-sized payload', async () => {
    const ids = []
    for (let i = 0; i < 81; i++) {
      ids.push(
        (
          await test.prisma.deckSnapshot.create({
            data: {
              key: `large-${i}`,
              label: `Mazo ${i}`,
              sourceType: 'text',
              deckgymText: `large ${i}`,
              energies: ['fire'],
              energySource: 'declared',
              cards: [],
              simulable: true,
            },
          })
        ).id,
      )
    }
    const count = (81 * 80) / 2
    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'matrix',
        status: 'done',
        label: '81 listas',
        params: { sideA: ids, sideB: ids },
        engineRev: test.env.engineRev,
        players: ['aa', 'aa'],
        gamesPerPair: 2000,
        baseSeed: 10n,
        totalGames: count * 2000,
      },
    })
    const chunks = []
    for (let i = 0; i < 81; i++)
      for (let j = i + 1; j < 81; j++)
        for (let k = 0; k < 2; k++)
          chunks.push({
            jobId: job.id,
            idx: chunks.length,
            snapshotAId: ids[i],
            snapshotBId: ids[j],
            games: 1000,
            gamesDone: 1000,
            seed: 10n,
            status: 'done' as const,
            winsA: 500,
            winsB: 500,
            ties: 0,
            turns: 8000n,
          })
    await test.prisma.simulationChunk.createMany({ data: chunks })
    const started = performance.now()
    const response = await get(`?bot=aa&matrix=${job.id}`)
    const coldMs = Math.round(performance.now() - started)
    expect(response.status).toBe(200)
    expect(response.body.summary.games).toBe(count * 2000)
    expect(response.body.matrix.rows).toHaveLength(81)
    expect(response.body.matrix.rows[0].rate.games).toBe(80 * 2000)
    expect(response.body.matrix.rows[0].cells[0].rate.games).toBe(2000)
    expect(JSON.stringify(response.body).length).toBeLessThan(3_000_000)
    expect(response.body.games.coverage).toBe(0)
    expect(response.body.games.duration).toMatchObject({ mean: 8, n: count * 2000, ci95: null })
    const cachedStart = performance.now()
    expect((await get(`?bot=aa&matrix=${job.id}`)).status).toBe(200)
    console.info(
      `Análisis 81 listas: ${count * 2000} partidas, ${JSON.stringify(response.body).length} bytes, primera lectura ${coldMs} ms, caché ${Math.round(performance.now() - cachedStart)} ms.`,
    )
  })
  it('registers simulations_analysis read-only and returns the same filtered REST response through MCP', async () => {
    const token = (
      await test
        .http()
        .post('/api/tokens')
        .set('Cookie', cookie)
        .send({ name: 'analista', kind: 'mcp', scopes: ['mcp:read'] })
    ).body.token
    await test.app.listen(0, '127.0.0.1')
    const port = (test.app.getHttpServer().address() as AddressInfo).port
    const client = new Client({ name: 'analysis-test', version: '1.0.0' })
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      )
      const tool = (await client.listTools()).tools.find((t) => t.name === 'simulations_analysis')
      expect(tool?.annotations?.readOnlyHint).toBe(true)
      const actual = await client.callTool({ name: 'simulations_analysis', arguments: { bot: 'e2', matrix: e2 } })
      expect(actual.isError).not.toBe(true)
      expect(actual.structuredContent).toEqual((await get(`?bot=e2&matrix=${e2}`)).body)
    } finally {
      await client.close()
    }
  })
})
