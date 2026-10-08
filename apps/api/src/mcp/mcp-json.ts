/** Shapes the MCP tools share: rates and simulation jobs as the model reads them. */
import { formatWinRateEs, type WinRate } from '@tcg/domain'
import type { JobSummaryView } from '../simulation/simulation-views.js'

type Json = Record<string, unknown>

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** A rate as the tools return it: rounded numbers plus the canonical Spanish text. */
export function rateView(rate: WinRate | null): Json | null {
  if (!rate) return null
  return {
    text: formatWinRateEs(rate),
    value: round(rate.value),
    games: rate.games,
    ci95: [round(rate.ci95[0]), round(rate.ci95[1])],
    orientative: rate.orientative,
    source: rate.source,
  }
}

/** A job as the tools return it: what was played, with which bots, n, seed and engine, and how far it got. */
export function jobSummaryJson(job: JobSummaryView): Json {
  return {
    id: job.id,
    label: job.label,
    kind: {
      matrix: 'matriz',
      compare: 'comparar',
      optimize: 'optimizar',
      explore: 'explorar (laboratorio)',
      consistency: 'consistencia',
    }[job.kind],
    status: { queued: 'en cola', running: 'corriendo', done: 'terminada', failed: 'falló', cancelled: 'cancelada' }[
      job.status
    ],
    bots: job.playersEs,
    gamesPerPairing: job.gamesPerPair,
    seed: job.baseSeed,
    engineRev: job.engineRev.slice(0, 7),
    progress: {
      games: job.progress.gamesDone,
      totalGames: job.progress.totalGames,
      pairingsDone: job.progress.chunks.done,
      pairings: job.progress.chunks.total,
      failed: job.progress.chunks.failed,
    },
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}
