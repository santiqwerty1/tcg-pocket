import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Rarity } from '../../src/catalog/types.js'
import { normalizeImportRows, parseTrackerCsv, playableCopies } from '../../src/collection/index.js'
import { isHoloEdition } from '../../src/decks/bestVersions.js'
import {
  cheapestPrint,
  collectionWanted,
  DEFAULT_RARITY_RULES,
  type DeckGoal,
  deckDeficits,
  editionChances,
  expectedPacksToComplete,
  PACKS_LIMITED_BY_DEFAULT,
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
    // Each goal is scaled to its best pack on sale: alone, the collection goal scores expected wanted cards / best's.
    const collectionOnly = recommendPacks(input({ decks: [], collection }))
    const best = Math.max(...collectionOnly.rows.filter((row) => row.available).map((row) => row.expected))
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
    // The Deluxe ex is off sale: below every pack on sale, and its score says it would beat them.
    expect(collectionOnly.rows.at(-1)?.packId).toBe('A4b/deluxepack')
    expect(collectionOnly.rows.at(-1)?.expectedValue).toBeGreaterThan(1)
    // α = 0.2: the collection decides.
    const collectionFirst = recommendPacks(input({ collection, alpha: 0.2 }))
    expect(collectionFirst.rows[0]?.packId).not.toBe('B4b/deluxepackmega')
    // Filter (a) of the fixtures with the tracker model: A4b/deluxepack leads with 96.5096 %.
    const trackerA = recommendPacks(input({ decks: [], collection, model: 'tracker' }))
    const deluxe = trackerA.rows.find((row) => row.packId === 'A4b/deluxepack')
    expect((deluxe?.probability ?? 0) * 100).toBeCloseTo(96.5096, 4)
  })
})

describe('versions of the same card (pedido del 7/10/2026)', () => {
  const card = (id: string) => {
    const found = index.cardById(id)
    if (!found) throw new Error(id)
    return found
  }

  it('tells apart the card number, the version (internal id) and the functional card', () => {
    // Same version under two numbers: one tracker row, copies counted together.
    expect(card('A4b-1').internalId).toBe(card('A1-1').internalId)
    expect(card('B4b-1').internalId).toBe(card('B1a-1').internalId)
    expect(card('B4b-8').stockCardId).toBe('B1-2')
    expect(owned(card('B4b-1').stockCardId)).toBe(5)
    // A new version of the same functional card: its own internal id and count; the Deluxe holographic print.
    expect(card('B4b-237').internalId).not.toBe(card('B4b-1').internalId)
    expect(card('B4b-237').functionalGroupId).toBe(card('B4b-1').functionalGroupId)
    expect(owned(card('B4b-237').stockCardId)).toBe(2)
    expect(isHoloEdition(card('B4b-237'), index)).toBe(true)
    expect(isHoloEdition(card('B4b-1'), index)).toBe(false)
    expect(card('A1-227').functionalGroupId).toBe('A1-1')
    expect(owned(card('A1-227').stockCardId)).toBe(1)
    // Same name, different functional card (other attacks): never mixed for the decks.
    expect(card('B1a-1').functionalGroupId).not.toBe(card('A1-1').functionalGroupId)
  })

  it('the collection goal wants versions: a reprint of an owned version is not wanted, a new version is', () => {
    const wanted = new Set(collectionWanted(index, owned, { rarities: [], copies: 3 }).map((c) => c.id))
    // B1a-1 = B4b-1 owned ×5: neither is wanted; B4b-237 (×2) is, on its own.
    expect(wanted.has('B4b-1')).toBe(false)
    expect(wanted.has('B1a-1')).toBe(false)
    expect(wanted.has('B4b-237')).toBe(true)
    // A1-1 = A4b-1 owned ×2: both numbers are the same wanted version.
    expect(wanted.has('A1-1')).toBe(true)
    expect(wanted.has('A4b-1')).toBe(true)
  })
})

describe('limited-time packs: the Deluxe Mega until 28/10 (DECISIONES 4.9)', () => {
  const limited = (packId: string) =>
    PACKS_LIMITED_BY_DEFAULT.has(packId) ? { until: PACKS_LIMITED_BY_DEFAULT.get(packId) ?? null } : null
  const everything = { rarities: [], copies: 10 }

  it('days left, and the exclusive versions are the ones no pack that stays gives', () => {
    const result = recommendPacks(input({ decks: [], collection: everything, limited, today: '2026-10-07' }))
    const b4b = result.rows.find((row) => row.packId === 'B4b/deluxepackmega')
    expect(b4b?.limited?.until).toBe('2026-10-28')
    expect(b4b?.limited?.daysLeft).toBe(21)
    const exclusive = new Map(b4b?.limited?.exclusive.map((item) => [item.cardId, item]))
    // B4b-1 is the version of B1a-1 (B1a gives it); B4b-237 is a new holographic version only B4b gives.
    expect(exclusive.has('B4b-1')).toBe(false)
    expect(exclusive.get('B4b-237')).toEqual({
      cardId: 'B4b-237',
      nameEs: 'Bulbasaur',
      rarity: '◊',
      holo: true,
      goal: 'collection',
    })
    // 193 of the 429 B4b versions are not in any other pack on sale (A4b is off).
    expect(exclusive.size).toBe(193)
    expect(result.rows.find((row) => row.packId === 'B4/ruleroftheskiespack')?.limited).toBeNull()
  })

  it('the exclusive versions weigh limitedBoost times more while the pack is on sale', () => {
    const goal = { decks: [], collection: everything, limited, today: '2026-10-07' }
    const plain = recommendPacks(input({ ...goal, limitedBoost: 1 }))
    const boosted = recommendPacks(input({ ...goal, limitedBoost: 3 }))
    const score = (result: typeof plain) => result.rows.find((row) => row.packId === 'B4b/deluxepackmega')
    expect(boosted.limitedBoost).toBe(3)
    expect(score(boosted)?.expectedValue).toBeGreaterThan(score(plain)?.expectedValue ?? 1)
    // ×1 is the same as no limited pack at all.
    const none = recommendPacks(input({ decks: [], collection: everything }))
    expect(score(plain)?.expectedValue).toBeCloseTo(score(none)?.expectedValue ?? -1, 12)
    expect(score(none)?.limited).toBeNull()
  })

  it('for the decks every B4b card is a reprint: nothing exclusive, and the best pack after it ends', () => {
    const result = recommendPacks(input({ limited, today: '2026-10-07' }))
    const b4b = result.rows.find((row) => row.packId === 'B4b/deluxepackmega')
    expect(b4b?.limited?.exclusive).toEqual([])
    const [hoopa] = result.missing
    expect(hoopa?.bestPack).toMatchObject({ packId: 'B4b/deluxepackmega', limited: true })
    expect(hoopa?.afterLimited?.packId).toBe('B4/ruleroftheskiespack')
    expect((hoopa?.afterLimited?.probability ?? 0) * 100).toBeCloseTo(1.064, 3)
    expect(result.decks[0]?.bestPacks[0]).toMatchObject({ packId: 'B4b/deluxepackmega', limited: true })
  })

  it('past its last day the pack is not on sale: it goes below the ones on sale', () => {
    const result = recommendPacks(input({ limited, today: '2026-10-29' }))
    const at = result.rows.findIndex((row) => row.packId === 'B4b/deluxepackmega')
    expect(result.rows[at]).toMatchObject({ available: false, limited: { daysLeft: -1, exclusive: [] } })
    expect(result.rows.slice(0, at).every((row) => row.available)).toBe(true)
    expect(result.rows[0]?.packId).toBe('B4/ruleroftheskiespack')
    expect(result.missing[0]?.bestPack).toMatchObject({ packId: 'B4/ruleroftheskiespack', limited: false })
    expect(result.missing[0]?.afterLimited).toBeNull()
  })
})

describe('cards out of the packs on sale (the Deluxe ex left the shop, DECISIONES 4.10)', () => {
  it('trade when no pack on sale gives it and its points cannot be earned', () => {
    const absent = index.catalog.cards.find(
      (c) =>
        c.expansionId === 'A1' &&
        c.rarity === '◊' &&
        (playableByGroup.get(c.functionalGroupId) ?? 0) === 0 &&
        index.cardsOfGroup(c.functionalGroupId).every((other) => ['A1', 'A4b'].includes(other.expansionId)),
    )
    if (!absent) throw new Error('the collection has every A1 ◊ card')
    const deck: DeckGoal = { deckId: '1', name: 'Prueba', priority: 1, cards: [{ cardId: absent.id, count: 1 }] }
    const onSale = recommendPacks(input({ decks: [deck] }))
    expect(onSale.missing[0]).toMatchObject({ tradeable: true, cheapest: { points: 35 } })
    // Without the A1 packs (and A4b off) there is no pack to open nor A1 points to earn: trade it.
    const retired = recommendPacks(
      input({ decks: [deck], available: (packId) => !packId.startsWith('A1/') && packId !== 'A4b/deluxepack' }),
    )
    expect(retired.missing[0]).toMatchObject({ bestPack: null, cheapest: null, tradeable: true, advice: 'trade' })
    expect(retired.decks[0]?.notInPacks).toEqual([absent.nameEs])
  })

  it('counts the collection versions no pack on sale gives and how many can be traded', () => {
    const result = recommendPacks(input({ decks: [], collection: { rarities: [], copies: 1 } }))
    const out = result.collectionOutOfPacks
    expect(out?.versions).toBeGreaterThan(0)
    expect(out?.tradeable).toBeGreaterThan(0)
    expect(out?.tradeable).toBeLessThanOrEqual(out?.versions ?? 0)
    // With the Deluxe ex on sale its own versions come back into the packs.
    const withA4b = recommendPacks(input({ decks: [], collection: { rarities: [], copies: 1 }, available: () => true }))
    expect(withA4b.collectionOutOfPacks?.versions).toBeLessThan(out?.versions ?? 0)
    expect(recommendPacks(input()).collectionOutOfPacks).toBeNull()
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

  it('leaves out the prints whose points can no longer be earned', () => {
    const rule = (rarity: Rarity) => DEFAULT_RARITY_RULES[rarity]
    expect(cheapestPrint(index, 'A1-1', rule, (expansionId) => expansionId !== 'A1')?.cardId).toBe('A4b-1')
    expect(cheapestPrint(index, 'A1-1', rule, () => false)).toBeNull()
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
