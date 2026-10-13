import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/lab/mutate.js'
import {
  combinationNamesEs,
  type OptimizeCandidate,
  optimizeCombinations,
  optimizeEngineCandidates,
  optimizePlan,
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

  it('counts the same as every multiset of the distinct ids that respects the names, built apart', () => {
    // The truth without the list the code builds (review of H-050): each id 0, 1 or 2 times, the places filled, no
    // name past 2 with the kept copies.
    const truth = (candidates: OptimizeCandidate[], kept: Map<string, number>, missing: number) => {
      const ids = [...new Map(candidates.map((candidate) => [candidate.id, candidate.name]))]
      let count = 0
      const walk = (at: number, left: number, names: Map<string, number>) => {
        if (at === ids.length) {
          if (left === 0) count++
          return
        }
        const [, name] = ids[at] as [string, string]
        for (let copies = 0; copies <= Math.min(2, left); copies++) {
          const next = new Map(names)
          next.set(name, (next.get(name) ?? 0) + copies)
          if ((next.get(name) ?? 0) <= 2) walk(at + 1, left - copies, next)
        }
      }
      walk(0, missing, new Map(kept))
      return count
    }
    const random = seededRandom(9)
    for (let trial = 0; trial < 300; trial++) {
      const candidates = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, i) => {
        const name = ['A', 'B', 'C'][Math.floor(random() * 3)] as string
        return card(`${name}${i}`, name)
      })
      const kept = new Map(
        ['A', 'B', 'C'].filter(() => random() < 0.4).map((name) => [name, 1 + Math.floor(random() * 2)]),
      )
      const missing = 1 + Math.floor(random() * 4)
      expect(optimizeCombinations(candidates, kept, missing), `trial ${trial}`).toBe(truth(candidates, kept, missing))
    }
  })

  it('says why a plan cannot be played, the same for the preview and the job', () => {
    const plan = (candidates: OptimizeCandidate[], kept: Map<string, number>, missing: number) =>
      optimizePlan(candidates, kept, missing).problem
    expect(plan([card('X')], none, 2)).toBeNull()
    // Every candidate's name is already full.
    expect(plan([card('X')], new Map([['X', 2]]), 1)).toMatch(/^Ninguna candidata entra: el mazo ya lleva 2 copias/)
    // One card fills two places at most: three cannot be filled.
    expect(plan([card('X')], none, 3)).toMatch(/^Con estas candidatas no se llenan los 3 lugares/)
    // 12 cards for three places: C(14, 3) − 12 = 352.
    const twelve = Array.from({ length: 12 }, (_, i) => card(`C${i}`))
    expect(optimizePlan(twelve, none, 3)).toMatchObject({ combinations: 352 })
    expect(plan(twelve, none, 3)).toBe(
      '352 combinaciones posibles superan el límite de 200: elegí menos candidatas o sacá menos cartas.',
    )
    // Many editions of two names: 36 combinations, but deckgym would build C(24, 16) = 735.471 first.
    const editions = [
      ...['E', 'F'].flatMap((name) => [0, 1, 2].map((i) => card(`${name}${i}`, name))),
      ...Array.from({ length: 6 }, (_, i) => card(`S${i}`)),
    ]
    expect(optimizePlan(editions, none, 16)).toMatchObject({ combinations: 36 })
    expect(plan(editions, none, 16)).toMatch(/el motor tendría que armar 735\.471/)
    expect(plan([], none, 1)).toBe('Elegí cartas candidatas.')
    expect(plan([card('X')], none, 0)).toBe('Sacá al menos una carta para optimizar.')
  })

  it('says two copies of a card once: «2 Erika, Sabrina»', () => {
    expect(combinationNamesEs(['Erika', 'Sabrina', 'Erika'])).toBe('2 Erika, Sabrina')
    expect(combinationNamesEs(['Erika'])).toBe('Erika')
  })
})
