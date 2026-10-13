/**
 * `simulations_calibration` (R-012, P-009): the calibrations as Claude reads them, from the same views as
 * `GET /api/calibration` and `GET /api/calibration/:id`. Every rate and correlation carries its Spanish `text` with
 * its n and interval; the simulation and the tournaments stay two numbers, never one.
 */
import {
  type CalibrationRow,
  formatIntervalEs,
  formatPercentEs,
  type RankCorrelation,
  type WeightedRate,
} from '@tcg/domain'
import type { CalibrationJobView, CalibrationSummaryView, CalibrationView } from '../simulation/calibration.service.js'
import { rateView } from './mcp-json.js'

type Json = Record<string, unknown>

const decimal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const points = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
const count = new Intl.NumberFormat('es-AR')
const round = (value: number) => Math.round(value * 100) / 100

const STATUS_ES = {
  queued: 'en cola',
  running: 'corriendo',
  done: 'terminada',
  failed: 'falló',
  cancelled: 'cancelada',
}

const NOTE =
  'Simulación (bots) y torneos (Limitless) son fuentes separadas: cada una con su n e intervalo, nunca combinadas en un número. Todo por partida y sin empates (los del motor salen del límite de turnos y se cuentan aparte). Las partidas de torneo se toman como independientes, así que su intervalo puede ser un poco angosto. Los números de bots son pistas, no lo que pasa en el juego.'

/** «ρ = 0,45 (IC 0,12–0,69; 40 pares, bootstrap de arquetipos)». */
function correlationJson(correlation: RankCorrelation | null, unit: string): Json | null {
  if (!correlation) return null
  const method = correlation.method === 'bootstrap' ? 'bootstrap de arquetipos' : 'Fisher z'
  const interval = correlation.ci95
    ? `IC ${decimal.format(correlation.ci95[0])}–${decimal.format(correlation.ci95[1])}; `
    : ''
  return {
    rho: round(correlation.rho),
    n: correlation.n,
    ci95: correlation.ci95 ? [round(correlation.ci95[0]), round(correlation.ci95[1])] : null,
    method: correlation.method,
    text: `ρ = ${decimal.format(correlation.rho)} (${interval}${correlation.n} ${unit}, ${method})`,
  }
}

/** A weighted mean of rates: «55,6 % (n = 120, IC 47,2–64,0 %, orientativo)». */
function weightedJson(rate: WeightedRate | null): Json | null {
  if (!rate) return null
  const parts = [`n = ${count.format(rate.games)}`, `IC ${formatIntervalEs(rate.ci95)}`]
  if (rate.orientative) parts.push('orientativo')
  return {
    value: round(rate.value),
    games: rate.games,
    ci95: [round(rate.ci95[0]), round(rate.ci95[1])],
    orientative: rate.orientative,
    text: `${formatPercentEs(rate.value)} (${parts.join(', ')})`,
  }
}

function summaryText(summary: {
  compared: number
  compatible: number
  meanAbsDifference: number | null
  rankCorrelation: RankCorrelation | null
}): string {
  if (summary.compared === 0) return 'Ningún par de arquetipos con partidas de torneo suficientes.'
  const mean =
    summary.meanAbsDifference === null ? '—' : `${points.format(summary.meanAbsDifference).replace('+', '')} puntos`
  const order = correlationJson(summary.rankCorrelation, 'puntos')?.text ?? 'sin datos suficientes'
  return `Compatibles con el torneo: ${summary.compatible} de ${summary.compared} pares; diferencia media (valor absoluto) ${mean}; orden de los pares: ${order}.`
}

function jobJson(job: CalibrationJobView): Json {
  return {
    id: job.id,
    status: STATUS_ES[job.status],
    bot: job.bot,
    botEs: job.botEs,
    era: job.era,
    format: job.format,
    engineRev: job.engineRev.slice(0, 7),
    gamesPerPairing: job.gamesPerPair,
    lists: job.lists,
    progress: {
      games: job.progress.gamesDone,
      totalGames: job.progress.totalGames,
      chunksDone: job.progress.chunks.done,
      chunks: job.progress.chunks.total,
      failed: job.progress.chunks.failed,
    },
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}

/** The list: every calibration with the summary of the finished ones. */
export function calibrationListJson(list: readonly CalibrationSummaryView[]): Json {
  return {
    calibrations: list.map((item) => ({
      ...jobJson(item),
      failedPairings: item.failed,
      cancelledPairings: item.cancelled,
      summary: item.summary
        ? {
            compared: item.summary.compared,
            compatible: item.summary.compatible,
            meanAbsDifference: item.summary.meanAbsDifference === null ? null : round(item.summary.meanAbsDifference),
            rankCorrelation: correlationJson(item.summary.rankCorrelation, 'puntos'),
            text: summaryText(item.summary),
          }
        : null,
    })),
    note: `${NOTE} Con id, el informe de una.`,
  }
}

function rowJson(row: CalibrationRow): Json {
  return {
    pair: `${row.labelA} vs ${row.labelB}`,
    a: row.a,
    b: row.b,
    simulated: rateView(row.simulated),
    ties: row.ties,
    tournament: rateView(row.tournament),
    difference:
      row.difference === null
        ? null
        : {
            value: round(row.difference),
            ci95: row.differenceCi95 ? [round(row.differenceCi95[0]), round(row.differenceCi95[1])] : null,
            text: `${points.format(row.difference)} puntos${row.differenceCi95 ? ` (IC ${points.format(row.differenceCi95[0])} a ${points.format(row.differenceCi95[1])})` : ''}, simulado menos torneo`,
          },
    compatible: row.compatible,
  }
}

/** Pairs of a full report's page by default: with 25 archetypes all 300 of them are ~160 KB, past what a tool returns. */
export const CALIBRATION_FULL_PAGE = 50

/**
 * One report: compact keeps the `limit` compared pairs that differ most; full, every pair, a page at a time (`offset`,
 * `limit`) in the report's order.
 */
export function calibrationReportJson(
  view: CalibrationView,
  options: { limit: number; offset: number; full: boolean },
): Json {
  const { report } = view
  const compared = report.rows.filter((row) => row.compatible !== null)
  const total = report.rows.length
  const rows = options.full
    ? report.rows.slice(options.offset, options.offset + options.limit)
    : [...compared].sort((x, y) => Math.abs(y.difference ?? 0) - Math.abs(x.difference ?? 0)).slice(0, options.limit)
  const next = options.full && options.offset + rows.length < total ? options.offset + rows.length : null
  return {
    job: jobJson(view.job),
    tournaments: {
      ...view.tournaments,
      text: `Torneos de Limitless: era ${view.tournaments.era} (${view.tournaments.format}), ${count.format(Math.round(view.tournaments.matches))} partidas de ${view.tournaments.tournamentsWithPairings} torneos con rondas.`,
    },
    coverage: {
      pairs: report.rows.length,
      compared: report.compared,
      minTournamentGames: report.minTournamentGames,
      pending: view.pending,
      failed: view.failed,
      cancelled: view.cancelled,
      mirrors: view.mirrors,
      incompletePairs: view.incompletePairs,
      text: `${report.compared} de ${report.rows.length} pares de arquetipos con ${report.minTournamentGames} partidas de torneo o más${view.incompletePairs > 0 ? `; ${view.incompletePairs} pares afuera porque les falta algún cruce de listas` : ''}; cruces pendientes ${view.pending}, fallados ${view.failed}, cancelados ${view.cancelled}, espejos sin comparar ${view.mirrors}.`,
    },
    summary: {
      compared: report.compared,
      compatible: report.compatible,
      meanAbsDifference: report.meanAbsDifference === null ? null : round(report.meanAbsDifference),
      rankCorrelation: correlationJson(report.rankCorrelation, 'puntos'),
      archetypeCorrelation: correlationJson(report.archetypeCorrelation, 'arquetipos'),
      text: `${summaryText(report)} Orden de los arquetipos contra el banco: ${correlationJson(report.archetypeCorrelation, 'arquetipos')?.text ?? 'sin datos suficientes'}.`,
    },
    archetypes: report.archetypes.map((archetype) => ({
      id: archetype.id,
      label: archetype.label,
      rivals: archetype.rivals,
      simulated: weightedJson(archetype.simulated),
      tournament: weightedJson(archetype.tournament),
    })),
    pairs: rows.map(rowJson),
    pairsShown: !options.full
      ? `los ${rows.length} de ${compared.length} comparados con más diferencia; detail full para todos`
      : rows.length === total
        ? `todos (${total})`
        : rows.length === 0
          ? `ninguno: el informe tiene ${total} pares`
          : `los pares ${options.offset + 1} a ${options.offset + rows.length} de ${total}${next === null ? '' : `; offset ${next} para seguir`}`,
    ...(options.full ? { page: { offset: options.offset, limit: options.limit, total, next } } : {}),
    note: NOTE,
  }
}
