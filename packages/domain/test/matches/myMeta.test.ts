import { describe, expect, it } from 'vitest'
import { MY_META_MIN_MATCHES, myMeta } from '../../src/matches/myMeta.js'

const now = new Date('2026-10-09T12:00:00Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
const archetypes = [
  { id: 'mega-blaziken-ex-b1', name: 'Mega Blaziken ex' },
  { id: 'hoopa-ex-b2', name: 'Hoopa ex' },
  { id: 'mega-altaria-ex-b1-espeon-b3a', name: 'Mega Altaria ex Espeon' },
]
const played = (opponent: string | null, days: number, times = 1) =>
  Array.from({ length: times }, () => ({ opponent, playedAt: daysAgo(days) }))

describe('«mi meta» (Fase 44)', () => {
  it('shares of tournament archetypes from my rivals, the recent ones weighing more', () => {
    const meta = myMeta(
      [...played('mega blaziken EX', 0, 6), ...played('Hoopa ex', 14, 6), ...played(null, 0, 3)],
      archetypes,
      { now },
    )
    expect(meta).toMatchObject({ matches: 12, withoutRival: 3, matched: 12, coverage: 100, enough: true })
    // Today's matches weigh 1 each, two-week-old ones ½: 6 against 3.
    expect(meta.shares.map((row) => [row.archetypeId, Math.round(row.share), row.games])).toEqual([
      ['mega-blaziken-ex-b1', 67, 6],
      ['hoopa-ex-b2', 33, 6],
    ])
    // Kish: (6 + 3)² / (6 + 6 · ¼) = 10,8 effective matches, so every share is a thin estimate.
    expect(meta.effectiveMatches).toBeCloseTo(81 / 7.5, 10)
    expect(meta.orientative).toBe(true)
    const [blaziken] = meta.shares
    expect(blaziken?.ci95[0]).toBeLessThan(blaziken?.share ?? 0)
    expect(blaziken?.ci95[1]).toBeGreaterThan(blaziken?.share ?? 100)
    expect(blaziken?.ci95[1]).toBeLessThanOrEqual(100)
    expect(meta.text).toBe(
      'Tu meta (12 partidas contra arquetipos de torneo, 10,8 efectivas, porque las recientes pesan más; orientativo): Mega Blaziken ex 66,7 % (IC 37,8–86,8 %), Hoopa ex 33,3 % (IC 13,2–62,2 %).',
    )
  })

  it('enough looks at the effective matches: ten matches, half of them two months old, are not enough', () => {
    const meta = myMeta([...played('Hoopa ex', 0, 5), ...played('Hoopa ex', 60, 5)], archetypes, { now })
    expect(meta.matched).toBe(10)
    expect(meta.effectiveMatches).toBeLessThan(6)
    expect(meta.enough).toBe(false)
    expect(meta.text).toMatch(/^Todavía no alcanza: hacen falta 10 partidas efectivas .* \(tenés 10, 5,5 efectivas/)
    // The same ten, all recent, are.
    const recent = myMeta(played('Hoopa ex', 1, 10), archetypes, { now })
    expect(recent.enough).toBe(true)
    expect(recent.effectiveMatches).toBeCloseTo(10, 10)
  })

  it('coverage is weighted by age: an old unmatched rival counts less than a recent one', () => {
    const meta = myMeta([...played('Hoopa ex', 0, 4), ...played('el de los fantasmas', 28, 4)], archetypes, { now })
    // 4 against 4 × ¼.
    expect(meta.coverage).toBeCloseTo(80, 10)
  })

  it('a rival named otherwise counts when a note links it to an archetype; the rest stay apart', () => {
    const matches = [...played('Altaria', 1, 4), ...played('el de los fantasmas', 1, 2), ...played('Hoopa ex', 1, 4)]
    const plain = myMeta(matches, archetypes, { now })
    expect(plain.unmatched).toEqual([
      { key: 'altaria', label: 'Altaria', games: 4 },
      { key: 'el de los fantasmas', label: 'el de los fantasmas', games: 2 },
    ])
    expect(plain.coverage).toBeCloseTo(40, 10)
    expect(plain.enough).toBe(false)
    expect(plain.text).toContain(`hacen falta ${MY_META_MIN_MATCHES} partidas`)
    const linked = myMeta(matches, archetypes, {
      now,
      links: new Map([
        ['altaria', 'mega-altaria-ex-b1-espeon-b3a'],
        ['el de los fantasmas', 'not-in-this-era'],
      ]),
    })
    expect(linked.matched).toBe(8)
    expect(linked.shares.map((row) => row.archetypeId)).toEqual(['hoopa-ex-b2', 'mega-altaria-ex-b1-espeon-b3a'])
    expect(linked.unmatched.map((row) => row.key)).toEqual(['el de los fantasmas'])
  })

  it('without matches, nothing to weigh with', () => {
    const meta = myMeta([], archetypes, { now })
    expect(meta).toMatchObject({ matches: 0, matched: 0, coverage: 0, enough: false, shares: [], unmatched: [] })
  })
})
