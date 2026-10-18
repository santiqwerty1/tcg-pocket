import { describe, expect, it } from 'vitest'
import {
  groupSeenMatches,
  normalizeSeenCards,
  type SeenCard,
  seenCardsTextEs,
  suggestArchetypesForCards,
} from '../../src/matches/index.js'
import { buildDataset, DEFAULT_SET_RELEASES, listRows, parseStandings } from '../../src/tournaments/index.js'
import { BIG_ID, readLimitless } from '../helpers/limitless.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
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
const byName = (nameEn: string) => {
  const group = index.groupsByNameEn(nameEn)[0]
  if (!group) throw new Error(`no ${nameEn}`)
  return group.displayCardId
}
const suggest = (cards: SeenCard[]) => suggestArchetypesForCards(cards, dataset.entries, dataset.archetypes, index)

describe('rival cards seen (pedido de Santi del 14/10)', () => {
  it('one line per name, the copies added up to two; an unknown card is refused', () => {
    const greninja = byName('Greninja')
    const cards = normalizeSeenCards(
      [
        { cardId: greninja, count: 1 },
        { cardId: greninja, count: 2 },
        { cardId: byName('Suicune ex'), count: 1 },
      ],
      index,
    )
    expect(cards).toEqual([
      { cardId: greninja, count: 2 },
      { cardId: byName('Suicune ex'), count: 1 },
    ])
    expect(seenCardsTextEs(cards, index)).toBe(
      `2 ${index.cardById(greninja)?.nameEs}, ${index.cardById(byName('Suicune ex'))?.nameEs}`,
    )
    expect(() => normalizeSeenCards([{ cardId: 'ZZ-999', count: 1 }], index)).toThrow(/ZZ-999/)
  })

  it('two Pokémon of a played list suggest its archetype first, as «fits»', () => {
    const list = listRows(dataset, 'group').find((row) => row.archetypeId !== null && row.lists >= 3)
    if (!list) throw new Error('no list')
    const pokemon = list.cards
      .filter((card) => card.groupId && index.cardById(card.groupId)?.cardType === 'pokemon')
      .slice(0, 2)
      .map((card) => ({ cardId: card.groupId as string, count: Math.min(2, card.count) }))
    const found = suggest(pokemon)
    const mine = found.find((fit) => fit.archetypeId === list.archetypeId)
    expect(mine).toMatchObject({ kind: 'fits', seen: 2, best: 2 })
    expect(found[0]?.kind).toBe('fits')
    // The «fits» first, by how many of their lists have the cards.
    const fits = found.filter((fit) => fit.kind === 'fits')
    for (let at = 1; at < fits.length; at++) {
      expect(fits[at - 1]?.fitting).toBeGreaterThanOrEqual(fits[at]?.fitting ?? 0)
    }
    expect(mine?.text).toMatch(
      /(todas sus listas tienen|su lista tiene|% de sus listas tiene) esas cartas \(\d+ listas?\)$/,
    )
  })

  it("Santi's rival of 14/10 (2 Greninja, Suicune ex, Indeedee ex) fits no archetype of B4a: only «parecido»", () => {
    const found = suggest([
      { cardId: byName('Greninja'), count: 2 },
      { cardId: byName('Suicune ex'), count: 1 },
      { cardId: byName('Indeedee ex'), count: 1 },
    ])
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((fit) => fit.kind === 'similar' && fit.best < 3)).toBe(true)
    for (let at = 1; at < found.length; at++) expect(found[at - 1]?.best).toBeGreaterThanOrEqual(found[at]?.best ?? 0)
    expect(found[0]?.text).toMatch(/^parecido: su lista más cercana tiene [12] de 3$/)
    // More copies than any list plays: no list has it.
    expect(suggest([{ cardId: byName('Greninja'), count: 2 }]).every((fit) => fit.best <= 1)).toBe(true)
    expect(suggest([])).toEqual([])
  })

  it('matches with similar cards go in one group, newest first; without cards they are left out', () => {
    const greninja = byName('Greninja')
    const suicune = byName('Suicune ex')
    const indeedee = byName('Indeedee ex')
    const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`)
    const groups = groupSeenMatches(
      [
        {
          id: '1',
          playedAt: at(10),
          cards: [
            { cardId: greninja, count: 2 },
            { cardId: suicune, count: 1 },
          ],
        },
        {
          id: '2',
          playedAt: at(14),
          cards: [
            { cardId: greninja, count: 1 },
            { cardId: suicune, count: 1 },
            { cardId: indeedee, count: 1 },
          ],
        },
        { id: '3', playedAt: at(12), cards: [{ cardId: byName('Mega Steelix ex'), count: 1 }] },
        { id: '4', playedAt: at(13), cards: [] },
      ],
      index,
    )
    expect(groups.map((group) => group.matchIds)).toEqual([['2', '1'], ['3']])
    // The group keeps every name with the most copies seen in one match.
    expect(groups[0]?.cards).toEqual(
      expect.arrayContaining([
        { cardId: greninja, count: 2 },
        { cardId: suicune, count: 1 },
        { cardId: indeedee, count: 1 },
      ]),
    )
    expect(groups[0]?.lastPlayedAt).toEqual(at(14))
  })

  describe('self-review', () => {
    // Synthetic lists: what a test needs of a DatasetEntry (the archetype and the cards).
    const list = (archetypeId: string, cards: [string, number][]) =>
      ({
        archetypeId,
        cards: cards.map(([name, count]) => ({ name, count, groupId: null, cardId: null, set: 'X', number: '1' })),
      }) as never
    const archetypes = new Map([
      ['one', { id: 'one', name: 'Uno' }],
      ['many', { id: 'many', name: 'Muchos' }],
      ['lucario-a', { id: 'lucario-a', name: 'Mega Lucario ex Lucario' }],
      ['lucario-b', { id: 'lucario-b', name: 'Mega Lucario ex Lucario' }],
    ]) as never
    const greninja = { cardId: byName('Greninja'), count: 1 }

    it('an archetype with 3 lists that fit goes before one with a single list at 100 %; one name, one row', () => {
      const entries = [
        list('one', [['Greninja', 1]]),
        list('many', [['Greninja', 1]]),
        list('many', [['Greninja', 2]]),
        list('many', [['Greninja', 1]]),
        list('many', [['Pikachu', 1]]),
        list('lucario-a', [['Greninja', 1]]),
        list('lucario-b', [['Greninja', 1]]),
      ]
      const found = suggestArchetypesForCards([greninja], entries, archetypes, index)
      expect(found.map((fit) => [fit.name, fit.fitting, fit.lists])).toEqual([
        ['Muchos', 3, 4],
        ['Mega Lucario ex Lucario', 2, 2],
        ['Uno', 1, 1],
      ])
    })

    it('two copies seen need two copies in the list', () => {
      const entries = [list('one', [['Greninja', 1]]), list('many', [['Greninja', 2]])]
      const found = suggestArchetypesForCards([{ ...greninja, count: 2 }], entries, archetypes, index)
      expect(found.map((fit) => [fit.name, fit.kind])).toEqual([['Muchos', 'fits']])
    })

    it('two cards of one name are one line; a card the catalog lost is kept when it was stored, and grouped by id', () => {
      expect(
        normalizeSeenCards(
          [
            { cardId: 'A1-150', count: 1 },
            { cardId: 'B1a-38', count: 1 },
          ],
          index,
        ),
      ).toEqual([{ cardId: 'A1-150', count: 2 }])
      expect(normalizeSeenCards([{ cardId: 'GONE-1', count: 1 }], index, new Set(['GONE-1']))).toEqual([
        { cardId: 'GONE-1', count: 1 },
      ])
      const groups = groupSeenMatches(
        [{ id: '9', playedAt: new Date('2026-10-14T12:00:00Z'), cards: [{ cardId: 'GONE-1', count: 1 }] }],
        index,
      )
      expect(groups.map((group) => group.matchIds)).toEqual([['9']])
    })

    it('Codex on #114: a card the catalog lost is never checked, so no list «has them all»', () => {
      const entries = [list('many', [['Greninja', 2]])]
      expect(suggestArchetypesForCards([greninja], entries, archetypes, index).map((fit) => fit.kind)).toEqual(['fits'])
      const withLost = suggestArchetypesForCards([greninja, { cardId: 'GONE-1', count: 1 }], entries, archetypes, index)
      expect(withLost).toEqual([
        expect.objectContaining({
          kind: 'similar',
          seen: 2,
          best: 1,
          text: 'parecido: su lista más cercana tiene 1 de 2',
        }),
      ])
    })
  })

  it('Codex on #114: the copies seen add up to 20 at most (a deck has 20 cards)', () => {
    const groups = index.catalog.groups.filter((group) => index.cardById(group.displayCardId)?.cardType === 'pokemon')
    const lines = (n: number, count: number) =>
      groups.slice(0, n).map((group) => ({ cardId: group.displayCardId, count }))
    expect(normalizeSeenCards(lines(10, 2), index).reduce((sum, card) => sum + card.count, 0)).toBe(20)
    expect(() => normalizeSeenCards([...lines(10, 2), ...lines(11, 1).slice(10)], index)).toThrow(/21 cartas vistas/)
  })
})
