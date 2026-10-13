/** Analysis of simulation aggregates. No tournament or personal game records enter these functions. */

import { seededRandom } from '../../lab/mutate.js'
import { metaScore, scoreDifference } from '../../lab/score.js'
import { type GameRecord, PERCENT_ES, type WinRate, Z_95 } from '../../stats/rates.js'
import { benjaminiHochberg, twoSidedP } from '../../stats/tests.js'
import { type RankCorrelation, spearman } from '../calibration.js'
import type { PerGameResults } from '../perGame.js'
import { type ChunkOutcome, matrixRows, simulationRate } from '../results.js'

export type ChunkGameHistogram = {
  turns: number
  games: number
  firstWins: number
  secondWins: number
  ties: number
}

/** Compute once, after checkPerGame validates the worker result. Kept in extra, independent of the worker. */
export function summarizeAnalysisGames(results: PerGameResults): { version: 1; histogram: ChunkGameHistogram[] } {
  const bins = new Map<number, ChunkGameHistogram>()
  for (const [i, turns] of results.turns.entries()) {
    const bin = bins.get(turns) ?? { turns, games: 0, firstWins: 0, secondWins: 0, ties: 0 }
    bin.games++
    if (results.winners[i] === 'T') bin.ties++
    else if (results.winners[i] === results.starters[i]) bin.firstWins++
    else bin.secondWins++
    bins.set(turns, bin)
  }
  return { version: 1, histogram: [...bins.values()].sort((a, b) => a.turns - b.turns) }
}

export interface AnalysisDeck {
  id: number
  key: string
  label: string
}
export interface AnalysisMatrixInput {
  id: number
  label: string
  bot: string
  engineRev: string
  era: string | null
  status?: string
  decks: AnalysisDeck[]
  sideA: number[]
  sideB: number[]
  outcomes: ChunkOutcome[]
}
export interface AnalysisRow {
  key: string
  label: string
  record: GameRecord
  rate: WinRate<'simulation'> | null
  cells: { rival: string; label: string; record: GameRecord | null; rate: WinRate<'simulation'> | null }[]
}
export interface AnalysisMatrix {
  id: number
  label: string
  bot: string
  engineRev: string
  era: string | null
  status: string
  rows: AnalysisRow[]
}

/** Snapshot identity is the exact list hash (including energies), never a mutable deck name or id. */
export function analysisMatrix(input: AnalysisMatrixInput): AnalysisMatrix {
  const byId = new Map(input.decks.map((deck) => [deck.id, deck]))
  const ids = new Map<string, number>()
  const labels = new Map<number, AnalysisDeck>()
  const canonical = (id: number) => {
    const deck = byId.get(id)
    if (!deck) throw new RangeError(`Missing snapshot ${id}`)
    let value = ids.get(deck.key)
    if (value === undefined) {
      value = ids.size
      ids.set(deck.key, value)
      labels.set(value, deck)
    }
    return value
  }
  const outcomes = input.outcomes
    .map((c) => ({ ...c, a: canonical(c.a), b: canonical(c.b) }))
    .filter((c) => c.a !== c.b)
  const rows = matrixRows(outcomes, input.sideA.map(canonical), input.sideB.map(canonical))
  return {
    id: input.id,
    label: input.label,
    bot: input.bot,
    engineRev: input.engineRev,
    era: input.era,
    status: input.status ?? 'done',
    rows: rows.map((row) => ({
      key: (labels.get(row.deck) as AnalysisDeck).key,
      label: (labels.get(row.deck) as AnalysisDeck).label,
      record: row.total,
      rate: simulationRate(row.total),
      cells: row.cells.map((cell) => ({
        rival: (labels.get(cell.rival) as AnalysisDeck).key,
        label: (labels.get(cell.rival) as AnalysisDeck).label,
        record: cell.record,
        rate: cell.record ? simulationRate(cell.record) : null,
      })),
    })),
  }
}

export interface BotChange {
  key: string
  label: string
  before: { value: number; ci95: [number, number]; games: number }
  after: { value: number; ci95: [number, number]; games: number }
  difference: { value: number; ci95: [number, number]; se: number }
  rivals: number
  rankBefore: number
  rankAfter: number
  orientative: boolean
  pValue: number
  significant: boolean
}
export interface BotAgreement {
  left: number
  right: number
  leftBot: string
  rightBot: string
  leftEngine: string
  rightEngine: string
  leftStatus: string
  rightStatus: string
  sameEngine: boolean
  correlation: RankCorrelation | null
  changes: BotChange[]
  orientative: boolean
}

/** Deterministic bootstrap over common decks; undefined when ranks have no spread or fewer than 3 decks. */
export function bootstrapRankCorrelation(xs: readonly number[], ys: readonly number[]): RankCorrelation | null {
  const point = spearman(xs, ys)
  if (!point) return null
  if (xs.length < 5) return { ...point, method: 'bootstrap', ci95: null }
  const next = seededRandom(20261011)
  const values: number[] = []
  for (let b = 0; b < 1000; b++) {
    const picks = xs.map(() => Math.floor(next() * xs.length))
    const rho = spearman(
      picks.map((i) => xs[i] as number),
      picks.map((i) => ys[i] as number),
    )?.rho
    if (rho !== undefined) values.push(rho)
  }
  values.sort((a, b) => a - b)
  return {
    ...point,
    method: 'bootstrap',
    ci95:
      values.length < 500
        ? null
        : [values[Math.floor(values.length * 0.025)] as number, values[Math.ceil(values.length * 0.975) - 1] as number],
  }
}

/** Different bots, compatible era when known, common decks and per-deck common rivals, with equal weight per rival.
 * Differences reuse the laboratory's smoothed variance, assuming independent runs (not a paired seed test).
 * Rank ties share their position. Engine revisions remain explicit; neither run is pooled into the other.
 */
export function compareAnalysisBots(left: AnalysisMatrix, right: AnalysisMatrix): BotAgreement | null {
  if (left.bot === right.bot || (left.era !== null && right.era !== null && left.era !== right.era)) return null
  const rightRows = new Map(right.rows.map((row) => [row.key, row]))
  const changes: BotChange[] = []
  for (const row of left.rows) {
    const other = rightRows.get(row.key)
    if (!other) continue
    const cells = new Map(other.cells.map((cell) => [cell.rival, cell]))
    const common = row.cells.filter((cell) => cell.record && cell.rate && cells.get(cell.rival)?.rate)
    const before = metaScore(common.map((cell) => ({ weight: 1, record: cell.record as GameRecord })))
    const after = metaScore(common.map((cell) => ({ weight: 1, record: cells.get(cell.rival)?.record as GameRecord })))
    if (!before || !after) continue
    const difference = scoreDifference(after, before)
    changes.push({
      key: row.key,
      label: row.label,
      before,
      after,
      difference,
      pValue: difference.se > 0 ? twoSidedP(difference.value / difference.se) : difference.value === 0 ? 1 : 0,
      significant: false,
      rivals: common.length,
      rankBefore: 0,
      rankAfter: 0,
      orientative: Math.min(before.games, after.games) < 30,
    })
  }
  const discoveries = benjaminiHochberg(changes.map((c) => c.pValue))
  for (const [i, change] of changes.entries())
    change.significant =
      !!discoveries[i] &&
      Math.abs(change.difference.value) >= 5 &&
      !change.orientative &&
      left.status === 'done' &&
      right.status === 'done'
  const rank = (value: number, all: number[]) =>
    1 + all.filter((v) => v > value).length + (all.filter((v) => v === value).length - 1) / 2
  for (const change of changes) {
    change.rankBefore = rank(
      change.before.value,
      changes.map((c) => c.before.value),
    )
    change.rankAfter = rank(
      change.after.value,
      changes.map((c) => c.after.value),
    )
  }
  const correlation = bootstrapRankCorrelation(
    changes.map((c) => c.before.value),
    changes.map((c) => c.after.value),
  )
  return {
    left: left.id,
    right: right.id,
    leftBot: left.bot,
    rightBot: right.bot,
    leftEngine: left.engineRev,
    rightEngine: right.engineRev,
    leftStatus: left.status,
    rightStatus: right.status,
    sameEngine: left.engineRev === right.engineRev,
    correlation,
    orientative:
      changes.length < 30 || left.engineRev !== right.engineRev || left.status !== 'done' || right.status !== 'done',
    changes: changes.sort((a, b) => b.difference.value - a.difference.value || a.key.localeCompare(b.key)),
  }
}

/** SQL sufficient statistics, one observation per game, no mirrored double counting. */
export interface GameMoments {
  games: number
  firstWins: number
  secondWins: number
  ties: number
  turnSum: number
  turnSquares: number
  histogram: { turns: number; games: number }[]
}
export interface GameAnalysis {
  coverage: number
  first: WinRate<'simulation'> | null
  second: WinRate<'simulation'> | null
  firstAdvantage: { value: number; ci95: [number, number]; n: number; orientative: boolean } | null
  duration: { mean: number; ci95: [number, number] | null; n: number; orientative: boolean } | null
  histogram: GameMoments['histogram']
  ties: WinRate<'simulation'> | null
}

/** Difference first wins − second wins uses the SAME games, including ties as zero, hence multinomial variance. */
export function analyzeGames(
  record: GameRecord,
  moments: GameMoments,
  durationTotals?: { games: number; turns: number },
): GameAnalysis {
  const n = moments.games
  if (n !== moments.firstWins + moments.secondWins + moments.ties) throw new RangeError('Inconsistent per-game counts')
  const first = simulationRate({ wins: moments.firstWins, losses: moments.secondWins, ties: moments.ties })
  const second = simulationRate({ wins: moments.secondWins, losses: moments.firstWins, ties: moments.ties })
  const value = n ? (moments.firstWins - moments.secondWins) / n : 0
  // Add one pseudo-observation per outcome for a non-degenerate interval at boundaries.
  const p = (moments.firstWins + 1) / (n + 3),
    q = (moments.secondWins + 1) / (n + 3)
  const error = n ? Z_95 * Math.sqrt((p + q - (p - q) ** 2) / n) : 0
  const mean = n ? moments.turnSum / n : 0
  const variance = n > 1 ? Math.max(0, (moments.turnSquares - moments.turnSum ** 2 / n) / (n - 1)) : 0
  const half = Z_95 * Math.sqrt(variance / Math.max(1, n))
  return {
    coverage: n,
    first,
    second,
    firstAdvantage: n
      ? {
          value: value * 100,
          ci95: [Math.max(-1, value - error) * 100, Math.min(1, value + error) * 100],
          n,
          orientative: n < 30,
        }
      : null,
    duration:
      durationTotals && durationTotals.games > n
        ? {
            mean: durationTotals.turns / durationTotals.games,
            ci95: null,
            n: durationTotals.games,
            orientative: durationTotals.games < 30,
          }
        : n
          ? { mean, ci95: n > 1 ? [Math.max(0, mean - half), mean + half] : null, n, orientative: n < 30 }
          : null,
    histogram: moments.histogram,
    ties: simulationRate({ wins: record.ties, losses: record.wins + record.losses, ties: 0 }),
  }
}

export interface DominantMatchup {
  a: string
  b: string
  labelA: string
  labelB: string
  rate: WinRate<'simulation'>
  ties: number
}
export interface MatchupPatterns {
  dominant: DominantMatchup[]
  dominantTotal: number
  cycles: [DominantMatchup, DominantMatchup, DominantMatchup][]
  cyclesTotal: number
}

/** One two-sided test per unordered pairing, BH over ALL played pairings (FDR 5%).
 * Effects need >=55% of decided games, Wilson lower bound >50% and >=30 decided games.
 * Intervals remain pointwise; the selected extremes and cycles are exploratory.
 */
export function matchupPatterns(matrix: AnalysisMatrix): MatchupPatterns {
  const candidates = new Map<string, DominantMatchup>()
  for (const row of matrix.rows)
    for (const cell of row.cells) {
      if (!cell.record) continue
      const { wins, losses, ties } = cell.record
      const rate = simulationRate({ wins: Math.max(wins, losses), losses: Math.min(wins, losses), ties: 0 })
      if (!rate) continue
      const forward = wins >= losses
      candidates.set(JSON.stringify([row.key, cell.rival].sort()), {
        a: forward ? row.key : cell.rival,
        b: forward ? cell.rival : row.key,
        labelA: forward ? row.label : cell.label,
        labelB: forward ? cell.label : row.label,
        rate,
        ties,
      })
    }
  const all = [...candidates.values()]
  const discoveries = benjaminiHochberg(
    all.map(({ rate }) => twoSidedP((rate.value / 100 - 0.5) * 2 * Math.sqrt(rate.games))),
  )
  const edges = new Map<string, DominantMatchup>()
  for (const [i, edge] of all.entries())
    if (discoveries[i] && edge.rate.games >= 30 && edge.rate.value >= 55 && edge.rate.ci95[0] > 50)
      edges.set(`${edge.a}:${edge.b}`, edge)
  const adjacent = new Map<string, DominantMatchup[]>()
  for (const edge of edges.values()) {
    const list = adjacent.get(edge.a) ?? []
    list.push(edge)
    adjacent.set(edge.a, list)
  }
  const cycles: MatchupPatterns['cycles'] = []
  let cyclesTotal = 0
  for (const ab of edges.values())
    for (const bc of adjacent.get(ab.b) ?? []) {
      if (ab.a >= ab.b || ab.a >= bc.b) continue
      const ca = edges.get(`${bc.b}:${ab.a}`)
      if (!ca) continue
      cyclesTotal++
      cycles.push([ab, bc, ca])
      if (cycles.length > 50) {
        cycles.sort((a, b) => Math.min(...b.map((e) => e.rate.ci95[0])) - Math.min(...a.map((e) => e.rate.ci95[0])))
        cycles.pop()
      }
    }
  cycles.sort((a, b) => Math.min(...b.map((e) => e.rate.ci95[0])) - Math.min(...a.map((e) => e.rate.ci95[0])))
  return {
    dominant: [...edges.values()].sort((a, b) => b.rate.ci95[0] - a.rate.ci95[0]).slice(0, 50),
    dominantTotal: edges.size,
    cycles,
    cyclesTotal,
  }
}

export interface AnalysisFinding {
  kind: 'dominant' | 'cycle' | 'bot_change' | 'first' | 'ties'
  text: string
}
const f = (value: number) => value.toLocaleString('es-AR', { maximumFractionDigits: 1 })
const rateText = (rate: WinRate<'simulation'>) =>
  `${f(rate.value)}${PERCENT_ES} (n = ${f(rate.games)}, IC\u00a095${PERCENT_ES} ${f(rate.ci95[0])}–${f(rate.ci95[1])}${PERCENT_ES}${rate.orientative ? ', orientativo' : ''})`
/** Wording always generated from the current input; null evidence cannot create a finding. */
export function analysisFindings(
  patterns: MatchupPatterns,
  games: GameAnalysis,
  agreement: BotAgreement | null,
): AnalysisFinding[] {
  const out: AnalysisFinding[] = patterns.dominant.slice(0, 3).map((edge) => ({
    kind: 'dominant',
    text: `${edge.labelA} supera a ${edge.labelB}: ${rateText(edge.rate)} de partidas decididas; ${f(edge.ties)} empates aparte.`,
  }))
  for (const cycle of patterns.cycles.slice(0, 3))
    out.push({
      kind: 'cycle',
      text: `Ciclo: ${cycle.map((edge) => `${edge.labelA} > ${edge.labelB}: ${rateText(edge.rate)} decididas, ${f(edge.ties)} empates aparte`).join('; ')}.`,
    })
  for (const change of (agreement?.changes ?? [])
    .filter((c) => c.significant)
    .sort((a, b) => Math.abs(b.difference.value) - Math.abs(a.difference.value))
    .slice(0, 3)) {
    out.push({
      kind: 'bot_change',
      text: `${change.label}: ${change.difference.value > 0 ? '+' : ''}${f(change.difference.value)} puntos (${agreement?.rightBot} menos ${agreement?.leftBot}; matrices #${agreement?.left}/${agreement?.right}, motores ${agreement?.leftEngine}/${agreement?.rightEngine}${agreement?.sameEngine ? ', mismo motor' : ', motores distintos'}) (n = ${f(change.before.games)}/${f(change.after.games)}, IC\u00a095${PERCENT_ES} ${f(change.difference.ci95[0])}–${f(change.difference.ci95[1])} puntos${change.orientative ? ', orientativo' : ''}).`,
    })
  }
  if (games.first && games.firstAdvantage && (games.firstAdvantage.ci95[0] > 0 || games.firstAdvantage.ci95[1] < 0))
    out.push({
      kind: 'first',
      text: `Gana quien empieza: ${rateText(games.first)}. Diferencia frente a segundo: ${f(games.firstAdvantage.value)} puntos (IC\u00a095${PERCENT_ES} ${f(games.firstAdvantage.ci95[0])}–${f(games.firstAdvantage.ci95[1])}).`,
    })
  if (games.ties) out.push({ kind: 'ties', text: `Empates: ${rateText(games.ties)}.` })
  return out
}
