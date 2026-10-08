import { describe, expect, it } from 'vitest'
import type { CardId } from '../../src/catalog/types.js'
import { validateDeck } from '../../src/decks/index.js'
import { buildFromCore, CORE_MIN_LISTS, usableWith } from '../../src/lab/index.js'
import { buildDataset, DEFAULT_SET_RELEASES, parseStandings } from '../../src/tournaments/index.js'
import { BIG_ID, readLimitless } from '../helpers/limitless.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
// PMPT #45 (393 lists, 5/9/2026): a real era's meta.
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
const edition = (groupId: CardId) => index.cardById(index.groupById(groupId)?.displayCardId ?? groupId) ?? null
const listsPlaying = (groupId: CardId) => dataset.entries.filter((entry) => entry.groups.has(groupId)).length
/** The most played functional card with that English name. */
const groupNamed = (nameEn: string) => {
  const group = index.groupsByNameEn(nameEn).sort((a, b) => listsPlaying(b.id) - listsPlaying(a.id))[0]
  if (!group) throw new Error(`no group ${nameEn}`)
  return group.id
}
/** English name → copies (summed across functional cards with the same name). */
const names = (cards: readonly { cardId: CardId; count: number }[]) => {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const name = index.cardById(card.cardId)?.nameEn ?? card.cardId
    counts.set(name, (counts.get(name) ?? 0) + card.count)
  }
  return counts
}
const size = (cards: readonly { count: number }[]) => cards.reduce((sum, card) => sum + card.count, 0)

describe('build from a core (Fase 19)', () => {
  const blaziken = groupNamed('Mega Blaziken ex')
  const lucario = groupNamed('Mega Lucario ex')

  it('one card: the lists that play it give the rest, with its line (Rare Candy when they skip the Stage 1)', () => {
    const build = buildFromCore({ dataset, index, core: [blaziken], edition, maxCopies: () => 2 })
    expect(build.basis).toEqual({ kind: 'together', lists: listsPlaying(blaziken) })
    expect(build.basis.lists).toBeGreaterThanOrEqual(CORE_MIN_LISTS)
    expect(build.energies).toEqual(['fire'])
    expect(build.left).toEqual([])
    expect(build.problems).toEqual([])
    expect(size(build.cards)).toBe(20)
    const cards = names(build.cards)
    expect(cards.get('Mega Blaziken ex')).toBe(2)
    expect(cards.get('Torchic')).toBe(2)
    expect(cards.get('Rare Candy')).toBe(2)
    expect(cards.has('Combusken')).toBe(false)
    expect(build.picks.find((pick) => pick.groupId === blaziken)).toMatchObject({ reason: 'core', share: null })
    expect(
      build.picks.filter((pick) => pick.reason === 'line').map((pick) => index.cardById(pick.cardId)?.nameEn),
    ).toEqual(['Rare Candy', 'Torchic'])
    // The rest: most played first, with its share of the basis lists.
    const usage = build.picks.filter((pick) => pick.reason === 'usage')
    expect(usage.length).toBeGreaterThan(5)
    const shares = usage.map((pick) => pick.share ?? -1)
    expect(shares).toEqual([...shares].sort((a, b) => b - a))
    expect(validateDeck({ cards: build.cards, energies: build.energies }, index).ok).toBe(true)
  })

  it('without Rare Candy to play, the Stage 1 goes in', () => {
    const candy = groupNamed('Rare Candy')
    const build = buildFromCore({
      dataset,
      index,
      core: [blaziken],
      edition,
      maxCopies: (groupId) => (groupId === candy ? 0 : 2),
    })
    const cards = names(build.cards)
    expect(cards.has('Rare Candy')).toBe(false)
    expect(cards.get('Combusken')).toBe(2)
    expect(cards.get('Torchic')).toBe(2)
    expect(build.problems).toEqual([])
  })

  it('one copy of each of two Riolu: the line takes both (evolving goes by name)', () => {
    const riolus = index.groupsByNameEn('Riolu').map((group) => group.id)
    expect(riolus.length).toBeGreaterThanOrEqual(2)
    const build = buildFromCore({
      dataset,
      index,
      core: [lucario],
      edition,
      maxCopies: (groupId) => (riolus.includes(groupId) ? 1 : 2),
    })
    const line = build.picks.filter((pick) => pick.reason === 'line')
    expect(line.map((pick) => pick.copies)).toEqual([1, 1])
    expect(new Set(line.map((pick) => pick.groupId)).size).toBe(2)
    expect(names(build.cards).get('Riolu')).toBe(2)
  })

  it('two cards nobody plays together: the lists that play either, both energies, at most two copies per name', () => {
    expect(dataset.entries.filter((entry) => entry.groups.has(blaziken) && entry.groups.has(lucario))).toHaveLength(0)
    const build = buildFromCore({ dataset, index, core: [blaziken, lucario], edition, maxCopies: () => 2 })
    expect(build.basis.kind).toBe('partial')
    expect(build.basis.lists).toBe(listsPlaying(blaziken) + listsPlaying(lucario))
    expect(build.energies).toEqual(['fire', 'fighting'])
    const cards = names(build.cards)
    expect(cards.get('Mega Blaziken ex')).toBe(2)
    expect(cards.get('Mega Lucario ex')).toBe(2)
    expect(size(build.cards)).toBe(20)
    for (const count of cards.values()) expect(count).toBeLessThanOrEqual(2)
    for (const card of build.cards) {
      const played = index.cardById(card.cardId)
      if (played) expect(usableWith(played, build.energies)).toBe(true)
    }
  })

  it('the collection: copies capped, missing cards left out, a core card not owned or not playable is reported', () => {
    const owned = new Map<CardId, number>()
    for (const row of dataset.entries.flatMap((entry) => [...entry.groups.keys()])) owned.set(row, 1)
    owned.set(blaziken, 2)
    const build = buildFromCore({
      dataset,
      index,
      core: [blaziken, lucario, groupNamed('Greninja')],
      edition: (groupId) => (groupId === groupNamed('Greninja') ? null : edition(groupId)),
      maxCopies: (groupId) => (groupId === lucario ? 0 : (owned.get(groupId) ?? 0)),
    })
    expect(build.left).toEqual([
      { groupId: lucario, reason: 'not_owned' },
      { groupId: groupNamed('Greninja'), reason: 'unplayable' },
    ])
    expect(build.basis).toEqual({ kind: 'together', lists: listsPlaying(blaziken) })
    expect(names(build.cards).get('Mega Blaziken ex')).toBe(2)
    for (const pick of build.picks) {
      if (pick.groupId !== blaziken) expect(pick.copies).toBe(1)
      expect(pick.groupId).not.toBe(lucario)
    }
  })

  it('a core no list plays: what the era plays; given energies win', () => {
    const empty = { ...dataset, entries: [] }
    const build = buildFromCore({ dataset: empty, index, core: [blaziken], edition, maxCopies: () => 2 })
    expect(build.basis).toEqual({ kind: 'era', lists: 0 })
    expect(names(build.cards).get('Mega Blaziken ex')).toBe(2)
    expect(build.problems.length).toBeGreaterThan(0) // only the core and its line: not 20 cards
    const given = buildFromCore({
      dataset,
      index,
      core: [blaziken],
      edition,
      maxCopies: () => 2,
      energies: ['fire', 'metal'],
    })
    expect(given.energies).toEqual(['fire', 'metal'])
  })
})
