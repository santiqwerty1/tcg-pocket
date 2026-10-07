import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeImportRows, parseTrackerCsv, playableCopies } from '../../src/collection/index.js'
import {
  cheapestPrint,
  DEFAULT_RARITY_RULES,
  type DeckGoal,
  deckDeficits,
  editionChances,
  expectedPacksToComplete,
  packProfile,
  type RecommendInput,
  recommendPacks,
} from '../../src/packs/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
const playableByGroup = new Map(
  [...playableCopies(index, units, [])].map(([groupId, copies]) => [groupId, copies.playable]),
)
const owned = (stockCardId: string) => units[stockCardId]?.amountOwned ?? 0

/** Deck 13 as the file notes it should be: a second Hoopa ex instead of Darkrai ex (one copy missing). */
function deck13WithTwoHoopa(priority = 3): DeckGoal {
  const cards = deckDraft(13)
    .cards.filter((entry) => entry.cardId !== 'A2-110')
    .map((entry) => (entry.cardId === 'B4-103' ? { cardId: 'B4-103', count: 2 } : entry))
  return { deckId: '13', name: 'Hoopa ex / Mega-Absol ex', priority, cards }
}

function input(overrides: Partial<RecommendInput> = {}): RecommendInput {
  return {
    index,
    decks: [deck13WithTwoHoopa()],
    collection: null,
    alpha: 0.7,
    playable: (groupId) => playableByGroup.get(groupId) ?? 0,
    owned,
    available: (packId) => packId !== 'A4b/deluxepack',
    model: 'corrected',
    onlyAvailable: false,
    rarityRule: (rarity) => DEFAULT_RARITY_RULES[rarity],
    ...overrides,
  }
}

describe('deckDeficits', () => {
  it('takes the maximum over decks, weighted by priority, never the sum', () => {
    const a = deck13WithTwoHoopa(1)
    const b = { ...deck13WithTwoHoopa(3), deckId: '99', name: 'Otro' }
    const deficits = deckDeficits([a, b], index, (groupId) => playableByGroup.get(groupId) ?? 0)
    expect(deficits).toHaveLength(1)
    expect(deficits[0]).toMatchObject({ groupId: 'B4-103', nameEs: 'Hoopa ex', missing: 1, weight: 3 })
    expect(deficits[0]?.decks.map((deck) => deck.deckId)).toEqual(['13', '99'])
    expect(deckDeficits([{ ...a, priority: 0 }], index, () => 0)).toEqual([])
  })
})

describe('recommendPacks: PLAN §7 Fase 4 acceptance (c), deck 13 missing one Hoopa ex', () => {
  it('corrected model: B4b/deluxepackmega first with 1/70 (4th card ◊◊◊◊), above B4 with 1.06 %', () => {
    const result = recommendPacks(input())
    expect(result.rows[0]).toMatchObject({ packId: 'B4b/deluxepackmega', available: true, wanted: 1 })
    expect(result.rows[0]?.probability).toBeCloseTo(1 / 70, 12)
    const b4 = result.rows.find((row) => row.packId === 'B4/ruleroftheskiespack')
    expect((b4?.probability ?? 0) * 100).toBeCloseTo(1.064, 3)
    expect(result.rows.findIndex((row) => row.packId === 'B4/ruleroftheskiespack')).toBe(1)
    // The tracker would say 0 % for B4b: the reason is the reprint (bug 2).
    expect(result.rows[0]?.otherModel).toEqual({ model: 'tracker', probability: 0, reasons: ['reprints'] })
    expect(result.rows[0]?.packsFor50).toBe(49)
    expect(result.rows[0]?.packsFor90).toBe(161)
  })

  it('the missing card shows «500 puntos, intercambiable» and the best pack to open', () => {
    const [hoopa] = recommendPacks(input()).missing
    expect(hoopa).toMatchObject({
      nameEs: 'Hoopa ex',
      missing: 1,
      cheapest: { cardId: 'B4-103', rarity: '◊◊◊◊', points: 500, verified: false, tradeable: true },
      bestPack: { packId: 'B4b/deluxepackmega' },
      pointsInPacks: 100,
      advice: 'open',
    })
    expect(hoopa?.bestPack?.packsPerCopy).toBeCloseTo(70, 9)
  })

  it('tracker model: B4b gives 0 % and B4 comes first', () => {
    const result = recommendPacks(input({ model: 'tracker' }))
    expect(result.rows[0]?.packId).toBe('B4/ruleroftheskiespack')
    const b4b = result.rows.find((row) => row.packId === 'B4b/deluxepackmega')
    expect(b4b?.probability).toBe(0)
    expect(b4b?.otherModel.probability).toBeCloseTo(1 / 70, 12)
  })

  it('A4b and B4b are in the table with their switch (acceptance d); onlyAvailable leaves A4b out', () => {
    const all = recommendPacks(input())
    expect(all.rows.find((row) => row.packId === 'A4b/deluxepack')?.available).toBe(false)
    expect(all.rows.find((row) => row.packId === 'B4b/deluxepackmega')?.available).toBe(true)
    expect(all.rows).toHaveLength(29)
    const available = recommendPacks(input({ onlyAvailable: true }))
    expect(available.rows.some((row) => row.packId === 'A4b/deluxepack')).toBe(false)
    expect(available.rows).toHaveLength(28)
  })

  it('expected packs to complete the deck: exactly 70 from B4b', () => {
    const [deck] = recommendPacks(input()).decks
    expect(deck).toMatchObject({ deckId: '13', missingCopies: 1, notInPacks: [] })
    expect(deck?.bestPacks[0]).toMatchObject({
      packId: 'B4b/deluxepackmega',
      covered: 1,
      method: 'exact',
      ci95: null,
    })
    expect(deck?.bestPacks[0]?.expectedPacks).toBeCloseTo(70, 9)
  })

  it('when the missing cards come from different packs, each pack says how many copies it covers', () => {
    // A ◊ card of A1 that the 6/10 collection does not have, next to the missing Hoopa ex of B4.
    const absent = index.catalog.cards.find(
      (c) =>
        c.expansionId === 'A1' &&
        c.rarity === '◊' &&
        (playableByGroup.get(c.functionalGroupId) ?? 0) === 0 &&
        index.cardsOfGroup(c.functionalGroupId).every((other) => other.expansionId === 'A1'),
    )
    if (!absent) throw new Error('the collection has every A1 ◊ card')
    const goal = deck13WithTwoHoopa()
    const result = recommendPacks(
      input({ decks: [{ ...goal, cards: [...goal.cards, { cardId: absent.id, count: 1 }] }] }),
    )
    const [deck] = result.decks
    expect(deck?.missingCopies).toBe(2)
    expect(deck?.bestPacks.length).toBeGreaterThan(0)
    for (const pack of deck?.bestPacks ?? []) expect(pack.covered).toBe(1)
    const expansions = new Set(deck?.bestPacks.map((pack) => pack.packId.split('/')[0]))
    expect(expansions.has('A1') || expansions.has('B4b')).toBe(true)
  })

  it('weights the two goals with α; the collection goal alone ranks by expected missing editions', () => {
    const collection = { rarities: [], copies: 1 }
    const decksOnly = recommendPacks(input())
    const both = recommendPacks(input({ collection, alpha: 1 }))
    // α = 1 gives the collection no weight: same ranking value as decks only.
    for (const row of decksOnly.rows) {
      expect(both.rows.find((r) => r.packId === row.packId)?.expectedValue).toBeCloseTo(row.expectedValue, 12)
    }
    // Each goal is scaled to its best pack: alone, the collection goal scores expected wanted cards / best pack's.
    const collectionOnly = recommendPacks(input({ decks: [], collection }))
    const best = Math.max(...collectionOnly.rows.map((row) => row.expected))
    expect(collectionOnly.rows[0]?.expectedValue).toBeCloseTo(1, 12)
    for (const row of collectionOnly.rows) {
      expect(row.expectedValue).toBeCloseTo(row.expected / best, 12)
      expect(row.decks).toBeNull()
    }
    // α = 0.7 with thousands of wanted editions for the collection: the deck still decides (B4b first).
    const mixed = recommendPacks(input({ collection, alpha: 0.7 }))
    expect(mixed.rows[0]?.packId).toBe('B4b/deluxepackmega')
    expect(mixed.rows[0]?.expectedValue).toBeGreaterThan(0.7)
    expect(mixed.rows[0]?.expectedValue).toBeLessThanOrEqual(1)
    // α = 0.2: the collection decides.
    const collectionFirst = recommendPacks(input({ collection, alpha: 0.2 }))
    expect(collectionFirst.rows[0]?.packId).not.toBe('B4b/deluxepackmega')
    // Filter (a) of the fixtures with the tracker model: A4b/deluxepack leads with 96.5096 %.
    const trackerA = recommendPacks(input({ decks: [], collection, model: 'tracker' }))
    const deluxe = trackerA.rows.find((row) => row.packId === 'A4b/deluxepack')
    expect((deluxe?.probability ?? 0) * 100).toBeCloseTo(96.5096, 4)
  })
})

describe('cheapestPrint', () => {
  it('skips promos and marks the trade rule of rarity and expansion', () => {
    expect(cheapestPrint(index, 'A1-1', (rarity) => DEFAULT_RARITY_RULES[rarity])).toMatchObject({
      rarity: '◊',
      points: 35,
      tradeable: true,
    })
  })
})

describe('expectedPacksToComplete', () => {
  const b4 = packProfile('B4/ruleroftheskiespack', index)
  if (!b4) throw new Error('no B4 profile')
  const chancesOf = (cardId: string) => {
    const card = index.cardById(cardId)
    if (!card) throw new Error(cardId)
    return [editionChances(card, b4, 'corrected')]
  }
  const twoCommons = b4.cards.filter((card) => card.rarity === '◊').slice(0, 2)

  it('exact for single copies: one card is 1/p; two cards follow inclusion–exclusion', () => {
    const [first, second] = twoCommons
    if (!first || !second) throw new Error('no commons')
    const one = expectedPacksToComplete([{ groupId: 'x', copies: 1, chances: chancesOf(first.id) }], b4.structure)
    const p = (chancesOf(first.id)[0]?.perPosition ?? []).reduce((sum, v) => sum + v, 0)
    expect(one?.method).toBe('exact')
    // Three ◊ positions: P(≥1) = 0.9995·(1 − (1 − p/3)^3), so 1/P.
    expect(one?.expectedPacks).toBeGreaterThan(1 / p)
    const two = expectedPacksToComplete(
      [
        { groupId: 'x', copies: 1, chances: chancesOf(first.id) },
        { groupId: 'y', copies: 1, chances: chancesOf(second.id) },
      ],
      b4.structure,
    )
    expect(two?.expectedPacks).toBeGreaterThan(one?.expectedPacks ?? 0)
  })

  it('simulates when copies > 1, reproducibly, and the exact value of one copy lies below', () => {
    const [first] = twoCommons
    if (!first) throw new Error('no commons')
    const single = expectedPacksToComplete([{ groupId: 'x', copies: 1, chances: chancesOf(first.id) }], b4.structure)
    const items = [{ groupId: 'x', copies: 2, chances: chancesOf(first.id) }]
    const a = expectedPacksToComplete(items, b4.structure)
    const b = expectedPacksToComplete(items, b4.structure)
    expect(a).toEqual(b)
    expect(a?.method).toBe('simulation')
    // Two copies take about twice as many packs as one.
    expect(a?.expectedPacks).toBeGreaterThan(1.6 * (single?.expectedPacks ?? 0))
    expect(a?.expectedPacks).toBeLessThan(2.4 * (single?.expectedPacks ?? 0))
    expect(a?.ci95?.[0]).toBeLessThan(a?.expectedPacks ?? 0)
  })

  it('is null when a card cannot come out of the pack', () => {
    expect(
      expectedPacksToComplete(
        [{ groupId: 'x', copies: 1, chances: [{ cardId: 'x', perPosition: [0, 0, 0, 0, 0], rare: 0, baby: 0 }] }],
        b4.structure,
      ),
    ).toBeNull()
  })
})
