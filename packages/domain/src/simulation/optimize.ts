/**
 * «Optimizar» (H-050): which candidates the engine gets and how many combinations it will play.
 *
 * deckgym (`generate_valid_combinations`) combines the candidates without using a position twice, then drops the
 * repeated combinations and the ones that break the deck. So a card goes as many times as copies of it could still
 * enter: with two places free and one candidate X, «X + X» is a combination too. Never more than the deck allows of
 * a name (`MAX_COPIES_PER_NAME`, counting the copies it keeps); the engine checks the rest of the rules (a Basic
 * Pokémon, the Energy) and may play fewer.
 */
import { MAX_COPIES_PER_NAME } from '../decks/validate.js'

/** A card «optimizar» may add: the id the engine plays and the name the deck rules count copies by. */
export interface OptimizeCandidate {
  readonly id: string
  readonly name: string
}

/** The candidates without repeated ids, grouped by name, and how many copies of each name still fit. */
function groups(candidates: readonly OptimizeCandidate[], kept: ReadonlyMap<string, number>, missing: number) {
  const byName = new Map<string, string[]>()
  for (const { id, name } of candidates) {
    const ids = byName.get(name) ?? []
    if (!ids.includes(id)) ids.push(id)
    byName.set(name, ids)
  }
  return [...byName].map(([name, ids]) => ({
    ids,
    room: Math.max(0, Math.min(missing, MAX_COPIES_PER_NAME - (kept.get(name) ?? 0))),
  }))
}

/**
 * The list the engine gets: each candidate as many times as copies of its name still fit, side by side (deckgym
 * drops the repeated combinations). A candidate whose name is already full does not go.
 */
export function optimizeEngineCandidates(
  candidates: readonly OptimizeCandidate[],
  kept: ReadonlyMap<string, number>,
  missing: number,
): string[] {
  return groups(candidates, kept, missing).flatMap(({ ids, room }) =>
    ids.flatMap((id) => Array.from({ length: room }, () => id)),
  )
}

/** Multisets of size k from n kinds: C(n + k − 1, k). */
function multisets(n: number, k: number): number {
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n + i - 1)) / i
  return Math.round(result)
}

/**
 * How many combinations the engine plays: the ways to fill `missing` places with the candidates, repeating them,
 * with no name past its copies. Before H-050 the count repeated with no limit, and the engine did not repeat.
 */
export function optimizeCombinations(
  candidates: readonly OptimizeCandidate[],
  kept: ReadonlyMap<string, number>,
  missing: number,
): number {
  if (missing <= 0) return 0
  // ways[m]: the ways to take m cards from the names seen so far.
  let ways = [1, ...Array.from({ length: missing }, () => 0)]
  for (const { ids, room } of groups(candidates, kept, missing)) {
    const next = ways.map(() => 0)
    for (let taken = 0; taken <= missing; taken++) {
      if (!ways[taken]) continue
      for (let more = 0; more <= room && taken + more <= missing; more++) {
        next[taken + more] = (next[taken + more] ?? 0) + (ways[taken] ?? 0) * multisets(ids.length, more)
      }
    }
    ways = next
  }
  return ways[missing] ?? 0
}

/** The job's own limit: more combinations are refused before queuing. */
export const OPTIMIZE_MAX_COMBINATIONS = 200

/**
 * deckgym builds every combination of the list's positions before dropping the repeated ones (C(list, places)): past
 * this it would take seconds and hundreds of MB before the first game (a phone worker runs out of memory), even when
 * what is left is under the limit. With one id per card that plays the same (the API merges editions of one
 * functional group) it is only reached with many cards that share a name.
 */
export const OPTIMIZE_MAX_ENGINE_WORK = 500_000

/** C(n, k), the combinations of positions deckgym builds. */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= Math.min(k, n - k); i++) result = (result * (n - i + 1)) / i
  return Math.round(result)
}

export interface OptimizePlan {
  /** What engine-cli gets as its candidates. */
  readonly list: string[]
  readonly combinations: number
  /** Why the job would be refused (in Spanish, for the screen and Claude), or null. */
  readonly problem: string | null
}

const countFormat = new Intl.NumberFormat('es-AR')

/** The candidates' list, its combinations, and why it cannot be played, if so: the same for the preview and the job. */
export function optimizePlan(
  candidates: readonly OptimizeCandidate[],
  kept: ReadonlyMap<string, number>,
  missing: number,
): OptimizePlan {
  const list = optimizeEngineCandidates(candidates, kept, missing)
  const combinations = optimizeCombinations(candidates, kept, missing)
  const room = groups(candidates, kept, missing).reduce((sum, group) => sum + group.room, 0)
  const problem =
    missing <= 0
      ? 'Sacá al menos una carta para optimizar.'
      : candidates.length === 0
        ? 'Elegí cartas candidatas.'
        : room === 0
          ? 'Ninguna candidata entra: el mazo ya lleva 2 copias de cada una. Elegí otras o sacá esas.'
          : combinations === 0
            ? `Con estas candidatas no se llenan los ${missing} lugares: cada carta entra como mucho 2 veces, contando las que quedan en el mazo. Sumá candidatas o sacá menos cartas.`
            : combinations > OPTIMIZE_MAX_COMBINATIONS
              ? `${countFormat.format(combinations)} combinaciones posibles superan el límite de ${OPTIMIZE_MAX_COMBINATIONS}: elegí menos candidatas o sacá menos cartas.`
              : binomial(list.length, missing) > OPTIMIZE_MAX_ENGINE_WORK
                ? `Para encontrar estas ${combinations} combinaciones el motor tendría que armar ${countFormat.format(binomial(list.length, missing))}: elegí menos candidatas con el mismo nombre o sacá menos cartas.`
                : null
  return { list, combinations, problem }
}

/** «2 Erika, Sabrina»: the cards of a combination, with two copies of one said once (H-050). */
export function combinationNamesEs(names: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, count]) => (count > 1 ? `${count} ${name}` : name)).join(', ')
}
