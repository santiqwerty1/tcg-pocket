import { describe, expect, it } from 'vitest'
import type { CollectionAdjustment } from '../../src/collection/adjustments.js'
import { type TradeDeck, tradeList, tradeText } from '../../src/collection/trades.js'
import { DEFAULT_RARITY_RULES } from '../../src/packs/recommend.js'
import { realCsvNormalized } from '../helpers/collectionCsv.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const tradeableRarity = (rarity: keyof typeof DEFAULT_RARITY_RULES) => DEFAULT_RARITY_RULES[rarity].tradeable

function realDecks(): TradeDeck[] {
  return Array.from({ length: 40 }, (_, i) => {
    const groups = new Map<string, number>()
    for (const card of deckDraft(i + 1).cards) {
      const group = index.cardById(card.cardId)?.functionalGroupId ?? card.cardId
      groups.set(group, (groups.get(group) ?? 0) + card.count)
    }
    return { name: `Mazo ${i + 1}`, groups }
  })
}

function list(decks: TradeDeck[], adjustments: CollectionAdjustment[] = []) {
  return tradeList({ index, stock: realCsvNormalized().units, adjustments, decks, tradeableRarity })
}

describe('lista de intercambio (Fase 31) on the export of 2026-10-06', () => {
  it('the 40 decks are complete: nothing to ask for; spares keep one of each print and two of each card', () => {
    const trades = list(realDecks())
    expect(trades.wants).toEqual([])
    expect(trades.untradeable).toEqual([])
    expect(trades.gives).toHaveLength(758)
    expect(trades.gives.reduce((sum, give) => sum + give.spare, 0)).toBe(1548)
    // Small Balloon = 3 (B3b-64: 1 + B4b-372: 2): one spare, from the print with two.
    expect(trades.gives.filter((give) => give.groupId === 'B3b-64')).toEqual([
      expect.objectContaining({ cardId: 'B4b-372', nameEs: 'Globito', rarity: '◊◊', owned: 2, spare: 1 }),
    ])
    // Never an untradeable rarity.
    expect(trades.gives.every((give) => tradeableRarity(give.rarity))).toBe(true)
    expect(trades.byRarity.map((row) => row.rarity)).toEqual(['◊', '◊◊', '◊◊◊', '◊◊◊◊', '☆', '✵', '✵✵'])
  })

  it('asks for what a deck lacks with its tradeable prints; promo-only cards cannot be traded', () => {
    const stock = realCsvNormalized().units
    const promoOnly = index.catalog.groups.find(
      (group) =>
        index.cardsOfGroup(group.id).every((card) => card.rarity === 'P') &&
        group.stockCardIds.every((id) => (stock[id]?.amountOwned ?? 0) === 0),
    )?.id as string
    const decks: TradeDeck[] = [
      { name: 'Mazo 13', groups: new Map([['B4-103', 2]]) },
      {
        name: 'Mazo 50',
        groups: new Map([
          ['B4-103', 1],
          [promoOnly, 2],
        ]),
      },
    ]
    const trades = list(decks)
    expect(trades.wants).toEqual([
      {
        groupId: 'B4-103',
        nameEs: 'Hoopa ex',
        nameEn: 'Hoopa ex',
        missing: 1,
        decks: ['Mazo 13'],
        options: [
          { cardId: 'B4-103', rarity: '◊◊◊◊' },
          { cardId: 'B4b-149', rarity: '◊◊◊◊' },
          { cardId: 'B4-186', rarity: '☆☆' },
          { cardId: 'B4-199', rarity: '☆☆' },
        ],
      },
    ])
    expect(trades.untradeable.map((row) => row.groupId)).toEqual([promoOnly])
    expect(trades.byRarity.find((row) => row.rarity === '◊◊◊◊')?.wants).toHaveLength(1)
  })

  it('leaves out a card with an active adjustment', () => {
    const adjustment: CollectionAdjustment = {
      id: '1',
      functionalGroupId: 'B3b-64',
      playableCopies: 1,
      reason: 'test',
      active: true,
      createdAt: '2026-10-07T00:00:00.000Z',
      resolvedAt: null,
      resolution: null,
    }
    expect(list([]).gives.find((give) => give.groupId === 'B3b-64')).toBeDefined()
    expect(list([], [adjustment]).gives.find((give) => give.groupId === 'B3b-64')).toBeUndefined()
  })

  it('writes the list to paste in a chat, by the chosen rarities, the want at its own rarity', () => {
    const trades = list([{ name: 'Mazo 13', groups: new Map([['B4-103', 2]]) }])
    const text = tradeText(trades, { rarities: ['◊◊◊◊'], max: 3 })
    const lines = text.split('\n')
    expect(lines.slice(0, 4)).toEqual([
      'Intercambio en TCG Pocket (misma rareza)',
      '',
      'Busco:',
      '· ◊◊◊◊ Hoopa ex (B4-103, B4b-149)',
    ])
    expect(lines).toContain('Doy:')
    expect(lines.at(-1)).toMatch(/^· y \d+ más$/)
    expect(lines.filter((line) => line.startsWith('· ◊◊◊ '))).toEqual([])
    expect(tradeText(list([]), { rarities: ['☆☆'] })).toContain('Busco:\n· nada por ahora')
  })
})
