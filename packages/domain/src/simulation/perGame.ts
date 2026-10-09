/**
 * Each game of a pairing chunk, by index (H-010, T-017 A2). A job with `params.perGame: true` asks engine-cli for it
 * (`perGame` in the simulate job); the worker (0.2.5 on) sends it as `extra.perGame` of the chunk result and the API
 * keeps it in `simulation_chunks.extra`. Game `i` of a chunk played with `gameSeed(chunk.seed, i)`: two chunks with the
 * same seed — a Laboratorio variant and the list it came from, against the same rival — shuffled the same way game by
 * game, which is what a paired comparison needs.
 *
 * Compact on purpose (a 1.000-game chunk is ~8 KB): one character per game, game 0 first, except `turns`.
 */

export interface PerGameResults {
  /** «A» deck A won, «B» deck B won, «T» tie. */
  winners: string
  /** Who played turn 1: «A» or «B». */
  starters: string
  /** «P» the winner reached 3 points, «N» the loser had no Pokémon in play, «L» tie at the 30-turn limit, «T» other tie. */
  endings: string
  /** Turns played (deckgym's global count: both players' turns, 31 at the limit). */
  turns: number[]
  /** Highest stage deck A had in play: «0» only Basic Pokémon, «1», «2». */
  stagesA: string
  /** The same for deck B. */
  stagesB: string
}

export type PerGameEnding = 'points' | 'no_pokemon' | 'turn_limit' | 'tie'

const ENDINGS: Record<string, PerGameEnding> = { P: 'points', N: 'no_pokemon', L: 'turn_limit', T: 'tie' }

/** One game of a chunk, decoded. */
export interface PerGameEntry {
  index: number
  winner: 'a' | 'b' | 'tie'
  starter: 'a' | 'b'
  ending: PerGameEnding
  turns: number
  stageA: number
  stageB: number
}

/** Workers from this version on forward `perGame`, and engines (`cliVersion`) from this one play it; the queue gives
 * those jobs only to a worker with both. */
export const PER_GAME_WORKER_VERSION = '0.2.5'
export const PER_GAME_CLI_VERSION = '0.2.0'

/** Whether a job asked for per-game results (`params.perGame: true`). */
export function wantsPerGame(params: unknown): boolean {
  return (params as { perGame?: unknown } | null)?.perGame === true
}

/**
 * Checks what a worker sent against the chunk's tallies; null when it is right, else why not (in Spanish, for the
 * 400 the API answers).
 */
export function checkPerGame(
  value: unknown,
  expected: { games: number; winsA: number; winsB: number; ties: number; turns?: number | undefined },
): string | null {
  if (typeof value !== 'object' || value === null) return 'falta perGame.'
  const results = value as Partial<Record<keyof PerGameResults, unknown>>
  const { games } = expected
  const letters: [keyof PerGameResults, RegExp][] = [
    ['winners', /^[ABT]*$/],
    ['starters', /^[AB]*$/],
    ['endings', /^[PNLT]*$/],
    ['stagesA', /^[0-9]*$/],
    ['stagesB', /^[0-9]*$/],
  ]
  for (const [field, pattern] of letters) {
    const text = results[field]
    if (typeof text !== 'string' || text.length !== games || !pattern.test(text)) {
      return `perGame.${field} tiene que tener ${games} letras válidas.`
    }
  }
  const turns = results.turns
  if (!Array.isArray(turns) || turns.length !== games || !turns.every((t) => Number.isInteger(t) && t >= 0)) {
    return `perGame.turns tiene que tener ${games} enteros.`
  }
  const winners = results.winners as string
  const count = (letter: string) => [...winners].filter((c) => c === letter).length
  if (count('A') !== expected.winsA || count('B') !== expected.winsB || count('T') !== expected.ties) {
    return 'perGame.winners no coincide con winsA, winsB y ties.'
  }
  if (expected.turns !== undefined && (turns as number[]).reduce((sum, t) => sum + t, 0) !== expected.turns) {
    return 'perGame.turns no suma los turnos del chunk.'
  }
  const endings = results.endings as string
  for (let i = 0; i < games; i++) {
    const tie = winners[i] === 'T'
    const tieEnding = endings[i] === 'L' || endings[i] === 'T'
    if (tie !== tieEnding) return `perGame: la partida ${i} no termina como dice su resultado.`
    // deckgym ties a game when turn 31 begins, and only then: «L» if and only if more than 30 turns were played.
    if ((endings[i] === 'L') !== (turns[i] as number) > 30) {
      return `perGame: la partida ${i} no coincide con el límite de 30 turnos.`
    }
  }
  return null
}

/** The per-game results kept with a chunk (`simulation_chunks.extra`), or null when it has none or they are bad. */
export function readPerGame(extra: unknown): PerGameResults | null {
  const value = (extra as { perGame?: unknown } | null)?.perGame
  if (typeof value !== 'object' || value === null) return null
  const results = value as PerGameResults
  if (typeof results.winners !== 'string') return null
  const games = results.winners.length
  const ties = [...results.winners].filter((c) => c === 'T').length
  const winsA = [...results.winners].filter((c) => c === 'A').length
  return checkPerGame(results, { games, winsA, winsB: games - winsA - ties, ties }) === null ? results : null
}

/** Every game of a chunk, decoded. */
export function perGameEntries(results: PerGameResults): PerGameEntry[] {
  return [...results.winners].map((winner, index) => ({
    index,
    winner: winner === 'A' ? 'a' : winner === 'B' ? 'b' : 'tie',
    starter: results.starters[index] === 'A' ? 'a' : 'b',
    ending: ENDINGS[results.endings[index] ?? 'T'] ?? 'tie',
    turns: results.turns[index] ?? 0,
    stageA: Number(results.stagesA[index] ?? 0),
    stageB: Number(results.stagesB[index] ?? 0),
  }))
}
