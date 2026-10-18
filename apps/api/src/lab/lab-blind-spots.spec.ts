import type { MetaScore } from '@tcg/domain'
import { bankShares, comparableScore } from './lab-blind-spots.js'

const score = (value: number, coverage = 1): MetaScore => ({
  value,
  ci95: [value - 3, value + 3],
  se: 1.5,
  games: 600,
  rivals: 3,
  coverage,
})

describe('what «posible punto ciego del bot» compares in the Laboratorio (H-055)', () => {
  it('sums the weights of an archetype that comes with two lists (review of #119)', () => {
    expect(
      bankShares([
        { archetypeId: 'mega-altaria', weight: 0.2 },
        { archetypeId: 'suicune', weight: 0.3 },
        { archetypeId: 'mega-altaria', weight: 0.1 },
      ]),
    ).toEqual([
      { archetypeId: 'mega-altaria', share: expect.closeTo(0.3, 10) },
      { archetypeId: 'suicune', share: 0.3 },
    ])
    expect(bankShares([])).toEqual([])
  })

  it('the confirmation once there is one, even without games yet; the search otherwise; only the whole bank', () => {
    expect(comparableScore({ search: { score: score(20) }, confirm: null })?.value).toBe(20)
    expect(comparableScore({ search: { score: score(20) }, confirm: { score: score(48) } })?.value).toBe(48)
    // Review of #119: a confirmation still without games is not replaced by the search's score.
    expect(comparableScore({ search: { score: score(20) }, confirm: { score: null } })).toBeNull()
    // A score of part of the bank.
    expect(comparableScore({ search: { score: score(20, 0.6) }, confirm: null })).toBeNull()
    expect(comparableScore({ search: { score: score(20) }, confirm: { score: score(48, 0.5) } })).toBeNull()
    expect(comparableScore({ search: { score: null }, confirm: null })).toBeNull()
  })
})
