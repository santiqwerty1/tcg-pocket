/**
 * Phase 42 (the Coordinator's «medir primero», 12/10): how each worker spends its time, from the chunks it finished.
 * A claim is what a worker took at once (one chunk, or a batch of one job taken together); for each, the engine's
 * time, the wall time from taking it to its last result, and the gap until the worker's next claim. «Dos lugares por
 * worker» (asking for the next chunk ahead) pays only if those gaps are large next to the engine's time.
 */

export interface TimedChunk {
  workerId: string
  /** When the worker took it (`leased_at`; before that column, the first lease). */
  takenAt: Date
  finishedAt: Date
  /** The engine's time for the chunk, as the worker said it (a batch's time shared by games). */
  durationMs: number | null
  games: number
}

export interface Spread {
  median: number
  p90: number
}

export interface WorkerTiming {
  workerId: string
  chunks: number
  games: number
  claims: number
  /** Per claim. */
  engineMs: Spread | null
  wallMs: Spread | null
  /** Wall time the engine did not account for, per claim (taking, uploading, starting the engine). */
  overheadMs: Spread | null
  /** From a claim's last result to the next claim, under an hour (more is a worker with nothing to do, not overhead). */
  gapMs: Spread | null
}

/** Chunks a worker took within this of the first one are one claim (a batch: `claimMore` may land a second later). */
export const TIMING_CLAIM_WINDOW_MS = 5000
/** A gap longer than this is the worker idle, not the cost of asking for more. */
export const TIMING_IDLE_MS = 60 * 60 * 1000

function spread(values: readonly number[]): Spread | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number
  const middle = sorted.length / 2
  const median =
    sorted.length % 2 === 1
      ? (sorted[Math.floor(middle)] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
  return { median, p90: at(0.9) }
}

/** Each worker's timing, busiest first. Chunks taken within a few seconds by the same worker are one claim. */
export function workerTiming(chunks: readonly TimedChunk[]): WorkerTiming[] {
  const byWorker = new Map<string, TimedChunk[]>()
  for (const chunk of chunks) byWorker.set(chunk.workerId, [...(byWorker.get(chunk.workerId) ?? []), chunk])
  const out: WorkerTiming[] = []
  for (const [workerId, own] of byWorker) {
    const ordered: { takenAt: number; finishedAt: number; engineMs: number; timed: boolean }[] = []
    for (const chunk of [...own].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())) {
      const taken = chunk.takenAt.getTime()
      let claim = ordered.at(-1)
      if (!claim || taken - claim.takenAt > TIMING_CLAIM_WINDOW_MS) {
        claim = { takenAt: taken, finishedAt: 0, engineMs: 0, timed: true }
        ordered.push(claim)
      }
      claim.finishedAt = Math.max(claim.finishedAt, chunk.finishedAt.getTime())
      if (chunk.durationMs === null) claim.timed = false
      else claim.engineMs += chunk.durationMs
    }
    const timed = ordered.filter((claim) => claim.timed)
    const gaps: number[] = []
    for (let i = 1; i < ordered.length; i++) {
      const gap = (ordered[i] as { takenAt: number }).takenAt - (ordered[i - 1] as { finishedAt: number }).finishedAt
      if (gap >= 0 && gap < TIMING_IDLE_MS) gaps.push(gap)
    }
    out.push({
      workerId,
      chunks: own.length,
      games: own.reduce((sum, chunk) => sum + chunk.games, 0),
      claims: ordered.length,
      engineMs: spread(timed.map((claim) => claim.engineMs)),
      wallMs: spread(ordered.map((claim) => claim.finishedAt - claim.takenAt)),
      overheadMs: spread(timed.map((claim) => Math.max(0, claim.finishedAt - claim.takenAt - claim.engineMs))),
      gapMs: spread(gaps),
    })
  }
  return out.sort((a, b) => b.chunks - a.chunks)
}
