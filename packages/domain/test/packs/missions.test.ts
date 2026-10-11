import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type MissionProgress, missionProgress, parseMissions } from '../../src/catalog/index.js'
import { normalizeImportRows, parseTrackerCsv } from '../../src/collection/index.js'
import {
  DEFAULT_RARITY_RULES,
  type DeckGoal,
  missionWants,
  type RecommendInput,
  recommendPacks,
} from '../../src/packs/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
const owned = (stockCardId: string) => units[stockCardId]?.amountOwned ?? 0
const dir = join(import.meta.dirname, '..', 'fixtures', 'tracker', 'themed-collections')
const missions = readdirSync(dir)
  .filter((file) => file.endsWith('-missions.json'))
  .flatMap(
    (file) =>
      parseMissions(JSON.parse(readFileSync(join(dir, file), 'utf8')), (cardId) => index.cardById(cardId) !== undefined)
        .missions,
  )
// The CSV of 6/10/2026 against the missions at the pinned commit.
const wants = missionWants(missionProgress(missions, index, owned))

function input(overrides: Partial<RecommendInput> = {}): RecommendInput {
  return {
    index,
    decks: [],
    collection: null,
    alpha: 0.7,
    playable: () => 0,
    owned,
    available: (packId) => packId !== 'A4b/deluxepack',
    model: 'corrected',
    onlyAvailable: false,
    rarityRule: (rarity) => DEFAULT_RARITY_RULES[rarity],
    ...overrides,
  }
}

/** Deck 13 with a second Hoopa ex it does not have: one copy missing. */
function deck13(): DeckGoal {
  const cards = deckDraft(13)
    .cards.filter((entry) => entry.cardId !== 'A2-110')
    .map((entry) => (entry.cardId === 'B4-103' ? { cardId: 'B4-103', count: 2 } : entry))
  return { deckId: '13', name: 'Hoopa ex / Mega-Absol ex', priority: 3, cards }
}

describe('missions as the third goal of Sobres (Fase 44)', () => {
  it('only the slots still missing copies, with how many', () => {
    const progress: MissionProgress[] = [
      {
        mission: { expansionId: 'A1', name: 'Fuego', slots: [], reward: null, secret: false },
        slots: [
          { options: ['A1-33'], amount: 2, have: 1 },
          { options: ['A1-34', 'A1-35'], amount: 1, have: 1 },
        ],
        complete: false,
        missingCopies: 1,
      },
    ]
    expect(missionWants(progress)).toEqual([{ mission: 'Fuego', expansionId: 'A1', options: ['A1-33'], missing: 1 }])
    expect(wants.length).toBeGreaterThan(100)
    expect(wants.every((want) => want.missing > 0 && want.options.length > 0)).toBe(true)
  })

  it('alone, the missions rank the packs: the best on sale scores 1 and its row says what it gives', () => {
    const result = recommendPacks(input({ missions: wants }))
    expect(result.missions).toMatchObject({ slots: wants.length, weight: 1 })
    const [best] = result.rows
    expect(best?.available).toBe(true)
    expect(best?.expectedValue).toBeCloseTo(1, 10)
    expect(best?.missions?.expected).toBeGreaterThan(0)
    expect(best?.decks).toBeNull()
  })

  it('weighs as one more goal: ½ with the decks, ⅓ with decks and collection; off, nothing changes', () => {
    const decksOnly = recommendPacks(input({ decks: [deck13()] }))
    expect(decksOnly.missions).toBeNull()
    expect(recommendPacks(input({ decks: [deck13()], missions: [] })).rows).toEqual(
      decksOnly.rows.map((row) => ({ ...row, missions: null })),
    )
    const both = recommendPacks(input({ decks: [deck13()], missions: wants }))
    expect(both.missions?.weight).toBeCloseTo(1 / 2, 10)
    const three = recommendPacks(input({ decks: [deck13()], collection: { rarities: [], copies: 1 }, missions: wants }))
    expect(three.missions?.weight).toBeCloseTo(1 / 3, 10)
    // A pack's score is the weighted sum of its scaled goals: never more than 1 for the best on sale.
    for (const row of both.rows.filter((item) => item.available))
      expect(row.expectedValue).toBeLessThanOrEqual(1 + 1e-9)
  })
})
