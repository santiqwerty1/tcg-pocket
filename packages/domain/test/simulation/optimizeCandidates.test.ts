import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/lab/mutate.js'
import {
  keptCopiesByName,
  type OptimizeCandidate,
  optimizeCombinations,
  optimizeEngineCandidates,
} from '../../src/simulation/optimize.js'

const card = (id: string, name = id): OptimizeCandidate => ({ id, name })
const none = new Map<string, number>()

/**
 * What deckgym 33ff2a5 does with the list (`generate_valid_combinations`): every k-combination of positions, the
 * repeated ones dropped, then the ones with a name past 2 copies (kept ones counted). Written apart from the code
 * under test, so the count is checked against the engine's way and not against itself.
 */
function deckgymCombinations(
  list: readonly string[],
  k: number,
  nameOf: (id: string) => string,
  kept: Map<string, number>,
) {
  const out = new Set<string>()
  const walk = (start: number, current: string[]) => {
    if (current.length === k) {
      const names = new Map(kept)
      for (const id of current) names.set(nameOf(id), (names.get(nameOf(id)) ?? 0) + 1)
      if ([...names.values()].every((count) => count <= 2)) out.add([...current].sort().join('+'))
      return
    }
    for (let i = start; i < list.length; i++) walk(i + 1, [...current, list[i] as string])
  }
  walk(0, [])
  return out
}

describe('«optimizar» with two copies of a candidate (H-050)', () => {
  it('two places and one candidate: «X + X» is a combination', () => {
    const candidates = [card('X')]
    expect(optimizeEngineCandidates(candidates, none, 2)).toEqual(['X', 'X'])
    expect(optimizeCombinations(candidates, none, 2)).toBe(1)
    expect(deckgymCombinations(['X', 'X'], 2, (id) => id, none)).toEqual(new Set(['X+X']))
    // Before, the engine got [X] once and played nothing.
    expect(deckgymCombinations(['X'], 2, (id) => id, none).size).toBe(0)
  })

  it('two candidates for two places: X + X, X + Y and Y + Y', () => {
    const candidates = [card('X'), card('Y')]
    expect(optimizeEngineCandidates(candidates, none, 2)).toEqual(['X', 'X', 'Y', 'Y'])
    expect(optimizeCombinations(candidates, none, 2)).toBe(3)
  })

  it('never past two copies of a name, counting the ones the deck keeps', () => {
    const candidates = [card('X'), card('Y')]
    // The deck keeps one X: one more fits.
    expect(optimizeEngineCandidates(candidates, new Map([['X', 1]]), 2)).toEqual(['X', 'Y', 'Y'])
    expect(optimizeCombinations(candidates, new Map([['X', 1]]), 2)).toBe(2)
    // It keeps two: X does not go.
    expect(optimizeEngineCandidates(candidates, new Map([['X', 2]]), 2)).toEqual(['Y', 'Y'])
    expect(optimizeCombinations(candidates, new Map([['X', 2]]), 2)).toBe(1)
    // Three places and three candidates: 10 multisets, minus the 3 with three copies of one card.
    expect(optimizeCombinations([card('X'), card('Y'), card('Z')], none, 3)).toBe(7)
  })

  it('two editions of one name share its two copies, and a repeated id counts once', () => {
    const candidates = [card('A1-33', 'Charmander'), card('A2-10', 'Charmander'), card('A1-33', 'Charmander')]
    expect(optimizeEngineCandidates(candidates, none, 3)).toEqual(['A1-33', 'A1-33', 'A2-10', 'A2-10'])
    // One place: either edition. Two: 33+33, 33+10, 10+10. Three: none (a third Charmander).
    expect(optimizeCombinations(candidates, none, 1)).toBe(2)
    expect(optimizeCombinations(candidates, none, 2)).toBe(3)
    expect(optimizeCombinations(candidates, none, 3)).toBe(0)
    expect(optimizeCombinations(candidates, none, 0)).toBe(0)
  })

  it('counts what deckgym plays with the list it gets, for random decks and candidates', () => {
    const random = seededRandom(50)
    const names = ['A', 'B', 'C', 'D']
    for (let trial = 0; trial < 300; trial++) {
      const candidates = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => {
        const name = names[Math.floor(random() * names.length)] as string
        return card(`${name}${i % 2}`, name)
      })
      const kept = new Map(names.filter(() => random() < 0.4).map((name) => [name, 1 + Math.floor(random() * 2)]))
      const missing = 1 + Math.floor(random() * 4)
      const nameOf = (id: string) => id.slice(0, 1)
      const list = optimizeEngineCandidates(candidates, kept, missing)
      expect(optimizeCombinations(candidates, kept, missing), `trial ${trial}`).toBe(
        deckgymCombinations(list, missing, nameOf, kept).size,
      )
    }
  })

  it('reads the copies a deck keeps from its deckgym text', () => {
    const text = "Energy: Fire\n2 Charmander A1 33\n1 Mega Blaziken ex B1 36\n2 Professor's Research P-A 7\n"
    expect(
      keptCopiesByName(
        text,
        new Map([
          ['Charmander', 1],
          ['Mega Blaziken ex', 1],
        ]),
      ),
    ).toEqual(
      new Map([
        ['Charmander', 1],
        ["Professor's Research", 2],
      ]),
    )
  })
})
