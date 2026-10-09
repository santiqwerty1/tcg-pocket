import { describe, expect, it } from 'vitest'
import type { Expansion, GroupDetail, PackInfo, RarityRuleInfo } from '@/api/schemas'
import { editionSources } from './WhereToGet'

function pack(id: string, extra: Partial<PackInfo> = {}): PackInfo {
  const [expansionId = '', name = ''] = id.split('/')
  return {
    id,
    expansionId,
    expansionNameEs: expansionId === 'B4b' ? 'Mega Ascenso' : 'Genes Formidables',
    name,
    nameEs: name,
    available: true,
    limited: false,
    limitedUntil: null,
    cardsPerPack: 5,
    cardCount: 100,
    containsShinies: false,
    containsBabies: false,
    inTrackerOverview: true,
    ...extra,
  }
}

const rules: RarityRuleInfo[] = [
  { rarity: '◊', points: 35, verified: true, tradeable: true },
  { rarity: '✵', points: 1000, verified: true, tradeable: true },
  { rarity: 'Crown Rare', points: 2500, verified: true, tradeable: false },
]
const expansions: Expansion[] = [
  { id: 'A1', nameEn: 'Genetic Apex', nameEs: 'Genes Formidables', tradeable: true },
  { id: 'B4b', nameEn: 'Mega Rising', nameEs: 'Mega Ascenso', tradeable: true },
  { id: 'P-A', nameEn: 'Promo-A', nameEs: 'Promo-A', isPromo: true, tradeable: false },
]

function group(cards: { id: string; expansionId: string; rarity: string; pack: string }[]): GroupDetail {
  return {
    editions: cards.map((card) => ({ card, owned: 0, collected: false, twinCardIds: [card.id] })),
  } as unknown as GroupDetail
}

describe('editionSources', () => {
  const packs = [
    pack('A1/mewtwopack', { available: false }),
    pack('A1/charizardpack', { available: false }),
    pack('A1/pikachupack', { available: false }),
    pack('B4b/deluxepack', { limited: true, limitedUntil: '2026-10-28' }),
  ]

  it('names the pack, its sale and its cost', () => {
    const [mewtwo, deluxe] = editionSources(
      group([
        { id: 'A1-1', expansionId: 'A1', rarity: '◊', pack: 'mewtwopack' },
        { id: 'B4b-240', expansionId: 'B4b', rarity: '✵', pack: 'everypack' },
      ]),
      packs,
      rules,
      expansions,
      '2026-10-09',
    )
    expect(mewtwo).toMatchObject({ onSale: false, points: 35, tradeable: true })
    expect(mewtwo?.packs.map((item) => item.id)).toEqual(['A1/mewtwopack'])
    expect(deluxe).toMatchObject({ onSale: true, limitedUntil: '2026-10-28', points: 1000, tradeable: true })
  })

  it('takes every pack of the set for «everypack»', () => {
    const [source] = editionSources(
      group([{ id: 'A1-200', expansionId: 'A1', rarity: '◊', pack: 'everypack' }]),
      packs,
      rules,
      expansions,
      '2026-10-09',
    )
    expect(source?.packs).toHaveLength(3)
  })

  it('stops selling a limited pack after its last day, like the recommender', () => {
    const [source] = editionSources(
      group([{ id: 'B4b-240', expansionId: 'B4b', rarity: '✵', pack: 'everypack' }]),
      packs,
      rules,
      expansions,
      '2026-10-29',
    )
    expect(source).toMatchObject({ onSale: false, limitedUntil: null })
  })

  it('gives a deadline only when every pack selling the card is limited, and then the last one', () => {
    const mixed = [pack('B5/uno', { limited: true, limitedUntil: '2026-11-01' }), pack('B5/dos')]
    const allLimited = [
      pack('B5/uno', { limited: true, limitedUntil: '2026-11-01' }),
      pack('B5/dos', { limited: true, limitedUntil: '2026-11-15' }),
    ]
    const card = group([{ id: 'B5-1', expansionId: 'B5', rarity: '◊', pack: 'everypack' }])
    const extra: Expansion[] = [...expansions, { id: 'B5', nameEn: 'B5', nameEs: 'B5', tradeable: true }]
    expect(editionSources(card, mixed, rules, extra, '2026-10-09')[0]?.limitedUntil).toBeNull()
    expect(editionSources(card, allLimited, rules, extra, '2026-10-09')[0]?.limitedUntil).toBe('2026-11-15')
  })

  it('does not turn a pack the catalog does not declare into «any pack»', () => {
    const [source] = editionSources(
      group([{ id: 'A1-300', expansionId: 'A1', rarity: '◊', pack: 'nuevopack' }]),
      packs,
      rules,
      expansions,
      '2026-10-09',
    )
    expect(source).toMatchObject({ packs: [], onSale: false, promo: false })
  })

  it('says a promo comes from no pack and is not traded', () => {
    const [promo] = editionSources(
      group([{ id: 'P-A-1', expansionId: 'P-A', rarity: 'P', pack: 'everypack' }]),
      packs,
      rules,
      expansions,
      '2026-10-09',
    )
    expect(promo).toMatchObject({ promo: true, packs: [], points: null, tradeable: false })
  })
})
