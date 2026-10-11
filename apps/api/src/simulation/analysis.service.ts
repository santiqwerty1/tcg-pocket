import { BadRequestException, Injectable } from '@nestjs/common'
import {
  type AnalysisMatrixInput,
  analysisFindings,
  analysisMatrix,
  analyzeGames,
  botLabel,
  type ChunkOutcome,
  compareAnalysisBots,
  type GameMoments,
  type GameRecord,
  matchupPatterns,
} from '@tcg/domain'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export interface AnalysisQuery {
  expansion?: string | undefined
  era?: string | undefined
  bot?: string | undefined
  matrix?: number | undefined
  left?: number | undefined
  right?: number | undefined
}
interface Aggregate {
  jobId: number
  games: number
  winsA: number
  winsB: number
  ties: number
  turns: number
  turnGames: number
  finished: number
  failed: number
  version: string
}
interface Params {
  sideA?: number[]
  sideB?: number[]
  calibration?: { era?: string }
  lab?: { era?: string }
  era?: string
}
const emptyMoments = (): GameMoments => ({
  games: 0,
  firstWins: 0,
  secondWins: 0,
  ties: 0,
  turnSum: 0,
  turnSquares: 0,
  histogram: [],
})

@Injectable()
export class SimulationAnalysisService {
  // Bounded by query, keyed by all metadata and result version; no stale TTL for progressing jobs.
  private readonly cache = new Map<
    string,
    { version: string; value: Awaited<ReturnType<SimulationAnalysisService['compute']>> }
  >()
  constructor(private readonly prisma: PrismaService) {}

  async read(query: AnalysisQuery = {}) {
    const [allJobs, totals, snapshots] = await Promise.all([
      this.prisma.simulationJob.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.$queryRaw<Aggregate[]>`
        SELECT job_id AS "jobId", COALESCE(SUM(games_done) FILTER (WHERE status = 'done'), 0)::float8 AS games,
          COALESCE(SUM(wins_a) FILTER (WHERE status = 'done' AND snapshot_b_id IS NOT NULL), 0)::float8 AS "winsA",
          COALESCE(SUM(wins_b) FILTER (WHERE status = 'done' AND snapshot_b_id IS NOT NULL), 0)::float8 AS "winsB",
          COALESCE(SUM(ties) FILTER (WHERE status = 'done' AND snapshot_b_id IS NOT NULL), 0)::float8 AS ties,
          COALESCE(SUM(turns) FILTER (WHERE status = 'done' AND snapshot_b_id IS NOT NULL), 0)::float8 AS turns,
          COALESCE(SUM(games_done) FILTER (WHERE status = 'done' AND snapshot_b_id IS NOT NULL AND turns IS NOT NULL), 0)::float8 AS "turnGames",
          COUNT(*) FILTER (WHERE status = 'done')::int AS finished,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          CONCAT(COUNT(*), ':', MAX(finished_at), ':', SUM(games_done), ':', SUM(wins_a), ':', SUM(wins_b), ':', SUM(ties), ':', SUM(turns)) AS version
        FROM simulation_chunks GROUP BY job_id`,
      this.prisma.deckSnapshot.findMany({ select: { id: true, key: true, label: true, cards: true } }),
    ])
    const bySnapshot = new Map(snapshots.map((s) => [s.id, s]))
    const byJob = new Map(totals.map((t) => [t.jobId, t]))
    const expansionOf = (ids: number[]) =>
      [
        ...new Set(
          ids.flatMap((id) => {
            const cards = bySnapshot.get(id)?.cards
            return Array.isArray(cards)
              ? cards.flatMap((c) => {
                  const cardId = (c as { cardId?: string } | null)?.cardId
                  return cardId ? [cardId.split('-')[0] as string] : []
                })
              : []
          }),
        ),
      ].sort()
    const jobs = allJobs.map((job) => {
      const params = job.params as Params
      const aggregate = byJob.get(job.id)
      const era =
        params.calibration?.era ??
        params.lab?.era ??
        params.era ??
        (job.params as { consistency?: { era?: string } }).consistency?.era ??
        null
      const expansions = expansionOf([...(params.sideA ?? []), ...(params.sideB ?? [])])
      return { job, era, expansions, aggregate }
    })
    const options = {
      bots: [...new Set(allJobs.flatMap((j) => j.players))].sort(),
      eras: [...new Set(jobs.flatMap((j) => (j.era ? [j.era] : [])))].sort(),
      expansions: [...new Set(jobs.flatMap((j) => j.expansions))].sort(),
    }
    const selected = jobs.filter(
      (j) =>
        (!query.bot || j.job.players.includes(query.bot)) &&
        (!query.era || j.era === query.era) &&
        (!query.expansion || j.expansions.includes(query.expansion)),
    )
    const matrices = selected
      .filter((j) => j.job.kind === 'matrix')
      .map((j) => ({
        id: j.job.id,
        label: j.job.label,
        status: j.job.status,
        bot: j.job.players.join('/'),
        botEs: j.job.players.map(botLabel).join(' / '),
        symmetric: j.job.players[0] === j.job.players[1],
        engineRev: j.job.engineRev,
        era: j.era,
        games: j.aggregate?.games ?? 0,
        archived: j.job.archivedAt !== null,
        calibration: (j.job.params as Params).calibration !== undefined,
      }))
    for (const id of [query.matrix, query.left, query.right])
      if (id !== undefined && !matrices.some((m) => m.id === id)) {
        throw new BadRequestException('La matriz elegida no pertenece a estos filtros.')
      }
    const version = JSON.stringify({
      jobs: selected.map((j) => ({ ...j.job, baseSeed: String(j.job.baseSeed), aggregate: j.aggregate })),
      snapshots,
      options,
    })
    const cacheKey = JSON.stringify(query)
    const cached = this.cache.get(cacheKey)
    if (cached?.version === version) return cached.value
    const summary = {
      simulations: selected.length,
      games: selected.reduce((n, j) => n + (j.aggregate?.games ?? 0), 0),
      byBot: [...new Set(selected.map((j) => j.job.players.join('/')))].map((bot) => ({
        bot,
        botEs: bot.split('/').map(botLabel).join(' / '),
        simulations: selected.filter((j) => j.job.players.join('/') === bot).length,
        games: selected
          .filter((j) => j.job.players.join('/') === bot)
          .reduce((n, j) => n + (j.aggregate?.games ?? 0), 0),
      })),
      byExpansion: [...new Set(selected.flatMap((j) => j.expansions))].map((expansion) => ({
        expansion,
        simulations: selected.filter((j) => j.expansions.includes(expansion)).length,
        games: selected
          .filter((j) => j.expansions.includes(expansion))
          .reduce((n, j) => n + (j.aggregate?.games ?? 0), 0),
      })),
      unknownEra: selected.filter((j) => j.era === null).length,
      failedChunks: selected.reduce((n, j) => n + (j.aggregate?.failed ?? 0), 0),
    }
    const chosen = query.matrix ?? matrices.find((m) => m.games > 0)?.id ?? matrices[0]?.id
    const ranked = matrices
      .filter((m) => m.symmetric && m.games > 0)
      .filter(
        (m, i, all) => all.findIndex((x) => x.bot === m.bot && x.era === m.era && x.engineRev === m.engineRev) === i,
      )
    const left = query.left ?? ranked.find((m) => m.bot === 'e2/e2')?.id ?? ranked[0]?.id
    const lm = matrices.find((m) => m.id === left)
    const right =
      query.right ??
      (lm
        ? (ranked.find((m) => m.bot === 'f2/f2' && m.era === lm.era)?.id ??
          ranked.find((m) => m.bot !== lm.bot && m.era === lm.era)?.id)
        : undefined)
    const ids = [
      ...new Set([...ranked.map((m) => m.id), chosen, left, right].filter((id): id is number => id !== undefined)),
    ]
    const value = await this.compute({
      options,
      summary,
      matrices,
      selected,
      snapshots,
      chosen,
      left,
      right,
      ids,
      totals,
    })
    this.cache.delete(cacheKey)
    if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(cacheKey, { version, value })
    return value
  }

  private async compute(input: {
    options: { bots: string[]; eras: string[]; expansions: string[] }
    summary: {
      simulations: number
      games: number
      byBot: { bot: string; botEs: string; simulations: number; games: number }[]
      byExpansion: { expansion: string; simulations: number; games: number }[]
      unknownEra: number
      failedChunks: number
    }
    matrices: {
      id: number
      label: string
      status: string
      bot: string
      botEs: string
      symmetric: boolean
      engineRev: string
      era: string | null
      games: number
      archived: boolean
      calibration: boolean
    }[]
    selected: {
      job: { id: number; params: Prisma.JsonValue; label: string; players: string[]; engineRev: string }
      era: string | null
    }[]
    snapshots: { id: number; key: string; label: string }[]
    chosen: number | undefined
    left: number | undefined
    right: number | undefined
    ids: number[]
    totals: Aggregate[]
  }) {
    const outcomes = input.ids.length
      ? await this.prisma.$queryRaw<(ChunkOutcome & { jobId: number })[]>(Prisma.sql`
      SELECT job_id AS "jobId", snapshot_a_id AS a, snapshot_b_id AS b,
        SUM(wins_a)::float8 AS "winsA", SUM(wins_b)::float8 AS "winsB", SUM(ties)::float8 AS ties
      FROM simulation_chunks WHERE job_id IN (${Prisma.join(input.ids)}) AND status = 'done'
        AND snapshot_a_id IS NOT NULL AND snapshot_b_id IS NOT NULL
      GROUP BY job_id, snapshot_a_id, snapshot_b_id`)
      : []
    const reports = input.ids.map((id) => {
      const entry = input.selected.find((j) => j.job.id === id) as (typeof input.selected)[number]
      const params = entry.job.params as Params
      return analysisMatrix({
        id,
        label: entry.job.label,
        bot: entry.job.players.join('/'),
        engineRev: entry.job.engineRev,
        era: entry.era,
        decks: input.snapshots,
        sideA: params.sideA ?? [],
        sideB: params.sideB ?? params.sideA ?? [],
        outcomes: outcomes.filter((c) => c.jobId === id),
      } satisfies AnalysisMatrixInput)
    })
    const matrix = reports.find((m) => m.id === input.chosen) ?? null
    const left = reports.find((m) => m.id === input.left),
      right = reports.find((m) => m.id === input.right)
    const agreement =
      left &&
      right &&
      input.matrices.find((m) => m.id === left.id)?.symmetric &&
      input.matrices.find((m) => m.id === right.id)?.symmetric
        ? compareAnalysisBots(left, right)
        : null
    const moments = emptyMoments()
    if (matrix && input.matrices.find((m) => m.id === matrix.id)?.symmetric) {
      // Expand perGame only for the chosen matrix, inside Postgres. Return a small turn histogram and sufficient
      // statistics. Historical chunks without perGame remain in rates, not in the first-player/duration sample.
      const hist = await this.prisma.$queryRaw<
        { turns: number; games: number; firstWins: number; secondWins: number; ties: number }[]
      >`
        SELECT (t.value #>> '{}')::int AS turns, COUNT(*)::int AS games,
          COUNT(*) FILTER (WHERE substring(c.extra->'perGame'->>'winners', t.ordinality::int, 1) = substring(c.extra->'perGame'->>'starters', t.ordinality::int, 1))::int AS "firstWins",
          COUNT(*) FILTER (WHERE substring(c.extra->'perGame'->>'winners', t.ordinality::int, 1) <> 'T' AND substring(c.extra->'perGame'->>'winners', t.ordinality::int, 1) <> substring(c.extra->'perGame'->>'starters', t.ordinality::int, 1))::int AS "secondWins",
          COUNT(*) FILTER (WHERE substring(c.extra->'perGame'->>'winners', t.ordinality::int, 1) = 'T')::int AS ties
        FROM simulation_chunks c CROSS JOIN LATERAL jsonb_array_elements(c.extra->'perGame'->'turns') WITH ORDINALITY AS t(value, ordinality)
        WHERE c.job_id = ${matrix.id} AND c.status = 'done' AND c.snapshot_b_id IS NOT NULL
          AND jsonb_typeof(c.extra->'perGame'->'turns') = 'array'
        GROUP BY 1 ORDER BY 1`
      for (const row of hist) {
        moments.games += row.games
        moments.firstWins += row.firstWins
        moments.secondWins += row.secondWins
        moments.ties += row.ties
        moments.turnSum += row.turns * row.games
        moments.turnSquares += row.turns ** 2 * row.games
        moments.histogram.push({ turns: row.turns, games: row.games })
      }
    }
    const record: GameRecord = outcomes
      .filter((c) => c.jobId === matrix?.id)
      .reduce((r, c) => ({ wins: r.wins + c.winsA, losses: r.losses + c.winsB, ties: r.ties + c.ties }), {
        wins: 0,
        losses: 0,
        ties: 0,
      })
    const aggregate = input.totals.find((t) => t.jobId === matrix?.id)
    const games = analyzeGames(
      record,
      moments,
      aggregate ? { games: aggregate.turnGames, turns: aggregate.turns } : undefined,
    )
    const patterns = matrix ? matchupPatterns(matrix) : { dominant: [], cycles: [], cyclesTotal: 0 }
    return {
      source: 'simulation' as const,
      options: input.options,
      summary: input.summary,
      matrices: input.matrices,
      matrix,
      rankings: reports
        .filter((m) => input.matrices.find((x) => x.id === m.id)?.symmetric)
        .map(({ rows, ...m }) => ({ ...m, rows: rows.map(({ cells: _cells, ...row }) => row) })),
      agreement,
      comparison: { left: input.left ?? null, right: input.right ?? null },
      games,
      patterns,
      findings: analysisFindings(patterns, games, agreement),
      calibrationJobId: input.matrices.find((m) => m.id === matrix?.id)?.calibration ? (matrix?.id ?? null) : null,
    }
  }
}
