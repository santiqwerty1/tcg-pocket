import { describe, expect, it } from 'vitest'
import { cleanOpponent, opponentKey, opponentLabels, suggestOpponents } from '../../src/matches/index.js'

const NOW = new Date('2026-10-07T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

describe('cleanOpponent / opponentKey', () => {
  it('cleans spacing and keeps the spelling', () => {
    expect(cleanOpponent('  Mega-Blaziken   ex ')).toBe('Mega-Blaziken ex')
    expect(cleanOpponent('')).toBeNull()
    expect(cleanOpponent('   ')).toBeNull()
    expect(cleanOpponent(null)).toBeNull()
    expect(cleanOpponent(undefined)).toBeNull()
  })

  it('groups spellings that differ in case, accents, hyphens and spacing', () => {
    const key = opponentKey('Mega-Blaziken ex')
    expect(key).toBe('mega blaziken ex')
    for (const variant of ['mega blaziken EX', 'Mega  Blaziken ex', ' MEGA-BLAZIKEN-EX ', 'Mega Blazíken ex']) {
      expect(opponentKey(variant)).toBe(key)
    }
    expect(opponentKey('Darkrai ex / Arceus')).toBe('darkrai ex arceus')
    expect(opponentKey('Pikachú ex')).toBe('pikachu ex')
    // Different archetypes stay different: «ex» is part of the name.
    expect(opponentKey('Blaziken')).not.toBe(key)
    expect(opponentKey('---')).toBeNull()
    expect(opponentKey('')).toBeNull()
  })
})

describe('opponentLabels', () => {
  it('labels a key with its most used spelling, the most recent one on ties', () => {
    const labels = opponentLabels([
      { opponent: 'mega blaziken ex', playedAt: daysAgo(3) },
      { opponent: 'Mega-Blaziken ex', playedAt: daysAgo(2) },
      { opponent: 'Mega-Blaziken ex', playedAt: daysAgo(1) },
      { opponent: 'Gardevoir', playedAt: daysAgo(5) },
      { opponent: 'gardevoir', playedAt: daysAgo(1) },
      { opponent: null, playedAt: daysAgo(1) },
    ])
    expect(labels.get('mega blaziken ex')).toBe('Mega-Blaziken ex')
    expect(labels.get('gardevoir')).toBe('gardevoir')
    expect(labels.size).toBe(2)
  })
})

describe('suggestOpponents', () => {
  const matches = [
    // Darkrai: many games, but a month ago.
    ...Array.from({ length: 6 }, () => ({ opponent: 'Darkrai ex', playedAt: daysAgo(40) })),
    // Mega-Blaziken: three games this week.
    { opponent: 'Mega-Blaziken ex', playedAt: daysAgo(1) },
    { opponent: 'mega blaziken ex', playedAt: daysAgo(2) },
    { opponent: 'Mega-Blaziken ex', playedAt: daysAgo(3) },
    // Gardevoir: one game today.
    { opponent: 'Gardevoir ex', playedAt: daysAgo(0) },
    { opponent: '', playedAt: daysAgo(0) },
  ]

  it('ranks recent opponents above old frequent ones and merges spellings', () => {
    const suggestions = suggestOpponents(matches, { now: NOW })
    expect(suggestions.map((s) => s.label)).toEqual(['Mega-Blaziken ex', 'Gardevoir ex', 'Darkrai ex'])
    expect(suggestions[0]).toMatchObject({ key: 'mega blaziken ex', games: 3, lastPlayedAt: daysAgo(1) })
    expect(suggestions[2]?.games).toBe(6)
  })

  it('filters by what is being typed and honours the limit', () => {
    expect(suggestOpponents(matches, { now: NOW, query: 'blaz' }).map((s) => s.label)).toEqual(['Mega-Blaziken ex'])
    expect(suggestOpponents(matches, { now: NOW, query: 'EX' })).toHaveLength(3)
    expect(suggestOpponents(matches, { now: NOW, query: '   ' })).toHaveLength(3)
    expect(suggestOpponents(matches, { now: NOW, limit: 1 })).toHaveLength(1)
    expect(suggestOpponents([], { now: NOW })).toEqual([])
  })
})
