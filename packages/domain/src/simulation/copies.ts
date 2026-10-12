/**
 * Phase 42, «repetir los últimos» (decided by the Coordinator on 12/10): near the end of a job, a worker with nothing
 * to do plays again a chunk another worker holds, and the first result counts (the same seed gives the same games).
 * Only when the one asking would finish first by its own pace: the PC copies what the phone plays, never the other
 * way round (it would cost the phone battery and heat for nothing).
 */

/** A holder with this little left is not copied: it finishes about as soon as a copy would start. */
export const COPY_MIN_LEFT_MS = 60_000
/** Without the pace of the one asking, only a holder with this much left is copied. */
export const COPY_UNKNOWN_PACE_LEFT_MS = 10 * 60_000
/** The one asking has to finish in less than this part of what the holder has left. */
export const COPY_FASTER = 0.8
/**
 * A holder plays its games `cores` at a time: until it finished this many rounds of them, its progress says little
 * (one slow game in flight looks like a slow worker).
 */
export const COPY_PROGRESS_ROUNDS = 2

/** What a holder plays: one chunk, or the chunks of one job it plays in a single engine run (a batch). */
export interface CopyUnit {
  games: number
  gamesDone: number
  /** Since the holder took it (the oldest chunk of a batch). */
  elapsedMs: number
  /** How many games the holder plays at once. */
  holderCores: number
  /** The holder's pace from chunks it finished (the same job, or the same bots), ms per game; null without any. */
  holderMsPerGame: number | null
}

/**
 * What the holder has left: by its pace from finished chunks, and by its progress on this one once it is past a couple
 * of rounds of games; with both, the smaller (a copy is only worth it when the holder is clearly slower). Null when
 * neither says anything: nothing is copied on a guess (review of #73: a phone copied the PC that had said nothing
 * yet, and a progress reset by a retried batch looked like a slow worker).
 */
export function holderLeftMs(unit: CopyUnit): number | null {
  const left = unit.games - unit.gamesDone
  const estimates: number[] = []
  if (unit.holderMsPerGame !== null) estimates.push(left * unit.holderMsPerGame)
  if (unit.gamesDone > COPY_PROGRESS_ROUNDS * Math.max(1, unit.holderCores)) {
    estimates.push((left * unit.elapsedMs) / unit.gamesDone)
  }
  return estimates.length > 0 ? Math.min(...estimates) : null
}

/** Milliseconds per game, from finished chunks; null without any that says it (a duration of 0 says nothing). */
export function paceMsPerGame(chunks: readonly { games: number; durationMs: number | null }[]): number | null {
  let games = 0
  let ms = 0
  for (const chunk of chunks) {
    if (chunk.durationMs === null || !(chunk.durationMs > 0) || !(chunk.games > 0)) continue
    games += chunk.games
    ms += chunk.durationMs
  }
  return games > 0 ? ms / games : null
}

/**
 * The unit to copy, if any: one the one asking would finish in less than `COPY_FASTER` of what its holder has left
 * (without its pace, one with more than `COPY_UNKNOWN_PACE_LEFT_MS` left), never one about to end nor one whose holder
 * says nothing yet; among several, the one with the most left.
 */
export function pickCopy<T extends CopyUnit>(units: readonly T[], askerMsPerGame: number | null): T | null {
  let best: T | null = null
  let bestLeft = -1
  for (const unit of units) {
    const left = holderLeftMs(unit)
    if (left === null || left <= COPY_MIN_LEFT_MS) continue
    const faster =
      askerMsPerGame === null ? left > COPY_UNKNOWN_PACE_LEFT_MS : unit.games * askerMsPerGame < COPY_FASTER * left
    if (faster && left > bestLeft) {
      best = unit
      bestLeft = left
    }
  }
  return best
}
