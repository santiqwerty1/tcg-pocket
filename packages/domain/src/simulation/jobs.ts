/**
 * Simulation jobs (PLAN §3.7, BRIEF M7): what is queued, split into chunks the worker plays one at a time.
 * - matrix: every deck of side A against every deck of side B; when both sides are the same set, unordered pairs
 *   (40 decks → 780 pairings; the engine draws who starts), optionally both orders.
 * - compare: variants (or revisions) of a deck against a group of rivals, one row per variant.
 * - optimize: fill the open slots of a deck with candidate cards, against a group of rivals (one chunk).
 * - explore: the Laboratorio's automatic search (T-008, lab/explore.ts): rounds of variants against the meta bank,
 *   queued by the API one round at a time.
 * - consistency: how soon one deck has its key attacker ready, in goldfish games (Fase 8, simulation/consistency.ts).
 * A pairing with many games is split so a chunk stays short (heartbeats, resuming after the PC is turned off).
 */

export const SIMULATION_KINDS = ['matrix', 'compare', 'optimize', 'explore', 'consistency'] as const
export type SimulationKind = (typeof SIMULATION_KINDS)[number]
/** What POST /api/simulations queues: explore jobs start from the Laboratorio. */
export const QUEUEABLE_SIMULATION_KINDS = ['matrix', 'compare', 'optimize'] as const

/** Bots of deckgym that can play unattended, with what they are. */
export const BOT_LABEL_ES: Record<string, string> = {
  r: 'al azar',
  w: 'al azar ponderado',
  aa: 'adjunta y ataca',
  et: 'termina el turno',
  v: 'función de valor',
  er: 'evoluciona primero',
  m: 'MCTS (100 iteraciones)',
  e1: 'expectiminimax, profundidad 1',
  e2: 'expectiminimax, profundidad 2',
  e3: 'expectiminimax, profundidad 3',
  e4: 'expectiminimax, profundidad 4',
}

/** `r`, `e2`… (deckgym's codes without the human and external players): the one list every schema checks against. */
export const BOT_CODE_PATTERN = /^(r|w|aa|et|v|er|m|e[1-9])$/

export function isBotCode(code: string): boolean {
  return BOT_CODE_PATTERN.test(code)
}

export function botLabel(code: string): string {
  return BOT_LABEL_ES[code] ?? code
}

export interface Pairing {
  /** Snapshot ids. */
  a: number
  b: number
}

/** Every A × B pairing; with the same set on both sides, unordered pairs (and both orders when `bothOrders`). */
export function matrixPairings(sideA: readonly number[], sideB: readonly number[], bothOrders = false): Pairing[] {
  const a = [...new Set(sideA)]
  // No rivals: side A against itself.
  const b = sideB.length === 0 ? a : [...new Set(sideB)]
  const same = a.length === b.length && a.every((id) => b.includes(id))
  const pairings: Pairing[] = []
  if (same) {
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        pairings.push({ a: a[i] as number, b: a[j] as number })
        if (bothOrders) pairings.push({ a: a[j] as number, b: a[i] as number })
      }
    }
    return pairings
  }
  for (const x of a) for (const y of b) if (x !== y) pairings.push({ a: x, b: y })
  return pairings
}

/** Every variant against every rival (a variant that is also a rival is not played against itself). */
export function comparePairings(variants: readonly number[], rivals: readonly number[]): Pairing[] {
  const pairings: Pairing[] = []
  for (const a of new Set(variants)) for (const b of new Set(rivals)) if (a !== b) pairings.push({ a, b })
  return pairings
}

/**
 * Replays kept per pairing when the request does not say: one in a matrix (a 40-deck matrix is 780 pairings, ~6 MB
 * with one each; two each filled 61 MB of the database for matrix #4) and two in a comparison.
 */
export function defaultReplaySample(kind: SimulationKind): number {
  return kind === 'matrix' ? 1 : 2
}

/** Games per chunk at most: a chunk of e2 bots takes about a minute on two threads. */
export const MAX_GAMES_PER_CHUNK = 1000

export interface ChunkPlan {
  idx: number
  a: number
  b: number
  games: number
  /** Index of the first game of the pairing this chunk plays (0 unless a pairing is split). */
  firstGame: number
}

/** Chunks of a list of pairings with `games` games each. */
export function planChunks(
  pairings: readonly Pairing[],
  games: number,
  maxPerChunk = MAX_GAMES_PER_CHUNK,
): ChunkPlan[] {
  const chunks: ChunkPlan[] = []
  for (const pairing of pairings) {
    for (let first = 0; first < games; first += maxPerChunk) {
      chunks.push({
        idx: chunks.length,
        a: pairing.a,
        b: pairing.b,
        games: Math.min(maxPerChunk, games - first),
        firstGame: first,
      })
    }
  }
  return chunks
}

/**
 * Rough wall time on the owner's PC (DECISIONES 6.15 and 9.1): 10.000 r,r in 14 s on two threads ⇒ ~1,4 ms per
 * game. e2: the 40-deck matrix on 8 threads took 52 min of engine time at fb792eb, 37 % of it in the pairings
 * against one deck whose search exploded; deckgym 33ff2a5 caps that search (8–10 times faster there), which puts
 * the matrix near 35 min ⇒ 50 ms per game and thread. e3 ≈ 1,6 × e2. A guide for the confirmation screen, not a
 * promise: some pairings take much longer than others.
 */
export function estimateSeconds(totalGames: number, players: readonly [string, string], cores: number): number {
  const cost = (code: string): number => {
    if (code === 'r' || code === 'w' || code === 'aa' || code === 'et' || code === 'er') return 0.0015
    if (code === 'v') return 0.004
    if (code === 'm') return 0.2
    const depth = /^e(\d)$/.exec(code)?.[1]
    if (depth === undefined) return 0.05
    return 0.05 * 1.6 ** (Number(depth) - 2)
  }
  const perGame = Math.max(cost(players[0]), cost(players[1])) * 2
  return (totalGames * perGame) / Math.max(1, cores)
}
