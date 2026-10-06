import { describe, expect, it } from 'vitest'
import {
  engineCardsFromDatabaseJson,
  engineIdToTrackerId,
  joinEngineData,
  normalizeEngineRarity,
  parseEngineCards,
  parseTrackerCards,
  trackerIdToEngineId,
} from '../../src/index.js'
import { builtCatalog, loadFixtures } from '../helpers/loadFixtures.js'

describe('engine ids', () => {
  it('converts tracker ids to engine ids and back', () => {
    expect(trackerIdToEngineId('A1a-1')).toBe('A1a 001')
    expect(trackerIdToEngineId('A1-128')).toBe('A1 128')
    expect(trackerIdToEngineId('P-A-7')).toBe('P-A 007')
    expect(trackerIdToEngineId('B4b-429')).toBe('B4b 429')
    expect(engineIdToTrackerId('A1a 001')).toBe('A1a-1')
    expect(engineIdToTrackerId('P-A 007')).toBe('P-A-7')
    expect(engineIdToTrackerId('B4b 429')).toBe('B4b-429')
    expect(() => trackerIdToEngineId('A1')).toThrow()
    expect(() => trackerIdToEngineId('A1-x')).toThrow()
    expect(() => engineIdToTrackerId('A1-001')).toThrow()
  })

  it('round-trips every card of the catalog', () => {
    const { catalog } = builtCatalog()
    for (const card of catalog.cards) {
      expect(card.engineId).toBe(trackerIdToEngineId(card.id))
      expect(engineIdToTrackerId(card.engineId)).toBe(card.id)
    }
  })
})

describe('normalizeEngineRarity', () => {
  it('maps deckgym symbols to tracker rarities and promo sets to P', () => {
    expect(normalizeEngineRarity('*', 'A1')).toBe('✵')
    expect(normalizeEngineRarity('**', 'A2b')).toBe('✵✵')
    expect(normalizeEngineRarity('♛', 'A1')).toBe('Crown Rare')
    expect(normalizeEngineRarity('◊◊◊◊', 'B4b')).toBe('◊◊◊◊')
    expect(normalizeEngineRarity('☆☆', 'A1')).toBe('☆☆')
    expect(normalizeEngineRarity('◊', 'P-A')).toBe('P')
    expect(normalizeEngineRarity('☆', 'P-B')).toBe('P')
    expect(() => normalizeEngineRarity('???', 'A1')).toThrow()
  })
})

describe('joinEngineData', () => {
  it('joins the 4,317 cards with exactly one conflict: P-A-22 hp 60 (tracker) vs 50 (engine)', () => {
    const f = loadFixtures()
    const join = joinEngineData(parseTrackerCards(f.cardsJson), parseEngineCards(f.engineCards))
    expect(join.byCardId.size).toBe(4317)
    expect(join.missingInEngine).toEqual([])
    expect(join.unmatchedEngineIds).toEqual([])
    expect(join.conflicts).toEqual([{ cardId: 'P-A-22', field: 'hp', tracker: 60, engine: 50 }])
    expect(join.byCardId.get('A1-2')).toEqual({ engineId: 'A1 002', evolvesFrom: 'Bulbasaur', isFossil: false })
    expect(join.byCardId.get('A1-218')).toEqual({ engineId: 'A1 218', evolvesFrom: null, isFossil: true })
    expect(join.byCardId.get('B1-225')).toEqual({ engineId: 'B1 225', evolvesFrom: null, isFossil: false })
  })

  it('the tracker wins: the catalog keeps hp 60 for P-A-22 and reports the conflict', () => {
    const { catalog, report } = builtCatalog()
    expect(catalog.cards.find((c) => c.id === 'P-A-22')?.hp).toBe(60)
    expect(report.engineConflicts).toEqual([{ cardId: 'P-A-22', field: 'hp', tracker: 60, engine: 50 }])
    expect(report.engineMissing).toEqual([])
    expect(report.unmatchedEngineIds).toEqual([])
  })

  it('reports missing cards and conflicts on every compared field', () => {
    const cards = parseTrackerCards(loadFixtures().cardsJson).slice(0, 3)
    const engine = [
      {
        id: 'A1 001',
        kind: 'pokemon',
        name: 'Bulbasaur',
        stage: 1,
        evolvesFrom: 'Nothing',
        hp: 70,
        energyType: 'Fire',
        rarity: '☆',
      },
      { id: 'A1 002', kind: 'trainer', name: 'Ivysaurus', trainerType: 'Item', rarity: '◊◊' },
      { id: 'Z9 001', kind: 'trainer', name: 'Ghost', trainerType: 'Item', rarity: '◊' },
    ]
    const join = joinEngineData(cards, parseEngineCards(engine))
    expect(join.missingInEngine).toEqual(['A1-3'])
    expect(join.unmatchedEngineIds).toEqual(['Z9 001'])
    // A1-2 is ◊◊ in both sources, so no rarity conflict there.
    expect(join.conflicts.map((c) => `${c.cardId}:${c.field}`).sort()).toEqual(
      ['A1-1:energy', 'A1-1:evolutionType', 'A1-1:rarity', 'A1-2:cardType', 'A1-2:name'].sort(),
    )
    expect(join.byCardId.get('A1-3')).toEqual({ engineId: 'A1 003', evolvesFrom: null, isFossil: false })
  })
})

describe('engineCardsFromDatabaseJson', () => {
  it('reduces raw deckgym entries to the fixture shape', () => {
    const raw = [
      {
        Pokemon: {
          id: 'A1 001',
          name: 'Bulbasaur',
          stage: 0,
          evolves_from: null,
          hp: 70,
          energy_type: 'Grass',
          rarity: '◊',
          extra: 1,
        },
      },
      { Trainer: { id: 'A1 218', name: 'Old Amber', trainer_card_type: 'Fossil', rarity: '◊', effect: 'x' } },
    ]
    expect(engineCardsFromDatabaseJson(raw)).toEqual([
      {
        id: 'A1 001',
        kind: 'pokemon',
        name: 'Bulbasaur',
        stage: 0,
        evolvesFrom: null,
        hp: 70,
        energyType: 'Grass',
        rarity: '◊',
      },
      { id: 'A1 218', kind: 'trainer', name: 'Old Amber', trainerType: 'Fossil', rarity: '◊' },
    ])
    expect(() => engineCardsFromDatabaseJson([{ Energy: {} }])).toThrow()
    expect(() => engineCardsFromDatabaseJson({})).toThrow()
  })
})
