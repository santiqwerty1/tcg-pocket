import { describe, expect, it } from 'vitest'
import type { CardId } from '../../src/catalog/types.js'
import { seededRandom } from '../../src/lab/index.js'
import { recordGames } from '../../src/stats/rates.js'
import {
  archetypeCards,
  archetypeRows,
  buildDataset,
  CORE_MIN_SHARE,
  type DatasetEntry,
  DEFAULT_SET_RELEASES,
  entriesOfArchetype,
  formatRateDifferenceEs,
  parseStandings,
  SPLIT_MIN_LISTS,
  TECH_MIN_SHARE,
  TOP_CUT_PLACES,
  type TournamentDataset,
  topConversion,
} from '../../src/tournaments/index.js'
import { BIG_ID, readLimitless } from '../helpers/limitless.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
// PMPT #45 (393 lists, 5/9/2026).
const dataset = buildDataset({
  tournaments: [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
  ],
  entries: parseStandings(readLimitless('big_standings.json')).map((entry) => ({ ...entry, tournamentId: BIG_ID })),
  index,
  sets: DEFAULT_SET_RELEASES,
  era: 'B4a',
  format: 'STANDARD',
  minPlayers: 12,
})
const LUCARIO = 'mega-lucario-ex-b3-lucario-a2'

const rate = (entries: readonly DatasetEntry[]) => {
  const wins = entries.reduce((sum, entry) => sum + entry.record.wins, 0)
  const games = entries.reduce((sum, entry) => sum + recordGames(entry.record), 0)
  return (wins / games) * 100
}

/**
 * Lists with or without a card: about `withWins` of 8 rounds won by each list that plays it and `withoutWins` by the
 * rest — one more and one less in turns (`vary`), so the resamples have spread, or exactly that (`vary: false`).
 */
function synthetic(withLists: number, withoutLists: number, withWins: number, withoutWins: number, vary = true) {
  const entry = (i: number, j: number, plays: boolean): DatasetEntry => {
    const base = plays ? withWins : withoutWins
    const wins = Math.max(0, Math.min(8, base + (vary ? (j % 2 === 0 ? 1 : -1) : 0)))
    return {
      tournamentId: 't',
      playerId: `p${i}`,
      date: new Date('2026-09-05T16:00:00Z'),
      playerName: `p${i}`,
      placing: i + 1,
      record: { wins, losses: 8 - wins, ties: 0 },
      archetypeId: 'a',
      keyByName: `k${i}`,
      keyByGroup: `k${i}`,
      cards: [],
      groups: new Map<CardId, number>([
        ['core' as CardId, 2],
        ...(plays ? ([['tech' as CardId, 1]] as [CardId, number][]) : []),
      ]),
      energies: [],
    }
  }
  const entries = [
    ...Array.from({ length: withLists }, (_, j) => entry(j, j, true)),
    ...Array.from({ length: withoutLists }, (_, j) => entry(withLists + j, j, false)),
  ]
  return { dataset: { entries } as unknown as TournamentDataset, entries }
}

describe('núcleo, techs and copies of an archetype (Fase 44)', () => {
  const entries = entriesOfArchetype(dataset, LUCARIO)
  const cards = archetypeCards(dataset, entries)

  it('splits the cards by how many lists play them, and the núcleo takes its slots of the 20', () => {
    expect(cards.lists).toBe(33)
    expect(cards.core.length).toBeGreaterThan(0)
    for (const card of cards.core) expect(card.share).toBeGreaterThanOrEqual(CORE_MIN_SHARE)
    for (const tech of cards.techs) {
      expect(tech.share).toBeGreaterThanOrEqual(TECH_MIN_SHARE)
      expect(tech.share).toBeLessThan(CORE_MIN_SHARE)
      expect(tech.with.lists + tech.without.lists).toBe(33)
    }
    expect(cards.coreSlots + cards.freeSlots).toBeCloseTo(20)
    expect(cards.coreSlots).toBeGreaterThan(10)
  })

  it('the difference is the rate with the card minus the rate without it, inside its bootstrap interval', () => {
    const compared = cards.techs.filter((tech) => tech.difference)
    expect(compared.length).toBeGreaterThan(3)
    for (const tech of compared) {
      const withCard = entries.filter((entry) => (entry.groups.get(tech.groupId) ?? 0) >= 1)
      const without = entries.filter((entry) => (entry.groups.get(tech.groupId) ?? 0) === 0)
      expect(tech.difference?.value).toBeCloseTo(rate(withCard) - rate(without), 6)
      const [low, high] = tech.difference?.ci95 ?? [0, 0]
      expect(low).toBeLessThan(tech.difference?.value ?? 0)
      expect(high).toBeGreaterThan(tech.difference?.value ?? 0)
    }
  })

  it('says nothing when a side has fewer than 5 lists, and «orientativo» while a side has under 30', () => {
    for (const tech of cards.techs) {
      const few = tech.with.lists < SPLIT_MIN_LISTS || tech.without.lists < SPLIT_MIN_LISTS
      expect(tech.difference === null).toBe(few)
      if (tech.difference) expect(tech.difference.orientative).toBe(Math.min(tech.with.lists, tech.without.lists) < 30)
    }
    expect(formatRateDifferenceEs(null)).toBe('sin datos suficientes de los dos lados')
  })

  it('compares two copies against one only among the lists that play the card', () => {
    expect(cards.copies.length).toBeGreaterThan(0)
    for (const row of cards.copies) {
      expect(row.one.lists).toBeGreaterThanOrEqual(SPLIT_MIN_LISTS)
      expect(row.two.lists).toBeGreaterThanOrEqual(SPLIT_MIN_LISTS)
      expect(row.one.lists + row.two.lists).toBe(row.lists)
    }
  })

  it('the same lists and seed give the same intervals; another seed moves them a little', () => {
    const again = archetypeCards(dataset, entries)
    expect(again.techs.map((tech) => tech.difference?.ci95)).toEqual(cards.techs.map((tech) => tech.difference?.ci95))
    const other = archetypeCards(dataset, entries, { seed: 7 })
    const first = cards.techs.find((tech) => tech.difference)
    const moved = other.techs.find((tech) => tech.groupId === first?.groupId)
    expect(moved?.difference?.value).toBe(first?.difference?.value)
    expect(moved?.difference?.ci95[0]).not.toBe(first?.difference?.ci95[0])
  })

  it('a card that every winning list plays is a clear difference; on a real archetype nothing is clear', () => {
    const { dataset: fake, entries: lists } = synthetic(20, 20, 6, 2)
    const result = archetypeCards(fake, lists)
    const tech = result.techs.find((row) => row.groupId === 'tech')
    expect(tech?.difference?.value).toBeCloseTo(50)
    expect(tech?.difference?.clear).toBe(true)
    expect(formatRateDifferenceEs(tech?.difference ?? null)).toMatch(
      /^\+50,0 puntos \(IC\u00a0.*, orientativo; clara\)$/,
    )
    expect(tech?.difference?.orientative).toBe(true)
    expect(result.core.map((row) => row.groupId)).toEqual(['core'])
    // PMPT Mega-Lucario: 33 lists, every difference «puede ser azar».
    expect(cards.techs.some((row) => row.difference?.clear)).toBe(false)
  })

  it('a side whose lists have no games (0-0-0, drops) has no rate: no difference, no NaN', () => {
    const { dataset: fake, entries: lists } = synthetic(10, 10, 5, 0)
    const zeroed = lists.map((entry) =>
      entry.groups.has('tech' as CardId) ? entry : { ...entry, record: { wins: 0, losses: 0, ties: 0 } },
    )
    const result = archetypeCards(fake, zeroed)
    const tech = result.techs.find((row) => row.groupId === 'tech')
    expect(tech?.without.lists).toBe(10)
    expect(tech?.difference).toBeNull()
    expect(JSON.stringify(result)).not.toContain('null,null')
  })

  it('a real difference can be clear even in a table of 30 rows (the p is not bounded by the resamples)', () => {
    // 40 lists: 30 cards each played by half of them at random-ish, one tech played by the winners.
    const entries: DatasetEntry[] = Array.from({ length: 40 }, (_, i) => ({
      tournamentId: 't',
      playerId: `p${i}`,
      date: new Date('2026-09-05T16:00:00Z'),
      playerName: '',
      placing: i + 1,
      record: {
        wins: (i < 20 ? 6 : 2) + (i % 2 === 0 ? 1 : -1),
        losses: (i < 20 ? 2 : 6) - (i % 2 === 0 ? 1 : -1),
        ties: 0,
      },
      archetypeId: 'a',
      keyByName: '',
      keyByGroup: `k${i}`,
      cards: [],
      groups: new Map<CardId, number>([
        ...(i < 20 ? ([['tech' as CardId, 1]] as [CardId, number][]) : []),
        ...Array.from({ length: 30 }, (_, c) => [`c${c}` as CardId, 1] as [CardId, number]).filter(
          (_, c) => (i * 7 + c * 3) % 2 === 0,
        ),
      ]),
      energies: [],
    }))
    const result = archetypeCards({ entries } as unknown as TournamentDataset, entries)
    const comparable = result.techs.filter((row) => row.difference)
    expect(comparable.length).toBeGreaterThanOrEqual(26)
    expect(result.techs.find((row) => row.groupId === 'tech')?.difference?.clear).toBe(true)
  })

  it('five lists on a side are not enough when fewer than five of them have games', () => {
    // Without the tech: 6 lists, 4 of them 0-0-0 drops. With it: 10 played lists.
    const { dataset: fake, entries: lists } = synthetic(10, 6, 6, 2)
    let dropped = 0
    const mixed = lists.map((entry) => {
      if (entry.groups.has('tech' as CardId) || dropped >= 4) return entry
      dropped += 1
      return { ...entry, record: { wins: 0, losses: 0, ties: 0 } }
    })
    const tech = archetypeCards(fake, mixed).techs.find((row) => row.groupId === 'tech')
    expect(tech?.without.lists).toBe(6)
    expect(tech?.difference).toBeNull()
  })

  it('«orientativo» counts the lists with games: drops do not make a side big', () => {
    // 40 lists on each side, 15 of those without the tech 0-0-0: that side has 25 lists with games, under 30.
    const { dataset: fake, entries: lists } = synthetic(40, 40, 6, 2)
    let dropped = 0
    const mixed = lists.map((entry) => {
      if (entry.groups.has('tech' as CardId) || dropped >= 15) return entry
      dropped += 1
      return { ...entry, record: { wins: 0, losses: 0, ties: 0 } }
    })
    const tech = archetypeCards(fake, mixed).techs.find((row) => row.groupId === 'tech')
    expect(tech?.without.lists).toBe(40)
    expect(tech?.difference?.orientative).toBe(true)
    expect(archetypeCards(fake, lists).techs.find((row) => row.groupId === 'tech')?.difference?.orientative).toBe(false)
  })

  it('«clara» never sits next to an interval that crosses 0', () => {
    // Codex on #17: one tech, 12 lists with it and 17 without (5 to 8 games each). With seed 44 the p from the
    // bootstrap's standard error is 0,037 (it passes Benjamini–Hochberg alone) and the percentile interval starts
    // at −1,0 points.
    const records: [boolean, number, number][] = [
      [true, 6, 2],
      [true, 4, 1],
      [true, 2, 4],
      [true, 6, 2],
      [true, 5, 2],
      [true, 4, 3],
      [true, 2, 3],
      [true, 5, 3],
      [true, 2, 4],
      [true, 5, 3],
      [true, 1, 5],
      [true, 2, 3],
      [false, 1, 6],
      [false, 3, 3],
      [false, 3, 5],
      [false, 3, 3],
      [false, 1, 4],
      [false, 2, 3],
      [false, 0, 5],
      [false, 4, 4],
      [false, 3, 3],
      [false, 1, 4],
      [false, 2, 3],
      [false, 5, 3],
      [false, 4, 3],
      [false, 1, 6],
      [false, 6, 2],
      [false, 3, 4],
      [false, 1, 5],
    ]
    const { dataset: fake, entries: lists } = synthetic(12, 17, 4, 2)
    const shaped = lists.map((entry, i) => {
      const [, wins, losses] = records[i] as [boolean, number, number]
      return { ...entry, record: { wins, losses, ties: 0 } }
    })
    const difference = archetypeCards(fake, shaped).techs.find((row) => row.groupId === 'tech')?.difference
    expect(difference?.p).toBeLessThan(0.05)
    expect(difference?.ci95[0]).toBeLessThan(0)
    expect(difference?.clear).toBe(false)
  })

  it('no spread among the resamples is not certainty: never «clara»', () => {
    const { dataset: fake, entries: lists } = synthetic(5, 5, 6, 2, false)
    const tech = archetypeCards(fake, lists).techs.find((row) => row.groupId === 'tech')
    expect(tech?.difference?.value).toBeCloseTo(50)
    expect(tech?.difference?.p).toBe(1)
    expect(tech?.difference?.clear).toBe(false)
  })

  it('lists with a card the catalog does not map stay out of the card tables', () => {
    const { dataset: fake, entries: lists } = synthetic(10, 10, 5, 3)
    const unmapped = lists.map((entry, i) => (i < 3 ? { ...entry, keyByGroup: null } : entry))
    const result = archetypeCards(fake, unmapped)
    expect(result).toMatchObject({ lists: 17, incomplete: 3 })
    expect(result.techs.find((row) => row.groupId === 'tech')?.with.lists).toBe(7)
  })

  it('no difference at all is not clear', () => {
    const { dataset: fake, entries: lists } = synthetic(20, 20, 4, 4)
    const tech = archetypeCards(fake, lists).techs.find((row) => row.groupId === 'tech')
    expect(tech?.difference?.value).toBe(0)
    expect(tech?.difference?.clear).toBe(false)
  })
})

describe('conversion to the top 8 (Fase 44)', () => {
  const fakeEntry = (tournamentId: string, placing: number, archetypeId: string): DatasetEntry => ({
    tournamentId,
    playerId: `${tournamentId}-${placing}`,
    date: new Date('2026-09-05T16:00:00Z'),
    playerName: '',
    placing,
    record: { wins: 3, losses: 3, ties: 0 },
    archetypeId,
    keyByName: '',
    keyByGroup: null,
    cards: [],
    groups: new Map<CardId, number>(),
    energies: [],
  })

  it('counts the lists that reached the top against what the rest of the field reached in that tournament', () => {
    const conversion = topConversion(dataset, LUCARIO)
    expect(conversion).not.toBeNull()
    const lucario = entriesOfArchetype(dataset, LUCARIO)
    const inTop = (entry: DatasetEntry) => entry.placing !== null && entry.placing <= TOP_CUT_PLACES
    const rest = dataset.entries.filter((entry) => entry.archetypeId !== LUCARIO)
    expect(conversion?.lists).toBe(lucario.length)
    expect(conversion?.topLists).toBe(lucario.filter(inTop).length)
    // One tournament: each of its 33 lists expects the top rate of the other 360.
    expect(conversion?.expected).toBeCloseTo(lucario.length * (rest.filter(inTop).length / rest.length), 10)
    expect(conversion?.ratio).toBeCloseTo((conversion?.topLists ?? 0) / (conversion?.expected ?? 1), 10)
    expect(conversion?.tournaments).toBe(1)
    expect(conversion?.text).toMatch(
      /^3 de 33 listas llegaron al top 8 \(9\u00a0%, IC\u00a03–24\u00a0%\); en sus torneos/,
    )
  })

  it('expects per tournament: lists in small events are not «better» for reaching their easier top 8', () => {
    // Review of #17: ten tournaments of 40 lists and one of 400. The archetype plays 6 lists in each small one: 1st
    // place in all ten, 2nd in five of them, and 9th to 12th (out of the top) — 15 of 60 in the top (25 %). The rest
    // of each small field reaches the top at 6/34 or 7/34 (~19 %); one base over all 800 lists would say 11 %
    // and call it «more than expected».
    const tournaments = [
      ...Array.from({ length: 10 }, (_, t) => ({ id: `s${t}`, players: 40 })),
      { id: 'big', players: 400 },
    ]
    const mine = (t: number, place: number) =>
      place === 1 || (place === 2 && t % 2 === 0) || (place >= 9 && place <= 12) || (place === 13 && t % 2 === 1)
    const entries: DatasetEntry[] = tournaments.flatMap((tournament, t) =>
      Array.from({ length: tournament.players }, (_, i) => ({
        tournamentId: tournament.id,
        playerId: `${tournament.id}-${i + 1}`,
        date: new Date('2026-09-05T16:00:00Z'),
        playerName: '',
        placing: i + 1,
        record: { wins: 3, losses: 3, ties: 0 },
        archetypeId: tournament.id !== 'big' && mine(t, i + 1) ? 'mine' : 'other',
        keyByName: '',
        keyByGroup: null,
        cards: [],
        groups: new Map<CardId, number>(),
        energies: [],
      })),
    )
    const fake = { tournaments, entries } as unknown as TournamentDataset
    const conversion = topConversion(fake, 'mine')
    expect(conversion).toMatchObject({ lists: 60, topLists: 15, tournaments: 10 })
    expect(conversion?.expected).toBeCloseTo(5 * 6 * (6 / 34) + 5 * 6 * (7 / 34), 10)
    // The same share in every tournament: Mantel–Haenszel is top lists / expected. Greenland–Robins: R = 12,75,
    // S = 9,75 and Σ (n₁n₀T − acN)/N² = 5 × 0,72 + 5 × 0,845.
    expect(conversion?.ratio).toBeCloseTo(15 / (conversion?.expected ?? 1), 10)
    const spread = Math.exp(1.959963984540054 * Math.sqrt((5 * 0.72 + 5 * 0.845) / (12.75 * 9.75)))
    expect(conversion?.ratioCi95?.[0]).toBeCloseTo(12.75 / 9.75 / spread, 10)
    expect(conversion?.ratioCi95?.[1]).toBeCloseTo((12.75 / 9.75) * spread, 10)
    expect(conversion?.ratioCi95?.[0]).toBeLessThan(1)
    expect(conversion?.text).toContain('No se distingue de lo esperado')
  })

  it('counts the top among the published lists: publishing the top and 40\u00a0% of the rest favors no one', () => {
    // Second review of #17: 108 players, the top 8 published (2 of the archetype) and 40 of the other 100 (10 of the
    // archetype). It is a quarter of the top and a quarter of the rest: no real difference. Against every player, the
    // rest's top rate would be 6 / 96 and its 12 lists would «expect» 0,75 (2,7×); among the published, 6 / 36.
    const entries = [
      ...Array.from({ length: 8 }, (_, i) => fakeEntry('t', i + 1, i < 2 ? 'mine' : 'other')),
      ...Array.from({ length: 40 }, (_, i) => fakeEntry('t', 9 + i * 2, i < 10 ? 'mine' : 'other')),
    ]
    const fake = { tournaments: [{ id: 't', players: 108 }], entries } as unknown as TournamentDataset
    const all = topConversion(fake, 'mine', { minCoverage: 0 })
    expect(all).toMatchObject({ lists: 12, topLists: 2, tournaments: 1 })
    expect(all?.expected).toBeCloseTo(12 * (6 / 36), 10)
    expect(all?.ratio).toBeCloseTo(1, 10)
    expect(all?.text).toContain('No se distingue de lo esperado')
    // With the default cut it published too little (48 of 108): left out, and said.
    const cut = topConversion(fake, 'mine')
    expect(cut).toMatchObject({
      lists: 0,
      tournaments: 0,
      rate: null,
      ratio: null,
      excluded: { tournaments: 1, lists: 12 },
    })
    expect(cut?.text).toBe(
      'Ninguna lista cuenta para la llegada al top 8. Quedan afuera 1 torneo con 12 listas del arquetipo: publicaron ' +
        'menos del 90\u00a0% de las listas, no todo el top 8 o solo listas del arquetipo.',
    )
  })

  it('with no real difference, the interval leaves out 1 about one time in twenty, published in full or not', () => {
    // Second review of #17: the previous interval did it 0,3–0,9\u00a0% of the time. Each replicate: 12 tournaments of 32
    // to 231 players, placings at random, the archetype 15\u00a0% of each; half the replicates publish the top and 40\u00a0%
    // of the rest. Every tournament counts (minCoverage 0) to see the selective ones too.
    const random = seededRandom(17)
    let outside = 0
    let ratios = 0
    const replicates = 400
    for (let rep = 0; rep < replicates; rep += 1) {
      const tournaments = Array.from({ length: 12 }, (_, t) => ({
        id: `t${t}`,
        players: 32 + Math.floor(random() * 200),
      }))
      const entries = tournaments.flatMap((tournament) =>
        Array.from({ length: tournament.players }, (_, i) => i + 1)
          .filter((place) => rep % 2 === 0 || place <= 8 || random() < 0.4)
          .map((place) => fakeEntry(tournament.id, place, random() < 0.15 ? 'mine' : 'other')),
      )
      const conversion = topConversion({ tournaments, entries } as unknown as TournamentDataset, 'mine', {
        minCoverage: 0,
      })
      const [low, high] = conversion?.ratioCi95 ?? [0, Number.POSITIVE_INFINITY]
      if (low > 1 || high < 1) outside += 1
      ratios += conversion?.ratio ?? 0
    }
    expect(outside / replicates).toBeGreaterThan(0.02)
    expect(outside / replicates).toBeLessThan(0.09)
    expect(ratios / replicates).toBeGreaterThan(0.95)
    expect(ratios / replicates).toBeLessThan(1.05)
  })

  it('leaves out a tournament without its whole top, and with no list in the top bounds the ratio by Poisson', () => {
    // Two tournaments of 40: one in full, the archetype 4 lists out of the top; the other without its 3rd place.
    const entries = [
      ...Array.from({ length: 40 }, (_, i) => fakeEntry('full', i + 1, i >= 20 && i < 24 ? 'mine' : 'other')),
      ...Array.from({ length: 40 }, (_, i) => i + 1)
        .filter((place) => place !== 3)
        .map((place) => fakeEntry('gap', place, place === 1 ? 'mine' : 'other')),
    ]
    const tournaments = [
      { id: 'full', players: 40 },
      { id: 'gap', players: 40 },
    ]
    const conversion = topConversion({ tournaments, entries } as unknown as TournamentDataset, 'mine')
    expect(conversion).toMatchObject({ tournaments: 1, lists: 4, topLists: 0, excluded: { tournaments: 1, lists: 1 } })
    expect(conversion?.expected).toBeCloseTo(4 * (8 / 36), 10)
    expect(conversion?.ratio).toBe(0)
    expect(conversion?.ratioCi95?.[1]).toBeCloseTo(-Math.log(0.025) / (4 * (8 / 36)), 10)
    expect(conversion?.text).toContain('Quedan afuera 1 torneo con 1 lista del arquetipo')
  })

  it('calls the Mantel–Haenszel ratio «ajustada por torneo», not observed over expected', () => {
    // Codex on #17: two tournaments of 100. The archetype is 90 lists in one (7 in the top) and 10 in the other (none):
    // 7 against 9,9 expected is 0,7, the ratio adjusted per tournament 0,4.
    const entries = [
      ...Array.from({ length: 100 }, (_, i) => fakeEntry('a', i + 1, i < 7 || (i >= 8 && i < 91) ? 'mine' : 'other')),
      ...Array.from({ length: 100 }, (_, i) => fakeEntry('b', i + 1, i >= 90 ? 'mine' : 'other')),
    ]
    const tournaments = [
      { id: 'a', players: 100 },
      { id: 'b', players: 100 },
    ]
    const conversion = topConversion({ tournaments, entries } as unknown as TournamentDataset, 'mine')
    expect(conversion).toMatchObject({ lists: 100, topLists: 7 })
    expect(conversion?.expected).toBeCloseTo(90 * (1 / 10) + 10 * (8 / 90), 10)
    expect(conversion?.ratio).toBeCloseTo((7 * 10) / 100 / ((1 * 90) / 100 + (8 * 10) / 100), 10)
    expect(conversion?.text).toContain('razón ajustada por torneo: 0,4×')
    expect(conversion?.text).not.toContain('× lo esperado')
  })

  it('a tournament with only lists of the archetype is left out: there is no rest of the field', () => {
    const entries = [
      ...Array.from({ length: 32 }, (_, i) => fakeEntry('mirror', i + 1, 'mine')),
      ...Array.from({ length: 40 }, (_, i) => fakeEntry('field', i + 1, i < 4 ? 'mine' : 'other')),
    ]
    const tournaments = [
      { id: 'mirror', players: 32 },
      { id: 'field', players: 40 },
    ]
    const conversion = topConversion({ tournaments, entries } as unknown as TournamentDataset, 'mine')
    expect(conversion).toMatchObject({ tournaments: 1, lists: 4, topLists: 4, excluded: { tournaments: 1, lists: 32 } })
    expect(conversion?.expected).toBeCloseTo(4 * (4 / 36), 10)
    expect(conversion?.text).toContain('o solo listas del arquetipo')
  })

  it('the conversions weigh the top like the field: Σ topLists = lists in the top', () => {
    const rows = archetypeRows(dataset)
    const total = rows.reduce((sum, row) => sum + (topConversion(dataset, row.archetype?.id ?? null)?.topLists ?? 0), 0)
    expect(total).toBe(dataset.entries.filter((entry) => entry.placing !== null && entry.placing <= 8).length)
  })

  it('leaves out tournaments under the minimum size and marks few lists as orientativo', () => {
    expect(topConversion(dataset, LUCARIO, { minPlayers: 400 })).toBeNull()
    const blaziken = topConversion(dataset, 'mega-blaziken-ex-b1')
    expect(blaziken?.orientative).toBe(true)
    expect(blaziken?.text).toContain('orientativo')
  })
})
