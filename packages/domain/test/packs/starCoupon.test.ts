import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CatalogIndex } from '../../src/catalog/catalogIndex.js'
import { normalizeImportRows, parseTrackerCsv, playableCopies } from '../../src/collection/index.js'
import {
  compareStarCouponPacks,
  type DeckGoal,
  PACKS_LIMITED_BY_DEFAULT,
  PACKS_OFF_BY_DEFAULT,
  type StarCouponInput,
  type StarCouponPack,
  starCouponPlan,
} from '../../src/packs/index.js'
import { COLLECTION_CSV_PATH, catalogIndex, loadCollectionCsv, loadFixtures } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
const playableByGroup = new Map(
  [...playableCopies(index, units, [])].map(([groupId, copies]) => [groupId, copies.playable]),
)

/** The 6/10 CSV read without src/collection: copies per InternalId (reprints repeat the same count). */
const csvOwned = new Map<number, number>()
for (const row of loadCollectionCsv())
  csvOwned.set(row.InternalId, Math.max(csvOwned.get(row.InternalId) ?? 0, row.NumberOwned))

/** The ☆☆ cards of an expansion, straight from the tracker's cards.json. */
function rawPool(expansion: string): { card_id: string; internal_id: number }[] {
  const cards = loadFixtures().cardsJson as {
    card_id: string
    internal_id: number
    expansion: string
    rarity: string
  }[]
  return cards.filter((card) => card.expansion === expansion && card.rarity === '☆☆')
}

/** A deck goal lacking Entei ex and Suicune ex (A4a), as Santi's were on 3/11 (the 6/10 CSV has none of them). */
const legendaryBeasts: DeckGoal = {
  deckId: '7',
  name: 'Suicune ex / Entei ex',
  priority: 2,
  cards: [
    { cardId: 'A4a-20', count: 2 },
    { cardId: 'A4a-10', count: 2 },
  ],
}

function input(overrides: Partial<StarCouponInput> = {}): StarCouponInput {
  return {
    index,
    decks: [],
    playable: (groupId) => playableByGroup.get(groupId) ?? 0,
    owned: (stockCardId) => units[stockCardId]?.amountOwned ?? 0,
    copies: 1,
    available: (packId) => !PACKS_OFF_BY_DEFAULT.has(packId),
    limited: (packId) =>
      PACKS_LIMITED_BY_DEFAULT.has(packId) ? { until: PACKS_LIMITED_BY_DEFAULT.get(packId) ?? null } : null,
    today: '2026-11-03',
    ...overrides,
  }
}

const ids = (pack: StarCouponPack | undefined, which: 'decks' | 'new' | 'below') =>
  (pack?.cards ?? [])
    .filter((card) => (which === 'decks' ? card.decks.length > 0 : which === 'new' ? card.newEdition : card.belowGoal))
    .map((card) => card.cardId)

describe('starCouponPlan: the ☆☆ pool of each pack', () => {
  it('is the pack’s ☆☆ cards, the same as the tracker lists them', () => {
    const plan = starCouponPlan(input())
    const suicune = plan.packs.find((pack) => pack.packId === 'A4a/suicunepack')
    expect(suicune?.size).toBe(12)
    expect(suicune?.cards.map((card) => card.cardId).sort()).toEqual(
      rawPool('A4a')
        .map((card) => card.card_id)
        .sort(),
    )
    // Multi-pack sets: the set's ☆☆ in each named pack, the «everypack» pseudo pack never has a row.
    expect(plan.packs.some((pack) => pack.packId.endsWith('/everypack'))).toBe(false)
    expect(plan.packs.find((pack) => pack.packId === 'A1/mewtwopack')?.size).toBe(9)
    expect(plan.rarity).toBe('☆☆')
  })

  it('new editions: the edition has no copy in the real CSV (checked row by row against the file)', () => {
    const plan = starCouponPlan(input())
    let checked = 0
    for (const pack of plan.packs) {
      for (const card of pack.cards) {
        const internalId = index.cardById(card.cardId)?.internalId as number
        expect(card.newEdition, card.cardId).toBe((csvOwned.get(internalId) ?? 0) === 0)
        expect(card.owned, card.cardId).toBe(csvOwned.get(internalId) ?? 0)
        checked += 1
      }
      expect(pack.newEditions).toBe(pack.cards.filter((card) => card.newEdition).length)
      expect(pack.chanceNew).toBe(pack.newEditions / pack.size)
    }
    expect(checked).toBeGreaterThan(300)
    // The 6/10 collection: every ☆☆ of Suicune missing, one of Mega Gardevoir's 23 owned.
    expect(plan.packs.find((pack) => pack.packId === 'B2/megagardevoirpack')).toMatchObject({
      size: 23,
      newEditions: 22,
    })
  })
})

describe('starCouponPlan: for the decks (the recommendation’s deck goals)', () => {
  it('a deck lacking Entei ex and Suicune ex puts Suicune (A4a) first: 3 of its 12 for the decks, 12 new', () => {
    const plan = starCouponPlan(input({ decks: [legendaryBeasts] }))
    const first = plan.packs[0]
    expect(first).toMatchObject({ packId: 'A4a/suicunepack', size: 12, forDecks: 3, newEditions: 12 })
    expect(first?.chanceDecks).toBe(3 / 12)
    // Any edition of the functional card does for a deck: both Entei ex arts and the Suicune ex one.
    expect(ids(first, 'decks')).toEqual(['A4a-79', 'A4a-80', 'A4a-87'])
    expect(first?.cards.find((card) => card.cardId === 'A4a-79')?.decks).toEqual(['Suicune ex / Entei ex'])
    expect(plan.best).toEqual(['A4a/suicunepack'])
    // Without the deck, Suicune ties with every pack whose ☆☆ are all new.
    const alone = starCouponPlan(input())
    expect(alone.packs[0]?.forDecks).toBe(0)
    expect(alone.best).toContain('A4a/suicunepack')
    expect(alone.best.length).toBeGreaterThan(1)
  })

  it('counts only what the deck goals still lack: playable copies of any edition, priority above 0', () => {
    // Two playable Entei ex (any edition): only Suicune ex is missing.
    const enteiOwned = starCouponPlan(
      input({
        decks: [legendaryBeasts],
        playable: (groupId) => (groupId === 'A4a-10' ? 2 : (playableByGroup.get(groupId) ?? 0)),
      }),
    )
    expect(ids(enteiOwned.packs[0], 'decks')).toEqual(['A4a-80'])
    // One Entei ex playable is still one short of the deck's two.
    const oneEntei = starCouponPlan(
      input({
        decks: [legendaryBeasts],
        playable: (groupId) => (groupId === 'A4a-10' ? 1 : (playableByGroup.get(groupId) ?? 0)),
      }),
    )
    expect(oneEntei.packs[0]?.forDecks).toBe(3)
    // A deck with priority 0 is not a goal of Sobres.
    const off = starCouponPlan(input({ decks: [{ ...legendaryBeasts, priority: 0 }] }))
    expect(off.packs.every((pack) => pack.forDecks === 0)).toBe(true)
    // Two decks lacking the same card: both named, the card counted once.
    const two = starCouponPlan(
      input({
        decks: [legendaryBeasts, { deckId: '9', name: 'Entei', priority: 1, cards: [{ cardId: 'A4a-10', count: 1 }] }],
      }),
    )
    expect(two.packs[0]?.forDecks).toBe(3)
    expect(two.packs[0]?.cards.find((card) => card.cardId === 'A4a-87')?.decks).toEqual([
      'Suicune ex / Entei ex',
      'Entei',
    ])
  })

  it('the decks share decides before the new share: 1 of 12 for the decks beats 10 of 10 new', () => {
    const plan = starCouponPlan(
      input({
        decks: [{ ...legendaryBeasts, cards: [{ cardId: 'A4a-20', count: 1 }] }],
        // Every A4a ☆☆ owned but Suicune ex's: Suicune gives only 1 new of 12.
        owned: (stockCardId) => (stockCardId.startsWith('A4a-') && stockCardId !== 'A4a-80' ? 1 : 0),
      }),
    )
    expect(plan.packs[0]).toMatchObject({ packId: 'A4a/suicunepack', forDecks: 1, newEditions: 1 })
    expect(plan.packs[1]?.chanceNew).toBe(1)
  })
})

describe('starCouponPlan: new editions and the collection goal', () => {
  it('below the goal follows «Copias por edición»; new is always no copy', () => {
    // Owned: Jumpluff ex A4a-78 ×1, Raikou ex A4a-81 ×2, everything else none.
    const owned = (stockCardId: string) => ({ 'A4a-78': 1, 'A4a-81': 2 })[stockCardId] ?? 0
    const one = starCouponPlan(input({ owned, copies: 1 })).packs.find((pack) => pack.packId === 'A4a/suicunepack')
    expect(one).toMatchObject({ newEditions: 10, belowGoal: 10 })
    const two = starCouponPlan(input({ owned, copies: 2 }))
    expect(two.goalCopies).toBe(2)
    const suicune = two.packs.find((pack) => pack.packId === 'A4a/suicunepack')
    expect(suicune).toMatchObject({ newEditions: 10, belowGoal: 11 })
    expect(ids(suicune, 'below')).toContain('A4a-78')
    expect(ids(suicune, 'below')).not.toContain('A4a-81')
    expect(suicune?.cards.find((card) => card.cardId === 'A4a-78')).toMatchObject({ owned: 1, newEdition: false })
  })
})

describe('starCouponPlan: order and ties', () => {
  /** Only these packs on sale. */
  const only =
    (...packIds: string[]) =>
    (packId: string) =>
      packIds.includes(packId)

  it('same shares and the same expansion: by pack id, and both are «best»', () => {
    const plan = starCouponPlan(input({ available: only('A1/pikachupack', 'A1/charizardpack'), owned: () => 0 }))
    expect(plan.packs.map((pack) => [pack.packId, pack.forDecks, pack.newEditions, pack.size])).toEqual([
      ['A1/charizardpack', 0, 10, 10],
      ['A1/pikachupack', 0, 10, 10],
    ])
    expect(plan.best).toEqual(['A1/charizardpack', 'A1/pikachupack'])
    expect(plan.tieBreak).toBe('id')
  })

  it('ties with the 6/10 CSV: the newest expansion first (B4a), not the first id (Charizard A1)', () => {
    const plan = starCouponPlan(input())
    expect(plan.best.length).toBeGreaterThan(10)
    expect(plan.best).toContain('A1/charizardpack')
    expect(plan.packs[0]?.packId).toBe('B4a/teamrocketsambitionpack')
    expect(plan.tieBreak).toBe('newest')
    // The tied ones follow the catalog order backwards: each one's expansion is not older than the next one's.
    const order = (packId: string) => index.packById(packId)?.expansionId ?? ''
    const sortOrder = (packId: string) => index.expansionById(order(packId))?.sortOrder ?? -1
    plan.best.slice(1).forEach((packId, at) => {
      expect(sortOrder(plan.best[at] ?? '')).toBeGreaterThanOrEqual(sortOrder(packId))
    })
  })

  it('ties: a limited-time pack on sale first, the fewest days left first, an unknown end after a known one', () => {
    const limitedUntil = new Map<string, string | null>([
      ['B4b/deluxepackmega', '2026-10-28'],
      ['A1/charizardpack', '2026-10-22'],
      ['A2/dialgapack', null],
    ])
    const plan = starCouponPlan(
      input({
        owned: () => 0,
        today: '2026-10-20',
        limited: (packId) => (limitedUntil.has(packId) ? { until: limitedUntil.get(packId) ?? null } : null),
      }),
    )
    // All new in every pack: the limited ones first, Charizard (2 days) before the Deluxe Mega (8), then Dialga (no end).
    expect(plan.packs.slice(0, 4).map((pack) => [pack.packId, pack.limited?.daysLeft ?? null])).toEqual([
      ['A1/charizardpack', 2],
      ['B4b/deluxepackmega', 8],
      ['A2/dialgapack', null],
      ['B4a/teamrocketsambitionpack', null],
    ])
    expect(plan.packs[3]?.limited).toBeNull()
    expect(plan.tieBreak).toBe('limited')
    // Never above a better share: a pack that stays with a card for the decks still goes first.
    const withDeck = starCouponPlan(
      input({
        owned: () => 0,
        today: '2026-10-20',
        decks: [legendaryBeasts],
        limited: (packId) => (limitedUntil.has(packId) ? { until: limitedUntil.get(packId) ?? null } : null),
      }),
    )
    expect(withDeck.packs[0]?.packId).toBe('A4a/suicunepack')
    expect(withDeck.tieBreak).toBeNull()
  })

  it('the new share ties as a fraction (5 of 10 = 6 of 12), not as a count; then below the goal decides', () => {
    // Mew (A1a, 10 ☆☆) with 5 owned and Dialga (A2, 12 ☆☆) with 6: half new each.
    const mew = starCouponPlan(input({ available: only('A1a/mewpack') })).packs[0]?.cards.map((c) => c.cardId) ?? []
    const dialga =
      starCouponPlan(input({ available: only('A2/dialgapack') })).packs[0]?.cards.map((c) => c.cardId) ?? []
    expect([mew.length, dialga.length]).toEqual([10, 12])
    const copies = new Map<string, number>([
      ...mew.slice(0, 5).map((cardId) => [index.cardById(cardId)?.stockCardId ?? '', 1] as const),
      ...dialga.slice(0, 6).map((cardId) => [index.cardById(cardId)?.stockCardId ?? '', 1] as const),
    ])
    const tied = starCouponPlan(
      input({ available: only('A1a/mewpack', 'A2/dialgapack'), owned: (id) => copies.get(id) ?? 0 }),
    )
    // Tied: the newer expansion (A2) first.
    expect(tied.packs.map((pack) => [pack.packId, pack.newEditions, pack.size])).toEqual([
      ['A2/dialgapack', 6, 12],
      ['A1a/mewpack', 5, 10],
    ])
    expect(tied.best).toEqual(['A2/dialgapack', 'A1a/mewpack'])
    expect(tied.tieBreak).toBe('newest')
    // With «Tener 2» and a second copy of Dialga's first card, the new share still ties and below the goal decides,
    // against the newer expansion: Mew 10 of 10 (its 5 owned have 1 copy each), Dialga 11 of 12.
    const dialgaFirst = index.cardById(dialga[0] ?? '')?.stockCardId ?? ''
    const third = starCouponPlan(
      input({
        available: only('A1a/mewpack', 'A2/dialgapack'),
        owned: (id) => (id === dialgaFirst ? 2 : (copies.get(id) ?? 0)),
        copies: 2,
      }),
    )
    expect(third.packs.map((pack) => [pack.packId, pack.newEditions, pack.belowGoal])).toEqual([
      ['A1a/mewpack', 5, 10],
      ['A2/dialgapack', 6, 11],
    ])
    expect(third.best).toEqual(['A1a/mewpack'])
    expect(third.tieBreak).toBeNull()
  })

  it('compares the shares exactly: 667 of 1000 is above 2 of 3, 8 of 30 ties 4 of 15', () => {
    const pack = (forDecks: number, size: number, newEditions = 0, belowGoal = 0): StarCouponPack => ({
      packId: `X/${forDecks}-${size}`,
      expansionId: 'X',
      size,
      forDecks,
      newEditions,
      belowGoal,
      chanceDecks: forDecks / size,
      chanceNew: newEditions / size,
      chanceBelowGoal: belowGoal / size,
      cards: [],
      limited: null,
    })
    // Both are 66,7 % rounded: only the exact comparison tells them apart.
    expect(compareStarCouponPacks(pack(667, 1000), pack(2, 3))).toBeLessThan(0)
    expect(compareStarCouponPacks(pack(2, 3), pack(667, 1000))).toBeGreaterThan(0)
    expect(compareStarCouponPacks(pack(8, 30), pack(4, 15))).toBe(0)
    // The new share only when the decks share ties, and below the goal only when both tie.
    expect(compareStarCouponPacks(pack(1, 3, 0), pack(2, 7, 7))).toBeLessThan(0)
    expect(compareStarCouponPacks(pack(1, 3, 1, 0), pack(2, 6, 1, 6))).toBeLessThan(0)
    expect(compareStarCouponPacks(pack(1, 3, 1, 0), pack(2, 6, 2, 1))).toBeGreaterThan(0)
    expect(compareStarCouponPacks(pack(1, 3, 1, 1), pack(2, 6, 2, 3))).toBeGreaterThan(0)
    expect(compareStarCouponPacks(pack(1, 3, 1, 1), pack(2, 6, 2, 2))).toBe(0)
  })

  it('no pack gives anything useful: no «best»', () => {
    const plan = starCouponPlan(input({ available: only('A1/mewtwopack'), owned: () => 1 }))
    expect(plan.packs).toHaveLength(1)
    expect(plan.packs[0]).toMatchObject({ forDecks: 0, newEditions: 0, belowGoal: 0 })
    expect(plan.best).toEqual([])
  })
})

describe('starCouponPlan: packs on sale only', () => {
  it('leaves out packs switched off and limited packs past their last day', () => {
    const plan = starCouponPlan(input())
    const packIds = plan.packs.map((pack) => pack.packId)
    // A4b off by default; the Deluxe Mega ended on 28/10.
    expect(packIds).not.toContain('A4b/deluxepack')
    expect(packIds).not.toContain('B4b/deluxepackmega')
    expect(packIds).toHaveLength(27)
    const suicuneOff = starCouponPlan(
      input({ decks: [legendaryBeasts], available: (packId) => packId !== 'A4a/suicunepack' }),
    )
    expect(suicuneOff.packs.map((pack) => pack.packId)).not.toContain('A4a/suicunepack')
    expect(suicuneOff.packs.every((pack) => pack.forDecks === 0)).toBe(true)
  })

  it('a limited pack on its last day stays, with the days left', () => {
    const lastDay = starCouponPlan(input({ today: '2026-10-28' }))
    expect(lastDay.packs.find((pack) => pack.packId === 'B4b/deluxepackmega')?.limited).toEqual({
      until: '2026-10-28',
      daysLeft: 0,
    })
    expect(lastDay.packs.find((pack) => pack.packId === 'A4a/suicunepack')?.limited).toBeNull()
    const noEnd = starCouponPlan(
      input({ limited: (packId) => (packId === 'A4a/suicunepack' ? { until: null } : null) }),
    )
    expect(noEnd.packs.find((pack) => pack.packId === 'A4a/suicunepack')?.limited).toEqual({
      until: null,
      daysLeft: null,
    })
  })

  it('a pack without ☆☆ cards has no row', () => {
    // The same catalog with Suicune's ☆☆ taken out of its pack.
    const pool = new Set(rawPool('A4a').map((card) => card.card_id))
    const without = new CatalogIndex({
      ...index.catalog,
      packs: index.catalog.packs.map((pack) =>
        pack.id === 'A4a/suicunepack' ? { ...pack, cardIds: pack.cardIds.filter((id) => !pool.has(id)) } : pack,
      ),
    })
    const plan = starCouponPlan(input({ index: without, decks: [legendaryBeasts] }))
    expect(plan.packs.map((pack) => pack.packId)).not.toContain('A4a/suicunepack')
    expect(plan.packs).toHaveLength(26)
  })
})
