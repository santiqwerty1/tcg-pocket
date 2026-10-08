import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeImportRows, parseTrackerCsv, playableCopies } from '../../src/collection/index.js'
import {
  archetypeRows,
  buildableLists,
  buildDataset,
  cardUsage,
  DEFAULT_SET_RELEASES,
  deckInTournaments,
  effectiveFormat,
  entriesOfArchetype,
  eraConflict,
  eraMean,
  eraOf,
  eraRange,
  exclusionFromDetails,
  limitlessDetailsSchema,
  limitlessTournamentListSchema,
  listKeyByName,
  listRows,
  listsAgainstCollection,
  mapDecklist,
  newEraWarning,
  parseStandings,
  type StoredEntry,
  type StoredTournament,
  standingsIncomplete,
  totalRecord,
  unlockCards,
  withWithout,
} from '../../src/tournaments/index.js'
import { BIG_ID, NOEX_ID, readLimitless, recentTournaments } from '../helpers/limitless.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const sets = DEFAULT_SET_RELEASES
const big = parseStandings(readLimitless('big_standings.json'))
const noex = parseStandings(readLimitless('noex_standings.json'))

describe('format and era (PLAN §3.5)', () => {
  it('Standard comes as format null; CUSTOM and unknown formats are left out', () => {
    expect(effectiveFormat(null)).toBe('STANDARD')
    expect(effectiveFormat(undefined)).toBe('STANDARD')
    expect(effectiveFormat('NOEX')).toBe('NOEX')
    expect(effectiveFormat('CUSTOM')).toBeNull()
    expect(effectiveFormat('WHATEVER')).toBeNull()
  })

  it('the era is the newest era-opening set released on or before the UTC day; Deluxe packs do not open one', () => {
    expect(eraOf(new Date('2026-08-27T02:00:00Z'), sets)).toBe('B4a')
    expect(eraOf(new Date('2026-08-26T23:59:00Z'), sets)).toBe('B4')
    expect(eraOf(new Date('2026-10-01T17:00:00Z'), sets)).toBe('B4a')
    expect(eraOf(new Date('2025-10-05T17:00:00Z'), sets)).toBe('A4a')
    expect(eraOf(new Date('2024-10-01T00:00:00Z'), sets)).toBeNull()
    expect(eraRange('B4', sets)).toEqual({
      from: new Date('2026-07-30T00:00:00Z'),
      to: new Date('2026-08-27T00:00:00Z'),
    })
    expect(eraRange('B4a', sets)?.to).toBeNull()
  })

  it('a card of a set released after the tournament (or unknown to the table) is a conflict', () => {
    const day = new Date('2026-09-05T16:00:00Z')
    expect(eraConflict(day, ['B4a', 'P-A', 'A1'], sets)).toBeNull()
    expect(eraConflict(day, ['B4a', 'B4b'], sets)).toBe('B4b')
    expect(eraConflict(new Date('2026-10-02T00:00:00Z'), ['B4b'], sets)).toBeNull()
    expect(eraConflict(day, ['B5'], sets)).toBe('B5')
  })

  it('warns «era nueva probable» 35 days after the last release', () => {
    expect(newEraWarning('2026-10-08', sets)).toMatchObject({ lastRelease: { code: 'B4b' }, days: 8, likely: false })
    expect(newEraWarning('2026-11-05', sets)).toMatchObject({ days: 36, likely: true })
  })
})

describe('tournament list (acceptance: era B4a on 6/10/2026)', () => {
  const tournaments = limitlessTournamentListSchema.parse(recentTournaments())

  it('154 tournaments and 12.616 players with format null, ≥ 12 players and era B4a', () => {
    expect(tournaments).toHaveLength(400)
    const b4a = tournaments.filter(
      (t) => effectiveFormat(t.format) === 'STANDARD' && t.players >= 12 && eraOf(new Date(t.date), sets) === 'B4a',
    )
    expect(b4a).toHaveLength(154)
    expect(b4a.reduce((sum, t) => sum + t.players, 0)).toBe(12_616)
    // CUSTOM tournaments are house rules: out.
    expect(tournaments.filter((t) => t.format === 'CUSTOM').length).toBeGreaterThan(90)
  })

  it('details: no lists, bans or special rules exclude a tournament', () => {
    const details = limitlessDetailsSchema.parse(readLimitless('big_details.json'))
    expect(details).toMatchObject({ id: BIG_ID, decklists: true, isOnline: true })
    expect(exclusionFromDetails(details)).toBeNull()
    expect(exclusionFromDetails({ ...details, decklists: false })).toBe('no_decklists')
    expect(exclusionFromDetails({ ...details, specialRules: ['solo 70 PS'] })).toBe('special_rules')
    expect(exclusionFromDetails({ ...details, bannedCards: [{ set: 'A1', number: '1' }] })).toBe('banned_cards')
  })
})

describe('standings (acceptance: the two saved standings normalize to their totals)', () => {
  it('NOEX: 190-204-40 over 79 lists, 38 placings null, no energies', () => {
    expect(noex).toHaveLength(79)
    expect(totalRecord(noex)).toEqual({ wins: 190, losses: 204, ties: 40 })
    expect(noex.filter((entry) => entry.placing === null)).toHaveLength(38)
    expect(noex.every((entry) => entry.energies.length === 0)).toBe(true)
    expect(standingsIncomplete(noex)).toBe(false)
  })

  it('PMPT #45: 1051-1119-20 over 393 lists, energies of 1, 2 and 3 types', () => {
    expect(big).toHaveLength(393)
    expect(totalRecord(big)).toEqual({ wins: 1051, losses: 1119, ties: 20 })
    const byTypes = [1, 2, 3].map((n) => big.filter((entry) => entry.energies.length === n).length)
    expect(byTypes).toEqual([367, 23, 3])
    expect(standingsIncomplete([])).toBe(true)
  })

  it('exact lists by name: 67 of 79 and 275 of 393 distinct (editions merged)', () => {
    // docs/fase0 counted 68 and 277 keeping lines of two editions apart («1 Heliolisk B1a 29» + «1 Heliolisk B4 61»);
    // the brief says «mismas 20 cartas por nombre, sin mirar la edición», so two Heliolisk are two Heliolisk.
    const distinct = (entries: typeof big) =>
      new Set(
        entries.map((entry) => listKeyByName([...(entry.decklist?.pokemon ?? []), ...(entry.decklist?.trainer ?? [])])),
      ).size
    expect(distinct(noex)).toBe(67)
    expect(distinct(big)).toBe(275)
  })

  it('every set+number maps to a card of the catalog with the same name', () => {
    for (const entry of [...big, ...noex]) {
      for (const card of mapDecklist(entry.decklist ?? { pokemon: [], trainer: [] }, index)) {
        expect(card.cardId).not.toBeNull()
        expect(index.cardById(card.cardId as string)?.nameEn).toBe(card.name)
      }
    }
  })
})

describe('dataset and records', () => {
  const tournaments: StoredTournament[] = [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
    { id: NOEX_ID, name: 'NOEX', date: new Date('2026-09-09T18:00:00Z'), format: 'NOEX', players: 79 },
  ]
  const entries: StoredEntry[] = [
    ...big.map((entry) => ({ ...entry, tournamentId: BIG_ID })),
    ...noex.map((entry) => ({ ...entry, tournamentId: NOEX_ID })),
  ]
  const dataset = buildDataset({ tournaments, entries, index, sets, era: 'B4a', format: 'STANDARD', minPlayers: 12 })

  it('keeps one format: the NOEX tournament is out of the Standard era', () => {
    expect(dataset.tournaments.map((t) => t.id)).toEqual([BIG_ID])
    expect(dataset.tournaments[0]).toMatchObject({ lists: 393, conflict: null })
    expect(dataset.entries).toHaveLength(393)
    expect(dataset.unknownCards).toEqual([])
    expect(dataset.entries.every((entry) => entry.keyByGroup !== null)).toBe(true)
    const noexOnly = buildDataset({ tournaments, entries, index, sets, era: 'B4a', format: 'NOEX', minPlayers: 12 })
    expect(noexOnly.entries).toHaveLength(79)
    expect(
      buildDataset({ tournaments, entries, index, sets, era: 'B4a', format: 'STANDARD', minPlayers: 400 }).entries,
    ).toEqual([])
  })

  it('the era mean is ΣW / Σ(W+L+T), not 50 %: 48,0 % [45,9; 50,1] for PMPT #45', () => {
    const mean = eraMean(dataset)
    expect(mean.record).toEqual({ wins: 1051, losses: 1119, ties: 20 })
    expect(mean.rate?.value).toBeCloseTo((1051 / 2190) * 100, 9)
    expect(mean.rate?.ci95[0]).toBeCloseTo(45.9, 1)
    expect(mean.rate?.ci95[1]).toBeCloseTo(50.1, 1)
    expect(mean.rate).toMatchObject({ source: 'tournament', sampleKind: 'lists', samples: 393, orientative: false })
  })

  it('archetypes: 128 in PMPT #45, sorted by lists, each with n, interval and «orientativo» under 30 lists', () => {
    const rows = archetypeRows(dataset)
    expect(rows).toHaveLength(128)
    expect(rows.reduce((sum, row) => sum + row.lists, 0)).toBe(393)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]?.lists).toBeGreaterThanOrEqual(rows[i]?.lists ?? 0)
    const top = rows[0]
    expect(top?.rate?.orientative).toBe((top?.lists ?? 0) < 30)
    expect(rows.at(-1)?.rate?.orientative).toBe(true)
  })

  it('exact lists: 275 by name, and at least as many by functional card', () => {
    expect(listRows(dataset, 'name')).toHaveLength(275)
    const byGroup = listRows(dataset, 'group')
    expect(byGroup.length).toBeGreaterThanOrEqual(275)
    expect(byGroup.reduce((sum, row) => sum + row.lists, 0)).toBe(393)
    expect(byGroup[0]?.cards.reduce((sum, card) => sum + card.count, 0)).toBe(20)
  })

  it('an archetype with and without a card: two rows that add up to the archetype', () => {
    const [top] = archetypeRows(dataset)
    const entriesOfTop = entriesOfArchetype(dataset, top?.archetype?.id ?? null)
    const usage = cardUsage(entriesOfTop)
    // A card some lists play and others do not.
    const split = usage.find((row) => row.lists > 0 && row.lists < entriesOfTop.length)
    if (!split) throw new Error('every list of the top archetype is identical')
    const result = withWithout(dataset, entriesOfTop, split.groupId, 1)
    expect(result.with.lists).toBe(split.lists)
    expect(result.with.lists + result.without.lists).toBe(entriesOfTop.length)
    expect(result.with.record.wins + result.without.record.wins).toBe(top?.record.wins)
  })
})

describe('lists against the 6/10 collection', () => {
  const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
  const playable = new Map([...playableCopies(index, units, [])].map(([groupId, copies]) => [groupId, copies.playable]))
  const tournaments: StoredTournament[] = [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
  ]
  const dataset = buildDataset({
    tournaments,
    entries: big.map((entry) => ({ ...entry, tournamentId: BIG_ID })),
    index,
    sets,
    era: 'B4a',
    format: 'STANDARD',
    minPlayers: 12,
  })
  const rows = listsAgainstCollection(dataset, (groupId) => playable.get(groupId) ?? 0)

  it('a buildable list lacks nothing; the others say which copies are missing', () => {
    const buildable = buildableLists(rows)
    expect(buildable.length).toBeGreaterThan(0)
    expect(buildable.every((row) => row.missing.length === 0)).toBe(true)
    for (const row of rows) {
      for (const item of row.missing) expect(item.have).toBeLessThan(item.need)
    }
  })

  it('unlock cards: lists missing exactly that card, most lists first', () => {
    const unlock = unlockCards(rows)
    expect(unlock.length).toBeGreaterThan(0)
    for (let i = 1; i < unlock.length; i++) expect(unlock[i - 1]?.lists).toBeGreaterThanOrEqual(unlock[i]?.lists ?? 0)
    for (const card of unlock) {
      expect(card.unlocked).toHaveLength(card.lists)
      for (const row of card.unlocked) expect(row.missing.map((item) => item.groupId)).toEqual([card.groupId])
      expect(card.copies).toBeGreaterThanOrEqual(1)
      expect(card.rate?.sampleKind).toBe('lists')
    }
  })

  it('deck 2 (Mega-Blaziken ex): keys of its list and an archetype guessed from the closest lists', () => {
    const where = deckInTournaments(dataset, deckDraft(2).cards, index)
    expect(where.keyByGroup).toMatch(/^[0-9a-f]{14}$/)
    expect(where.guessed?.archetypeId).toMatch(/blaziken/)
  })
})
