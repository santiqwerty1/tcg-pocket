import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCatalogWithReport,
  type Catalog,
  CatalogBuildError,
  CatalogInputError,
  engineCardsFromDatabaseJson,
  engineTypeFields,
  isOfType,
  joinEngineData,
  parseEngineCards,
  parseTrackerCards,
  parseTrackerEnergy,
  readCatalogInput,
  readEngineCards,
  rulesHashOf,
  rulesTextOf,
  typesOf,
  unknownTrackerFields,
  unknownTrackerFieldWarning,
} from '../../src/index.js'
import { inputWithInventedC1, invented } from '../helpers/inventedC1.js'
import { buildInput, builtCatalog } from '../helpers/loadFixtures.js'

/**
 * The 4,317 per-edition rules hashes of the fixture catalog (tracker 3ab58f1, engine fb792eb) and the 2,319 group
 * hashes, as `origin/main` computed them on 22/10/2026 before the list of types existed: sha256 of the `id:hash` lines
 * in catalog order. A type list must not change any of them: `functional_groups.rules_hash` stores the group's, and the
 * build checks with them that every edition of a group is the same card (`groupsWithMixedRules`).
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
      'water-darkness',
      'water | darkness',
      'water; darkness',
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
    // An empty piece is a malformed value, not one type less.
    for (const text of ['psychic,', ',psychic', 'psychic//fighting']) {
      expect(() => parseTrackerEnergy(text), text).toThrow(/Empty energy type/)
    }
    expect(() => parseTrackerEnergy(['psychic', 3])).toThrow('item that is not a string: ["psychic",3]')
    expect(() => parseTrackerEnergy(3)).toThrow(/neither a string nor a list: 3/)
    expect(() => parseTrackerEnergy(undefined)).toThrow(/neither a string nor a list/)
  })

  it('typesOf and isOfType read the list, and a card stored before it by its one energy', () => {
    expect(typesOf({ energy: 'psychic', types: ['psychic', 'fighting'] })).toEqual(['psychic', 'fighting'])
    expect(typesOf({ energy: 'grass', types: [] })).toEqual(['grass'])
    expect(typesOf({ energy: 'grass' })).toEqual(['grass'])
    expect(typesOf({ energy: 'trainer', types: [] })).toEqual([])
    expect(isOfType({ energy: 'psychic', types: ['psychic', 'fighting'] }, 'fighting')).toBe(true)
    expect(isOfType({ energy: 'psychic', types: ['psychic', 'fighting'] }, 'darkness')).toBe(false)
    expect(isOfType({ energy: 'trainer', types: [] }, 'colorless')).toBe(false)
    // A list that does not start with energy was left by an older version: energy wins.
    expect(typesOf({ energy: 'fire', types: ['grass'] })).toEqual(['fire'])
    expect(typesOf({ energy: 'trainer', types: ['grass'] })).toEqual([])
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
      { cardId: 'C1-2', field: 'energy', tracker: 'water', engine: 'Darkness/Water' },
    ])
    expect(() => parseEngineCards([{ ...engine[0], energyTypes: ['A', 'B', 'C'] }])).toThrow()
  })

  it('the fixture extraction reads the engine types with the same reducer as a real sync (Codex on #149)', () => {
    const script = readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'scripts', 'extract-fixtures.mjs'),
      'utf8',
    )
    expect(script).toContain('const { engineTypeFields, parseEngineCards } = await import(')
    expect(script).toContain('...engineTypeFields(v),')
    expect(script).not.toMatch(/function\s+typeFields/)
    // It validates the reduced cards as a sync does, before copying or writing any fixture (review of #149).
    const validated = script.indexOf('parseEngineCards(compact)')
    expect(validated).toBeGreaterThan(script.indexOf('const compact = db.map('))
    expect(validated).toBeLessThan(script.indexOf('copyFileSync(join(tracker, src)'))
    expect(validated).toBeLessThan(script.indexOf("writeFileSync(join(out, 'deckgym/engine-cards.json')"))
    // So a database.json a sync refuses (energy_type outside energy_types) stops the extraction too.
    expect(() => engineTypeFields({ id: 'C1 009', energy_type: 'Fire', energy_types: ['Grass'] })).toThrow(
      /C1 009: energy_type Fire is not in energy_types/,
    )
    expect(engineTypeFields({ energy_type: 'Fire', energy_types: ['Grass', 'Fire'] })).toEqual({
      energyType: 'Grass',
      energyTypes: ['Grass', 'Fire'],
    })
  })

  it('reads malformed engine types as absent when harmless and refuses them when not', () => {
    const pokemon = (fields: Record<string, unknown>) => [
      { Pokemon: { id: 'C1 009', name: 'X', stage: 0, evolves_from: null, hp: 60, rarity: '◊', ...fields } },
    ]
    const typesOfEngine = (fields: Record<string, unknown>) => {
      const [card] = engineCardsFromDatabaseJson(pokemon(fields))
      return card?.kind === 'pokemon' ? [card.energyType, card.energyTypes] : null
    }
    expect(typesOfEngine({ energy_type: 'Grass', energy_types: [] })).toEqual(['Grass', undefined])
    expect(typesOfEngine({ energy_type: 'Grass', secondary_energy_type: null })).toEqual(['Grass', undefined])
    expect(typesOfEngine({ energy_type: ['Grass', 'Fire'] })).toEqual(['Grass', ['Grass', 'Fire']])
    expect(() => typesOfEngine({ energy_type: 'Grass', secondary_energy_type: '' })).toThrow()
    expect(() => typesOfEngine({ energy_type: 'Grass', secondary_energy_type: 3 })).toThrow()
    // A second type equal to the first is not a dual type (review of #149), whatever its case.
    expect(() => typesOfEngine({ energy_types: ['Water', 'Water'] })).toThrow(/repeats a type/)
    expect(() => typesOfEngine({ energy_type: 'Water', secondary_energy_type: 'water' })).toThrow(/repeats a type/)
    expect(() => typesOfEngine({ energy_type: 'Fire', energy_types: ['Grass'] })).toThrow(
      /energy_type Fire is not in energy_types/,
    )
  })

  it('names the fields of cards.json it does not read, except foil, which it leaves out on purpose', () => {
    const rows = invented.cards.map((card, at) => (at === 0 ? { ...card, foil: false, energy2: 'fighting' } : card))
    expect(unknownTrackerFields(rows)).toEqual([{ field: 'energy2', cards: 1 }])
    expect(unknownTrackerFieldWarning({ field: 'energy2', cards: 1 })).toBe(
      "cards.json has a field the catalog does not read: 'energy2' (1 cards)",
    )
    expect(unknownTrackerFields(buildInput().cardsJson)).toEqual([])
  })
})

describe('the catalog with two types', () => {
  it('data it cannot read stops the build with a CatalogInputError that names the file, the card and the value', () => {
    const withCard = (change: (card: Record<string, unknown>) => Record<string, unknown>) => {
      const input = buildInput()
      input.cardsJson = (input.cardsJson as Record<string, unknown>[]).map((card) =>
        card.card_id === 'B3-51' ? change(card) : card,
      )
      return () => buildCatalogWithReport(input)
    }
    expect(withCard((card) => ({ ...card, energy: 'water/fairy' }))).toThrow(CatalogInputError)
    expect(withCard((card) => ({ ...card, energy: 'water/fairy' }))).toThrow(
      `cards.json: B3-51.energy: Unknown energy type 'fairy' in "water/fairy"`,
    )
    expect(withCard((card) => ({ ...card, weakness: 'fairy' }))).toThrow("cards.json B3-51: Unknown weakness: 'fairy'")
    const badEngine = buildInput()
    badEngine.engineCards = (badEngine.engineCards as Record<string, unknown>[]).map((card, at) =>
      at === 0 ? { ...card, hp: 'x' } : card,
    )
    expect(() => buildCatalogWithReport(badEngine)).toThrow(CatalogInputError)
    // A card id the engine bridge cannot map is refused by the schema, with the id (Codex on #151).
    expect(withCard((card) => ({ ...card, card_id: 'B3-x' }))).toThrow(
      'cards.json: B3-x.card_id: card_id must be «<expansion>-<number>», like A1-12',
    )
    // Whatever else stops the build comes from its data: a duplicate card is an input error too, still a build error.
    const duplicated = buildInput()
    const firstCard = (duplicated.cardsJson as Record<string, unknown>[])[0] as Record<string, unknown>
    duplicated.cardsJson = [...(duplicated.cardsJson as unknown[]), { ...firstCard }]
    expect(() => buildCatalogWithReport(duplicated)).toThrow(CatalogInputError)
    expect(() => buildCatalogWithReport(duplicated)).toThrow(CatalogBuildError)
    expect(() => buildCatalogWithReport(duplicated)).toThrow('catalog build: Duplicate card id A1-1')
    // The pins are the caller's, not data: still a plain CatalogBuildError.
    const noPin = () => buildCatalogWithReport({ ...buildInput(), trackerCommit: '' })
    expect(noPin).toThrow(CatalogBuildError)
    expect(noPin).not.toThrow(CatalogInputError)
    // The engine's rows are named by their id, and every issue says the value it found (review of #151).
    expect(() => buildCatalogWithReport(badEngine)).toThrow(/^deckgym database\.json: A1 001\.hp: .*\(got "x"\)$/)
    expect(withCard((card) => ({ ...card, energy: 'water/fairy' }))).toThrow('(got "water/fairy")')
    expect(() =>
      readEngineCards([
        { Pokemon: { id: 'C1 002', name: 'X', stage: 0, hp: 60, energy_types: ['Water', 'Water'], rarity: '◊' } },
      ]),
    ).toThrow('deckgym database.json: C1 002.energyTypes: energyTypes repeats a type (got ["Water","Water"])')
    // The reduction names the card (or the row) too, once (self-review).
    expect(() => readEngineCards({})).toThrow('deckgym database.json: it must be a list of cards')
    expect(() => readEngineCards([{ Energy: { id: 'C1 900' } }])).toThrow(
      'deckgym database.json: C1 900: unknown entry kind Energy',
    )
    expect(() => readEngineCards([null])).toThrow('deckgym database.json: row 0: not a card (got null)')
    // A long value is cut at 60 characters; one too deep to print does not hide its error.
    expect(withCard((card) => ({ ...card, energy: `water/${'x'.repeat(100)}` }))).toThrow(
      `(got "water/${'x'.repeat(50)}...)`,
    )
    let deep: unknown = 'bottom'
    for (let level = 0; level < 20_000; level++) deep = { deeper: deep }
    expect(withCard((card) => ({ ...card, attacks: deep }))).toThrow('cards.json: B3-51.attacks: ')
    expect(withCard((card) => ({ ...card, attacks: deep }))).toThrow('(got unprintable)')
    // A bug is not unreadable data: a TypeError passes through as it is (a 500 with its stack in the logs).
    expect(() =>
      readCatalogInput('cards.json', () => {
        throw new TypeError('x is not a function')
      }),
    ).toThrow(TypeError)
    const buggy = buildInput()
    Object.defineProperty(buggy, 'cardsDbSource', {
      get() {
        throw new TypeError('cannot read properties of undefined')
      },
    })
    expect(() => buildCatalogWithReport(buggy)).toThrow(TypeError)
    expect(() => buildCatalogWithReport(buggy)).not.toThrow(CatalogInputError)
    const ranged = buildInput()
    Object.defineProperty(ranged, 'typesIndexSource', {
      get() {
        throw new RangeError('invalid array length')
      },
    })
    expect(() => buildCatalogWithReport(ranged)).toThrow(RangeError)
    // The other files of the tracker, too (Codex on #151): types/index.ts, a translation table and a locale table.
    const broken = (change: (input: ReturnType<typeof buildInput>) => void) => {
      const input = buildInput()
      change(input)
      return () => buildCatalogWithReport(input)
    }
    expect(
      broken((input) => {
        input.typesIndexSource = 'export const other = [] as const\n'
      }),
    ).toThrow("types/index.ts: expansionIds: declaration 'export const expansionIds' not found")
    expect(
      broken((input) => {
        input.translations.pokemon = { bulbasaur: 3 }
      }),
    ).toThrow(/^pokemon_translations\.json: bulbasaur: /)
    expect(
      broken((input) => {
        input.esSets = { geneticapex: 7 }
      }),
    ).toThrow(/^es-ES sets\.json: geneticapex: /)
    for (const change of [
      (input: ReturnType<typeof buildInput>) => {
        input.translations.pokemon = { bulbasaur: 3 }
      },
      (input: ReturnType<typeof buildInput>) => {
        input.esSets = { geneticapex: 7 }
      },
    ]) {
      expect(broken(change)).toThrow(CatalogInputError)
    }
  })

  it('the sync report names a cards.json field it does not read (a second type written apart, say)', () => {
    const input = inputWithInventedC1()
    const cards = input.cardsJson as Record<string, unknown>[]
    input.cardsJson = cards.map((card) =>
      card.card_id === 'C1-3' ? { ...card, energy2: 'darkness', foil: false } : card,
    )
    const { report } = buildCatalogWithReport(input)
    expect(report.warnings).toContain("cards.json has a field the catalog does not read: 'energy2' (1 cards)")
    expect(report.unknownTrackerFields).toEqual([{ field: 'energy2', cards: 1 }])
    expect(report.warnings.join(' ')).not.toContain('foil')
  })

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
    expect(report.warnings.filter((warning) => warning.startsWith('cards.json has a field'))).toEqual([])
    expect(digests(catalog, (id) => !id.startsWith('C1-'))).toEqual({
      editions: EDITION_RULES_DIGEST,
      groups: GROUP_RULES_DIGEST,
    })
  })
})
