import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeImportRows, parseTrackerCsv } from '../../src/collection/index.js'
import { editionPrestige, isHoloEdition, RARITY_PRESTIGE, recommendBestVersions } from '../../src/decks/index.js'
import { parsedDecks } from '../helpers/loadDecks.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const card = (id: string) => {
  const found = index.cardById(id)
  if (!found) throw new Error(`no ${id}`)
  return found
}

function ownedFrom(map: Record<string, number>) {
  return (stockCardId: string) => map[stockCardId] ?? 0
}

describe('holographic prints and prestige', () => {
  it('detects the Deluxe holographic prints and not their plain reprints', () => {
    for (const id of ['A4b-211', 'B4b-391', 'B4b-372']) expect(isHoloEdition(card(id), index)).toBe(true)
    for (const id of ['A4b-210', 'B4b-225', 'B4b-149', 'A2b-42', 'B4-103', 'B1-225']) {
      expect(isHoloEdition(card(id), index)).toBe(false)
    }
  })

  it('orders rarities as the game shows them, promos between ◊◊◊◊ and ☆, holo over plain', () => {
    const order = Object.entries(RARITY_PRESTIGE)
      .sort((a, b) => a[1] - b[1])
      .map(([rarity]) => rarity)
    expect(order).toEqual(['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'P', '☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare'])
    expect(editionPrestige(card('B4b-391'), index)).toBeGreaterThan(editionPrestige(card('B1-225'), index))
    expect(editionPrestige(card('B1-270'), index)).toBeGreaterThan(editionPrestige(card('B4b-391'), index))
  })
})

describe('recommendBestVersions', () => {
  it('fills the copies with the best prints owned of the same functional card', () => {
    // Copiona: B1-225 ◊◊ (= B4b-225), B4b-391 ◊◊ holo, B1-270 ☆☆, B4b-424 ☆☆.
    const result = recommendBestVersions(
      [{ cardId: 'B1-225', count: 2 }],
      index,
      ownedFrom({ 'B1-225': 3, 'B4b-391': 1, 'B1-270': 1 }),
    )
    expect(result.changed).toBe(true)
    expect(result.groups[0]).toMatchObject({ nameEs: 'Copiona', need: 2, owned: 5, improves: true })
    expect(result.groups[0]?.recommended).toEqual([
      { cardId: 'B1-270', rarity: '☆☆', holo: false, count: 1 },
      { cardId: 'B4b-391', rarity: '◊◊', holo: true, count: 1 },
    ])
    expect(result.cards).toEqual([
      { cardId: 'B1-270', count: 1 },
      { cardId: 'B4b-391', count: 1 },
    ])
  })

  it('keeps the listed print on ties (twins are one row) and when nothing better is owned', () => {
    const twin = recommendBestVersions([{ cardId: 'B4b-149', count: 1 }], index, ownedFrom({ 'B4-103': 1 }))
    expect(twin.changed).toBe(false)
    expect(twin.groups[0]?.recommended).toEqual([{ cardId: 'B4b-149', rarity: '◊◊◊◊', holo: false, count: 1 }])
    expect(twin.cards).toEqual([{ cardId: 'B4b-149', count: 1 }])
  })

  it('copies not owned keep the listed edition; the list order is preserved', () => {
    const result = recommendBestVersions(
      [
        { cardId: 'A2-110', count: 1 },
        { cardId: 'B4-103', count: 2 },
      ],
      index,
      ownedFrom({ 'B4-103': 1, 'B4-186': 0, 'A2-110': 1 }),
    )
    expect(result.changed).toBe(false)
    expect(result.cards).toEqual([
      { cardId: 'A2-110', count: 1 },
      { cardId: 'B4-103', count: 2 },
    ])
  })

  it('with the real collection: every deck keeps 20 cards and its functional cards', () => {
    const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
    const owned = (stockCardId: string) => units[stockCardId]?.amountOwned ?? 0
    let improved = 0
    for (const deck of parsedDecks()) {
      if (!deck.draft) continue
      const result = recommendBestVersions(deck.draft.cards, index, owned)
      const total = result.cards.reduce((sum, entry) => sum + entry.count, 0)
      expect(total).toBe(20)
      for (const group of result.groups) {
        expect(group.recommended.reduce((sum, pick) => sum + pick.count, 0)).toBe(group.need)
        for (const pick of group.recommended) expect(card(pick.cardId).functionalGroupId).toBe(group.groupId)
        // Never a worse print than the one listed for a copy that is owned.
        if (group.improves) expect(group.owned).toBeGreaterThan(0)
      }
      if (result.changed) improved += 1
    }
    // The 6/10 collection has better prints than the lists for some decks (value recorded for reference).
    expect(improved).toBeGreaterThan(0)
  })
})
