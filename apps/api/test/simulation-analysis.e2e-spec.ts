import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { summarizeAnalysisGames } from '@tcg/domain'
import { WorkerQueueService } from '../src/simulation/worker-queue.service.js'
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
  it('prefers finished matrices on the same engine and labels explicit cross-engine or partial comparisons', async () => {
    const original = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: f2 } })
    const clone = async (engineRev: string, status: 'running' | 'done') => {
      const { id: _id, ...data } = original
      const job = await test.prisma.simulationJob.create({
        data: {
          ...data,
          params: { sideA: snapshots, sideB: snapshots, era: 'B4a' },
          engineRev,
          status,
          createdAt: new Date(),
        },
      })
      await test.prisma.simulationChunk.create({
        data: {
          jobId: job.id,
          idx: 0,
          snapshotAId: snapshots[0],
          snapshotBId: snapshots[1],
          games: 100,
          gamesDone: 100,
          winsA: 20,
          winsB: 80,
          ties: 0,
          seed: 1n,
          status: 'done',
        },
      })
      return job.id
    }
    const cross = await clone('other-engine', 'done')
    const partial = await clone(test.env.engineRev, 'running')
    expect((await get()).body.comparison).toEqual({ left: e2, right: f2 })
    expect((await get(`?left=${e2}&right=${cross}`)).body.agreement).toMatchObject({
      sameEngine: false,
      leftStatus: 'done',
      rightStatus: 'done',
      leftBot: 'e2/e2',
      rightBot: 'f2/f2',
    })
    expect((await get(`?left=${e2}&right=${partial}`)).body.agreement).toMatchObject({
      sameEngine: true,
      rightStatus: 'running',
      orientative: true,
    })
    const saved = await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: e2 } })
    await test.prisma.simulationJob.update({
      where: { id: e2 },
      data: { params: { sideA: snapshots, sideB: snapshots } },
    })
    expect((await get(`?left=${e2}&right=${f2}`)).body.agreement).not.toBeNull()
    await test.prisma.simulationJob.update({
      where: { id: e2 },
      data: { params: saved.params as { sideA: number[]; sideB: number[]; era: string } },
    })
    await test.prisma.simulationJob.deleteMany({ where: { id: { in: [cross, partial] } } })
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
  // D-023: 81 lists × 2,000 games of synthetic records; on the loaded PC runners 60 s is not enough.
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
            winsA: i === 0 && j === 2 ? 300 : 700,
            winsB: i === 0 && j === 2 ? 700 : 300,
            ties: 0,
            turns: 8000n,
            extra: (() => {
              const perGame = {
                winners: 'A'.repeat(i === 0 && j === 2 ? 300 : 700) + 'B'.repeat(i === 0 && j === 2 ? 700 : 300),
                starters: 'AB'.repeat(500),
                turns: Array(1000).fill(8),
                endings: 'P'.repeat(1000),
                stagesA: '0'.repeat(1000),
                stagesB: '0'.repeat(1000),
              }
              return k === 0 ? { perGame, analysisGames: summarizeAnalysisGames(perGame) } : { perGame }
            })(),
          })
    for (let start = 0; start < chunks.length; start += 100)
      await test.prisma.simulationChunk.createMany({ data: chunks.slice(start, start + 100) })
    const started = performance.now()
    const response = await get(`?bot=aa&matrix=${job.id}`)
    const coldMs = Math.round(performance.now() - started)
    expect(response.status).toBe(200)
    expect(response.body.summary.games).toBe(count * 2000)
    expect(response.body.matrix.rows).toHaveLength(81)
    expect(response.body.matrix.rows[0].rate.games).toBe(80 * 2000)
    expect(response.body.matrix.rows[0].cells[0].rate.games).toBe(2000)
    expect(Buffer.byteLength(JSON.stringify(response.body))).toBeLessThan(3_000_000)
    expect(response.body.games.coverage).toBe(count * 2000)
    expect(response.body.patterns.dominant).toHaveLength(50)
    expect(response.body.patterns.dominantTotal).toBeGreaterThan(50)
    expect(response.body.patterns.cyclesTotal).toBeGreaterThan(0)
    // End-to-end budget includes the large heatmap's serialization; SQL itself has a 15 s statement_timeout.
    expect(coldMs).toBeLessThan(30_000)
    expect(response.body.games.duration).toMatchObject({ mean: 8, n: count * 2000, ci95: [8, 8] })
    const cachedStart = performance.now()
    expect((await get(`?bot=aa&matrix=${job.id}`)).status).toBe(200)
    process.stdout.write(
      `Análisis 81 listas: ${count * 2000} partidas, ${Buffer.byteLength(JSON.stringify(response.body))} bytes, primera lectura ${coldMs} ms, caché ${Math.round(performance.now() - cachedStart)} ms.\n`,
    )
  }, 240_000)
  it('derives a summary when accepting perGame, ignores supplied statistics and preserves idempotence', async () => {
    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'compare',
        status: 'running',
        label: 'Laboratorio e2',
        params: { perGame: true, lab: {} },
        engineRev: test.env.engineRev,
        players: ['e2', 'e2'],
        gamesPerPair: 4,
        baseSeed: 1n,
        totalGames: 4,
      },
    })
    const chunk = await test.prisma.simulationChunk.create({
      data: {
        jobId: job.id,
        idx: 0,
        snapshotAId: snapshots[0],
        snapshotBId: snapshots[1],
        games: 4,
        seed: 1n,
        status: 'leased',
        workerId: null,
      },
    })
    const perGame = {
      winners: 'ABTA',
      starters: 'AABA',
      turns: [6, 6, 10, 10],
      endings: 'PPTP',
      stagesA: '0000',
      stagesB: '0000',
    }
    const input = {
      workerId: 'synthetic',
      engineRev: test.env.engineRev,
      winsA: 2,
      winsB: 1,
      ties: 1,
      games: 4,
      turns: 32,
      durationMs: 1,
      extra: { perGame, analysisGames: { version: 1, histogram: [] } },
    }
    const queue = test.app.get(WorkerQueueService)
    expect(await queue.result(chunk.id, input)).toEqual({ accepted: true })
    expect(await queue.result(chunk.id, input)).toEqual({ accepted: false })
    expect((await test.prisma.simulationChunk.findUniqueOrThrow({ where: { id: chunk.id } })).extra).toMatchObject({
      perGame,
      analysisGames: {
        version: 1,
        histogram: [
          { turns: 6, games: 2, firstWins: 1, secondWins: 1, ties: 0 },
          { turns: 10, games: 2, firstWins: 1, secondWins: 0, ties: 1 },
        ],
      },
    })
    // Matrix without perGame: use the laboratory, explicitly scoped to the same bot and engine.
    await test.prisma.simulationChunk.updateMany({ where: { jobId: e2, status: 'done' }, data: { extra: {} } })
    const view = (await get(`?matrix=${e2}`)).body
    expect(view.gameSample).toMatchObject({ scope: 'laboratory', jobIds: [job.id], games: 4 })
    expect(view.games).toMatchObject({ coverage: 4, first: { value: 50 }, duration: { n: 4, mean: 8 } })
    await test.prisma.simulationJob.update({ where: { id: job.id }, data: { engineRev: 'different-engine' } })
    expect((await get(`?matrix=${e2}`)).body.games.coverage).toBe(0)
    await test.prisma.simulationJob.update({
      where: { id: job.id },
      data: { engineRev: test.env.engineRev, players: ['e2', 'f2'] },
    })
    expect((await get(`?matrix=${e2}`)).body.games.coverage).toBe(0)
  })
  it('registers simulations_analysis read-only and returns bounded Spanish evidence through MCP', async () => {
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
      const data = actual.structuredContent as {
        text: string
        warning: string
        rankings: { rows: { rate: { text: string } }[] }[]
        matrix?: unknown
      }
      expect(data.text).toContain('partidas terminadas')
      expect(data.warning).toContain('Exploratorios'.toLowerCase())
      expect(data.rankings[0]?.rows[0]?.rate.text).toContain('IC')
      expect(data.matrix).toBeUndefined()
      expect(JSON.stringify(actual).length).toBeLessThan(30_000)
      const missing = await client.callTool({ name: 'simulations_analysis', arguments: { detail: 'full' } })
      expect(missing.isError).toBe(true)
      const full = await client.callTool({ name: 'simulations_analysis', arguments: { matrix: e2, detail: 'full' } })
      expect((full.structuredContent as { matrix: { id: number } }).matrix.id).toBe(e2)
      expect(JSON.stringify(full.content).length).toBeLessThan(30_000)
      const content = full.content as { type: string; text: string }[]
      const textual = JSON.parse(content[0]?.text ?? '{}')
      expect(textual.matrix).toBeUndefined()
      expect(textual.rankings[0].rows[0].rate.text).toContain('IC')
      const compactLarge = await client.callTool({ name: 'simulations_analysis', arguments: { bot: 'aa' } })
      expect(JSON.stringify(compactLarge).length).toBeLessThan(30_000)
      expect((compactLarge.structuredContent as typeof data).rankings[0]?.rows).toHaveLength(5)
    } finally {
      await client.close()
    }
  })
})
