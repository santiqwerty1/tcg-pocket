import { describe, expect, it } from 'vitest'
import { leftOutCards, whyCards } from './lab-explain.js'

// A catalog with what these functions read: the functional card of an edition, its type and names.
const cards: Record<string, { functionalGroupId: string; cardType: 'pokemon' | 'trainer'; nameEs: string }> = {
  'T-1': { functionalGroupId: 'T-1', cardType: 'trainer', nameEs: 'Helio' },
  'P-1': { functionalGroupId: 'P-1', cardType: 'pokemon', nameEs: 'Bulbasaur' },
  'E-1': { functionalGroupId: 'E-1', cardType: 'trainer', nameEs: 'Erika' },
}
const index = {
  cardById: (id: string) => cards[id],
  groupById: (id: string) => (cards[id] ? { nameEs: cards[id]?.nameEs } : undefined),
} as never

describe('why cards came in and what was left out (T-017 E1/E2, review of #20)', () => {
  // Helio: 40 % of the era and 90 % of the archetype ⇒ weight 2 × 5 × 10 = 100. Erika: archetype 98 %, not owned.
  const frozen = {
    pool: [
      ['T-1', 2, 100],
      ['P-1', 2, 1],
    ] as [string, number, number][],
    affinity: [
      ['T-1', 90],
      ['E-1', 98],
      ['P-1', 5],
    ] as [string, number][],
  }
  const owned = (groupId: string) => ({ 'T-1': 1, 'P-1': 3 })[groupId] ?? 0

  it('the era share comes back out of the draw weight, and «te falta» counts the copies the collection lacks', () => {
    const why = whyCards([{ cardId: 'T-1', count: 2 }], [{ cardId: 'T-1', count: 2 }], frozen, index, owned)
    expect(why).toEqual([{ cardId: 'T-1', nameEs: 'Helio', eraShare: 40, archetypeShare: 90, missing: 1 }])
    // Without frozen inputs (an older search) the shares are unknown.
    expect(
      whyCards([{ cardId: 'T-1', count: 1 }], [{ cardId: 'T-1', count: 1 }], undefined, index, owned)[0],
    ).toMatchObject({ eraShare: null, archetypeShare: null, missing: 0 })
  })

  it('left out: what 30 % or more of the archetype plays and the collection lacks; nothing with «todas las cartas»', () => {
    expect(leftOutCards(frozen, 'collection', index, owned)).toEqual([
      { cardId: 'E-1', nameEs: 'Erika', archetypeShare: 98 },
    ])
    expect(leftOutCards(frozen, 'all', index, owned)).toEqual([])
    expect(leftOutCards(undefined, 'collection', index, owned)).toEqual([])
  })
})
