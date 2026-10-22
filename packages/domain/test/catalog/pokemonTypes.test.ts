import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type BuildCatalogInput,
  buildCatalogWithReport,
  type Catalog,
  engineCardsFromDatabaseJson,
  isOfType,
  joinEngineData,
  parseEngineCards,
  parseTrackerCards,
  parseTrackerEnergy,
  rulesHashOf,
  rulesTextOf,
  typesOf,
  unknownTrackerFields,
} from '../../src/index.js'
import { buildInput, builtCatalog } from '../helpers/loadFixtures.js'

/** FIXTURE INVENTADO: C1 cards made up before the real data exists (see its `_inventado`). */
interface InventedC1 {
  expansion: Record<string, unknown>
  cards: Record<string, unknown>[]
  engine: unknown[]
}
const invented = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'invented', 'c1-dual-type.json'), 'utf8'),
) as InventedC1

/**
 * The 4,317 per-edition rules hashes of the fixture catalog (tracker 3ab58f1, engine fb792eb) and the 2,319 group
 * hashes, as `origin/main` computed them on 22/10/2026 before the list of types existed: sha256 of the `id:hash` lines
 * in catalog order. A type list must not change any of them (the groups and the remap key on the same text).
 */
const EDITION_RULES_DIGEST = 'bf5bdf88bac9fa79aa74f4050b6297ef6a9e0689612895a613dd58e2be661253'
const GROUP_RULES_DIGEST = 'a5c15a56c87dd725a8470d72a5504ebddeed0ec6204b434571077776f429e188'

function digests(catalog: Catalog, keep: (id: string) => boolean) {
  const sha = (lines: string[]) => createHash('sha256').update(lines.join('\n')).digest('hex')
  return {
    editions: sha(catalog.cards.filter((card) => keep(card.id)).map((card) => `${card.id}:${rulesHashOf(card)}`)),
    groups: sha(catalog.groups.filter((group) => keep(group.id)).map((group) => `${group.id}:${group.rulesHash}`)),
  }
}

/** The real fixtures plus the invented C1: its expansion first in CardsDB and in `expansionIds`, its cards last. */
function inputWithInventedC1(): BuildCatalogInput {
  const base = buildInput()
  const declaration = base.cardsDbSource.indexOf('export const expansions')
  const open = base.cardsDbSource.indexOf('= [', declaration) + '= ['.length
  const cardsDbSource = `${base.cardsDbSource.slice(0, open)}\n  ${JSON.stringify(invented.expansion)},${base.cardsDbSource.slice(open)}`
  const typesIndexSource = base.typesIndexSource.replace(
    'export const expansionIds = [',
    "export const expansionIds = [\n  'C1',",
  )
  return {
    ...base,
    cardsJson: [...(base.cardsJson as unknown[]), ...invented.cards],
    cardsDbSource,
    typesIndexSource,
    engineCards: [...(base.engineCards as unknown[]), ...engineCardsFromDatabaseJson(invented.engine)],
  }
}

describe('parseTrackerEnergy (C1: one or two printed types)', () => {
  it('reads one type, a list, or a string with a separator; trainers have no type', () => {
    expect(parseTrackerEnergy('grass')).toEqual({ energy: 'grass', types: ['grass'] })
    expect(parseTrackerEnergy(['psychic', 'fighting'])).toEqual({ energy: 'psychic', types: ['psychic', 'fighting'] })
    for (const text of [
      'water/darkness',
      'Water / Darkness',
      'water, darkness',
      'water & darkness',
      'water darkness',
    ]) {
      expect(parseTrackerEnergy(text), text).toEqual({ energy: 'water', types: ['water', 'darkness'] })
    }
    expect(parseTrackerEnergy(' Trainer ')).toEqual({ energy: 'trainer', types: [] })
  })

  it('refuses an unknown type, a repeated one, more than two, trainer mixed with a type, or nothing', () => {
    expect(() => parseTrackerEnergy('fairy')).toThrow(/Unknown energy type 'fairy'/)
    expect(() => parseTrackerEnergy('water/water')).toThrow(/Repeated/)
    expect(() => parseTrackerEnergy(['fire', 'water', 'grass'])).toThrow(/More than 2/)
    expect(() => parseTrackerEnergy('trainer/water')).toThrow(/Unknown energy type 'trainer'/)
    expect(() => parseTrackerEnergy('  ')).toThrow(/Empty/)
    expect(() => parseTrackerEnergy([])).toThrow(/Empty/)
  })

  it('typesOf and isOfType read the list, and a card stored before it by its one energy', () => {
    expect(typesOf({ energy: 'psychic', types: ['psychic', 'fighting'] })).toEqual(['psychic', 'fighting'])
    expect(typesOf({ energy: 'grass', types: [] })).toEqual(['grass'])
    expect(typesOf({ energy: 'grass' })).toEqual(['grass'])
    expect(typesOf({ energy: 'trainer', types: [] })).toEqual([])
    expect(isOfType({ energy: 'psychic', types: ['psychic', 'fighting'] }, 'fighting')).toBe(true)
    expect(isOfType({ energy: 'psychic', types: ['psychic', 'fighting'] }, 'darkness')).toBe(false)
    expect(isOfType({ energy: 'trainer', types: [] }, 'colorless')).toBe(false)
  })
})

describe('the tracker card schema and the engine data with two types (FIXTURE INVENTADO)', () => {
  it('parses the three invented shapes of a C1 card and keeps energy as the first type', () => {
    const [mewtwo, greninja, piplup] = parseTrackerCards(invented.cards)
    expect(mewtwo).toMatchObject({ card_id: 'C1-1', energy: 'psychic', types: ['psychic', 'fighting'] })
    expect(greninja).toMatchObject({ card_id: 'C1-2', energy: 'water', types: ['water', 'darkness'] })
    expect(piplup).toMatchObject({ card_id: 'C1-3', energy: 'water', types: ['water'] })
  })

  it('fails loudly on a type it does not know, naming it', () => {
    const bad = { ...invented.cards[0], energy: 'psychic/fairy' }
    expect(() => parseTrackerCards([bad])).toThrow(/Unknown energy type 'fairy'/)
  })

  it('reads the engine type as one, a second one apart, or a list; the join compares them as sets', () => {
    const engine = engineCardsFromDatabaseJson(invented.engine)
    expect(engine.map((card) => (card.kind === 'pokemon' ? [card.energyType, card.energyTypes] : null))).toEqual([
      ['Psychic', ['Psychic', 'Fighting']],
      ['Darkness', ['Darkness', 'Water']],
      ['Water', undefined],
    ])
    const join = joinEngineData(parseTrackerCards(invented.cards), engine)
    expect(join.conflicts).toEqual([])
    expect(join.byCardId.get('C1-2')?.engineId).toBe('C1 002')
    // One type missing on either side is a conflict, with both lists in it.
    const oneType = parseTrackerCards([{ ...invented.cards[1], energy: 'water' }])
    expect(joinEngineData(oneType, engine).conflicts).toEqual([
      { cardId: 'C1-2', field: 'energy', tracker: 'water', engine: 'darkness/water' },
    ])
    expect(() => parseEngineCards([{ ...engine[0], energyTypes: ['A', 'B', 'C'] }])).toThrow()
  })

  it('names the fields of cards.json it does not read, except foil, which it leaves out on purpose', () => {
    const rows = invented.cards.map((card, at) => (at === 0 ? { ...card, foil: false, energy2: 'fighting' } : card))
    expect(unknownTrackerFields(rows)).toEqual([
      "cards.json has a field the catalog does not read: 'energy2' (1 cards)",
    ])
    expect(unknownTrackerFields(buildInput().cardsJson)).toEqual([])
  })
})

describe('the catalog with two types', () => {
  it('the rules hashes of the 4,317 real cards and of their groups do not change', () => {
    expect(digests(builtCatalog().catalog, () => true)).toEqual({
      editions: EDITION_RULES_DIGEST,
      groups: GROUP_RULES_DIGEST,
    })
  })

  it('every real card has its one type in the list, and trainers none', () => {
    for (const card of builtCatalog().catalog.cards) {
      expect(card.types, card.id).toEqual(card.energy === 'trainer' ? [] : [card.energy])
    }
  })

  it('builds the invented C1 next to the real cards: two types, a rules text that says so, nothing else moves', () => {
    const { catalog, report } = buildCatalogWithReport(inputWithInventedC1())
    expect(catalog.cards).toHaveLength(4320)
    const byId = new Map(catalog.cards.map((card) => [card.id, card]))
    expect(byId.get('C1-1')).toMatchObject({ energy: 'psychic', types: ['psychic', 'fighting'], prizePoints: 3 })
    expect(byId.get('C1-2')).toMatchObject({ energy: 'water', types: ['water', 'darkness'], engineId: 'C1 002' })
    expect(byId.get('C1-3')).toMatchObject({ energy: 'water', types: ['water'] })
    expect(rulesTextOf(byId.get('C1-1') as never)).toContain('\ntypes:psychic,fighting\n')
    expect(rulesTextOf(byId.get('C1-3') as never)).not.toContain('types:')
    // The fixture already has one conflict (P-A-22): the C1 cards add none, and the real ones are the same.
    expect(report.engineConflicts.filter((conflict) => conflict.cardId.startsWith('C1-'))).toEqual([])
    expect(report.engineConflicts).toEqual(builtCatalog().report.engineConflicts)
    expect(report.groupsWithMixedRules).toEqual([])
    expect(catalog.expansions.find((expansion) => expansion.id === 'C1')?.trackerInternalId).toBe(23)
    expect(digests(catalog, (id) => !id.startsWith('C1-'))).toEqual({
      editions: EDITION_RULES_DIGEST,
      groups: GROUP_RULES_DIGEST,
    })
  })
})
