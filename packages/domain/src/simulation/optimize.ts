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

/** The copies of each name the deck keeps, from its deckgym text («2 Bulbasaur A1 1»), minus the ones taken out. */
export function keptCopiesByName(deckgymText: string, removed: ReadonlyMap<string, number>): Map<string, number> {
  const kept = new Map<string, number>()
  for (const line of deckgymText.split('\n')) {
    const match = /^(\d+)\s+(.+?)\s+\S+\s+\S+$/.exec(line.trim())
    if (!match || line.startsWith('Energy:')) continue
    const name = match[2] ?? ''
    kept.set(name, (kept.get(name) ?? 0) + Number(match[1]))
  }
  for (const [name, count] of removed) {
    const left = (kept.get(name) ?? 0) - count
    if (left > 0) kept.set(name, left)
    else kept.delete(name)
  }
  return kept
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
