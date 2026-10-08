import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { missionProgress, parseMissions } from '../../src/catalog/index.js'
import { normalizeImportRows, parseTrackerCsv } from '../../src/collection/index.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const dir = join(import.meta.dirname, '..', 'fixtures', 'tracker', 'themed-collections')
const files = readdirSync(dir).filter((file) => file.endsWith('-missions.json'))

describe('missions (themed collections, Fase 8)', () => {
  const parsed = files.map((file) =>
    parseMissions(JSON.parse(readFileSync(join(dir, file), 'utf8')), (cardId) => index.cardById(cardId) !== undefined),
  )
  const missions = parsed.flatMap((result) => result.missions)

  it('the tracker files at the pinned commit parse; every option is a card of the catalog', () => {
    expect(files).toHaveLength(21)
    expect(missions.length).toBeGreaterThan(400)
    for (const mission of missions) {
      expect(mission.slots.length).toBeGreaterThan(0)
      for (const slot of mission.slots) {
        expect(slot.amount).toBeGreaterThanOrEqual(1)
        for (const option of slot.options) expect(index.cardById(option)).toBeDefined()
      }
    }
    const lakes = missions.find((mission) => mission.name === 'Suicune and Pokémon of the Lakes')
    expect(lakes).toMatchObject({ expansionId: 'A4a', reward: 'Shinedust ×1000', secret: false })
    expect(lakes?.slots[1]?.options).toEqual(['A4a-20', 'A4a-80', 'A4a-90', 'B2a-127'])
  })

  it('unknown cards are dropped with a warning; a slot left empty drops its mission; a bad file says so', () => {
    const raw = [
      { expansionId: 'A1', name: 'Ok', requiredCards: [{ options: ['A1-1', 'ZZ-1'], amount: 1 }] },
      { expansionId: 'A1', name: 'Broken', requiredCards: [{ options: ['ZZ-2'], amount: 1 }] },
    ]
    const result = parseMissions(raw, (cardId) => index.cardById(cardId) !== undefined)
    expect(result.missions.map((mission) => mission.name)).toEqual(['Ok'])
    expect(result.missions[0]?.slots[0]?.options).toEqual(['A1-1'])
    // Two unknown cards and the dropped mission.
    expect(result.warnings).toHaveLength(3)
    expect(parseMissions({ nope: true }, () => true).warnings[0]).toMatch(/invalid file/)
  })

  it('progress against the 6/10 collection: copies per stock unit, twins counted once', () => {
    const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
    const owned = (stockCardId: string) => units[stockCardId]?.amountOwned ?? 0
    const progress = missionProgress(missions, index, owned)
    expect(progress).toHaveLength(missions.length)
    const complete = progress.filter((item) => item.complete).length
    expect(complete).toBeGreaterThan(0)
    expect(complete).toBeLessThan(progress.length)
    for (const item of progress) {
      expect(item.missingCopies).toBe(item.slots.reduce((sum, slot) => sum + Math.max(0, slot.amount - slot.have), 0))
      expect(item.complete).toBe(item.missingCopies === 0)
    }
    // A1-1 and A4b-1 are the same stock unit: a slot listing both counts its copies once.
    const twin = missionProgress(
      [
        {
          expansionId: 'A1',
          name: 'Twins',
          slots: [{ options: ['A1-1', 'A4b-1'], amount: 99 }],
          reward: null,
          secret: false,
        },
      ],
      index,
      owned,
    )[0]
    expect(twin?.slots[0]?.have).toBe(owned(index.cardById('A1-1')?.stockCardId ?? ''))
  })
})
