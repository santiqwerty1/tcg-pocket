import { describe, expect, it } from 'vitest'
import {
  buildDataset,
  DEFAULT_SET_RELEASES,
  metaShares,
  metaTrends,
  parseStandings,
  type StoredEntry,
  type StoredTournament,
} from '../../src/tournaments/index.js'
import { BIG_ID, readLimitless } from '../helpers/limitless.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const big = parseStandings(readLimitless('big_standings.json'))

describe('meta semanal (Fase 11)', () => {
  // PMPT #45 (5/9) as this week, and the week before a copy of it without its most played archetype (29/8).
  const plain = buildDataset({
    tournaments: [
      { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
    ],
    entries: big.map((entry) => ({ ...entry, tournamentId: BIG_ID })),
    index,
    sets: DEFAULT_SET_RELEASES,
    era: 'B4a',
    format: 'STANDARD',
    minPlayers: 12,
  })
  const top = metaShares(plain)[0]?.archetypeId as string
  const withoutTop = big.filter((entry) => entry.archetype?.id !== top)
  const tournaments: StoredTournament[] = [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
    {
      id: 'copy',
      name: 'Semana anterior',
      date: new Date('2026-08-29T16:00:00Z'),
      format: 'STANDARD',
      players: withoutTop.length,
    },
  ]
  const entries: StoredEntry[] = [
    ...big.map((entry) => ({ ...entry, tournamentId: BIG_ID })),
    ...withoutTop.map((entry) => ({ ...entry, tournamentId: 'copy' })),
  ]
  const dataset = buildDataset({
    tournaments,
    entries,
    index,
    sets: DEFAULT_SET_RELEASES,
    era: 'B4a',
    format: 'STANDARD',
    minPlayers: 12,
  })
  const trends = metaTrends(dataset)

  it('compares the week ending at the newest tournament with the week before', () => {
    expect(trends.days).toBe(7)
    expect(trends.now).toMatchObject({ tournaments: 1, lists: 393 })
    expect(trends.before).toMatchObject({ tournaments: 1, lists: withoutTop.length })
    expect(trends.now.to.getTime() - trends.now.from.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    expect(trends.before.to).toEqual(trends.now.from)
  })

  it('the archetype missing the week before rises the most, clearly, and is new', () => {
    const first = trends.archetypes[0]
    expect(first?.archetypeId).toBe(top)
    expect(first).toMatchObject({ isNew: true, clear: true, before: { lists: 0, share: 0 } })
    expect(first?.delta).toBeCloseTo(first?.now.share ?? 0, 10)
    expect(first?.rate?.games).toBeGreaterThan(0)
    // Everybody else lost a little share (the same lists over more of them): small, not clear.
    const others = trends.archetypes.slice(1)
    expect(others.every((row) => row.delta <= 0)).toBe(true)
    expect(others.filter((row) => row.clear)).toEqual([])
    for (let i = 1; i < trends.archetypes.length; i++) {
      expect(trends.archetypes[i - 1]?.delta).toBeGreaterThanOrEqual(trends.archetypes[i]?.delta ?? 0)
    }
  })

  it('cards follow: the ones only that archetype plays go up', () => {
    expect(trends.cards.length).toBeGreaterThan(10)
    expect(trends.cards[0]?.delta).toBeGreaterThan(0)
    expect(trends.cards[0]?.clear).toBe(true)
    expect(trends.cards.every((row) => Math.max(row.now.lists, row.before.lists) >= 5)).toBe(true)
  })

  it('one tournament only: no week before, nothing is clear', () => {
    const lone = metaTrends(plain)
    expect(lone.before.lists).toBe(0)
    expect(lone.archetypes.every((row) => !row.clear && !row.isNew)).toBe(true)
  })
})
