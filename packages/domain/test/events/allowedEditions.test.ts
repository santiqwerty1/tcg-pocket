// Editions an event allows outside its edition rules («Partidas limitadas de Fusión Dual», 18/11/2026). The C1 cards
// are the invented fixture (FIXTURE INVENTADO, fixtures/invented/README.md); the Promo-A and older trainers are real.
import { describe, expect, it } from 'vitest'
import {
  allowedEditionsEs,
  type CardEdition,
  cardBreaksEvent,
  checkEventDeck,
  describeEventRulesEs,
  type EngineStatus,
  type EventRules,
  eventEdition,
  eventRulesSchema,
  fittingEdition,
  MAX_ALLOWED_EDITIONS,
  mutationPool,
  normalizeEventRules,
  preEvolutionFor,
} from '../../src/index.js'
import { inventedC1Index } from '../helpers/inventedC1.js'

const index = inventedC1Index()
const card = (id: string): CardEdition => {
  const found = index.cardById(id)
  if (!found) throw new Error(`no ${id}`)
  return found
}

const PROMO_C_VOL_1 = ['P-C-2', 'P-C-3', 'P-C-4', 'P-C-5', 'P-C-6', 'P-C-7', 'P-C-8', 'P-C-9']
const TRAINERS = ['P-A-1', 'P-A-2', 'P-A-3', 'P-A-4', 'P-A-5', 'P-A-6', 'P-A-7', 'P-A-8', 'A2b-111', 'A4b-373']
/** Event 2 as it will be stored (WikiDex «Partidas limitadas Fusión Dual», Serebii). */
const DUAL_FUSION: EventRules = { expansions: ['C1'], allow: [...PROMO_C_VOL_1, ...TRAINERS] }

describe('ediciones permitidas aparte: the rules', () => {
  it('the schema takes edition ids, up to MAX_ALLOWED_EDITIONS, and refuses anything else', () => {
    expect(eventRulesSchema.parse(DUAL_FUSION)).toEqual(DUAL_FUSION)
    expect(eventRulesSchema.parse({ expansions: ['C1'], allow: [] })).toEqual({ expansions: ['C1'], allow: [] })
    expect(() => eventRulesSchema.parse({ expansions: ['C1'], allow: ['P A 1'] })).toThrow()
    expect(() => eventRulesSchema.parse({ expansions: ['C1'], allow: ['<P-A-1>'] })).toThrow()
    expect(() => eventRulesSchema.parse({ expansions: ['C1'], allow: ['P-A-1'.repeat(5)] })).toThrow()
    const many = Array.from({ length: MAX_ALLOWED_EDITIONS }, (_, i) => `A1-${i + 1}`)
    expect(eventRulesSchema.parse({ expansions: ['C1'], allow: many }).allow).toHaveLength(MAX_ALLOWED_EDITIONS)
    expect(() => eventRulesSchema.parse({ expansions: ['C1'], allow: [...many, 'A1-999'] })).toThrow()
  })

  it('an allowed edition from another expansion complies; the C1 cards comply; the rest of the old sets do not', () => {
    for (const id of TRAINERS) expect(cardBreaksEvent(card(id), DUAL_FUSION)).toBeNull()
    expect(cardBreaksEvent(card('C1-3'), DUAL_FUSION)).toBeNull()
    expect(cardBreaksEvent(card('A1-1'), DUAL_FUSION)).toBe('es de A1')
    // Another Promo-A than the eight allowed: Pikachu P-A-9.
    expect(cardBreaksEvent(card('P-A-9'), DUAL_FUSION)).toBe('es de P-A')
    // Without `allow`, the same trainers break the expansion rule.
    expect(cardBreaksEvent(card('P-A-1'), { expansions: ['C1'] })).toBe('es de P-A')
    expect(cardBreaksEvent(card('A4b-373'), { expansions: ['C1'] })).toBe('es de A4b')
  })

  it('it also lifts a rarity rule, and only the editions it names', () => {
    const rules: EventRules = { rarities: ['◊'], allow: ['A4b-373'] }
    expect(cardBreaksEvent(card('A4b-373'), rules)).toBeNull()
    expect(cardBreaksEvent(card('P-A-7'), rules)).toBe('es P')
    expect(cardBreaksEvent(card('A1-1'), rules)).toBeNull()
  })

  it('a non-allowed edition of the same card fails, and the allowed one is the edition to suggest', () => {
    const rules: EventRules = { expansions: ['C1'], allow: ['P-A-5'] }
    expect(cardBreaksEvent(card('A2b-111'), rules)).toBe('es de A2b')
    expect(fittingEdition(card('A2b-111'), rules, index)?.id).toBe('P-A-5')
    const check = checkEventDeck([{ cardId: 'A2b-111', count: 2 }], rules, index)
    expect(check.problems).toEqual([
      { cardId: 'A2b-111', message: 'Poké Ball (A2b-111) es de A2b: sirve P-A-5 P', alternative: 'P-A-5' },
    ])
    // A tournament list counts any edition that fits.
    expect(checkEventDeck([{ cardId: 'A2b-111', count: 2 }], rules, index, { anyEdition: true }).ok).toBe(true)
    // The other way round: only the Crown Rare is allowed.
    const crown: EventRules = { expansions: ['C1'], allow: ['A2b-111'] }
    expect(fittingEdition(card('P-A-5'), crown, index)?.id).toBe('A2b-111')
  })

  it('the edition to suggest is the display one when it fits (P-A-5), not the first in catalog order (A2b-111)', () => {
    // Both editions of Poké Ball fit: the suggestion is the one the Laboratorio plays and most people have.
    const rules: EventRules = { rarities: ['P', 'Crown Rare'] }
    expect(index.cardsOfGroup('A2b-111').map((edition) => edition.id)).toEqual(['A2b-111', 'P-A-5'])
    expect(fittingEdition(card('A2b-111'), rules, index)?.id).toBe('P-A-5')
    // When the display edition does not fit, the first one that does.
    expect(fittingEdition(card('A1-1'), { expansions: ['A4b'] }, index)?.id).toBe('A4b-1')
  })

  it('types, «sin ex» and banned cards still apply to an allowed edition', () => {
    expect(cardBreaksEvent(card('A1-1'), { expansions: ['C1'], allow: ['A1-1'], types: ['fire'] })).toBe(
      'es de tipo Planta',
    )
    expect(cardBreaksEvent(card('A1-4'), { expansions: ['C1'], allow: ['A1-4'], noEx: true })).toBe('es un Pokémon ex')
    const banned: EventRules = { ...DUAL_FUSION, banned: ['A2b-111'] }
    expect(cardBreaksEvent(card('P-A-5'), banned)).toBe('está prohibida en el evento')
    expect(cardBreaksEvent(card('A2b-111'), banned)).toBe('está prohibida en el evento')
    // And no other edition is suggested for a card that breaks a card rule.
    expect(fittingEdition(card('P-A-5'), banned, index)).toBeNull()
  })

  it('without an edition rule, `allow` changes nothing', () => {
    const rules: EventRules = { types: ['water'], allow: ['A1-1'] }
    expect(cardBreaksEvent(card('A1-1'), rules)).toBe('es de tipo Planta')
    expect(cardBreaksEvent(card('P-A-1'), rules)).toBeNull()
    expect(describeEventRulesEs(rules, index)).toEqual(['Solo Pokémon de tipo Agua.'])
  })

  it('a deck of C1 cards and allowed trainers complies; one card of another set is named', () => {
    const deck = [
      { cardId: 'C1-1', count: 2 },
      { cardId: 'C1-3', count: 2 },
      { cardId: 'P-A-5', count: 1 },
      { cardId: 'A2b-111', count: 1 },
      { cardId: 'P-A-7', count: 1 },
      { cardId: 'A4b-373', count: 1 },
      { cardId: 'P-A-8', count: 2 },
    ]
    expect(checkEventDeck(deck, DUAL_FUSION, index)).toEqual({ ok: true, problems: [] })
    const withBulbasaur = checkEventDeck([...deck, { cardId: 'A1-1', count: 2 }], DUAL_FUSION, index)
    expect(withBulbasaur.problems).toEqual([
      // Bulbasaur A4b-1 is not allowed either: no edition to suggest.
      { cardId: 'A1-1', message: 'Bulbasaur (A1-1) es de A1', alternative: null },
    ])
  })
})

describe('ediciones permitidas aparte: in Spanish', () => {
  it('one line after the expansions, the editions of one name together, in the order typed', () => {
    expect(describeEventRulesEs({ expansions: ['C1'], allow: TRAINERS }, index)).toEqual([
      'Solo cartas de dualfusion.',
      'Además, estas ediciones: Poción (P-A-1), Velocidad X (P-A-2), Periscopio (P-A-3), Pokédex (P-A-4 y P-A-8), Poké Ball (P-A-5 y A2b-111), Tarjeta Roja (P-A-6), Investigación de Profesores (P-A-7 y A4b-373).',
    ])
    // A name typed again later joins its first place; repeats count once.
    expect(allowedEditionsEs(['A1-1', 'P-A-1', 'A4b-1', 'A1-1', 'A1-2'], index)).toBe(
      'Bulbasaur (A1-1 y A4b-1), Poción (P-A-1), Ivysaur (A1-2)',
    )
    expect(allowedEditionsEs(['A1-1', 'A4b-1', 'A1-1'], index)).toBe('Bulbasaur (A1-1 y A4b-1)')
  })

  it('one edition in the singular, also when it was typed twice; with a rarity rule too', () => {
    expect(describeEventRulesEs({ rarities: ['◊'], allow: ['A4b-373', 'A4b-373'] }, index)).toEqual([
      'Solo cartas ◊.',
      'Además, esta edición: Investigación de Profesores (A4b-373).',
    ])
    expect(describeEventRulesEs({ rarities: ['◊'], allow: ['A4b-373', 'P-A-7'] }, index)[1]).toBe(
      'Además, estas ediciones: Investigación de Profesores (A4b-373 y P-A-7).',
    )
  })

  it('an edition the catalog does not know goes by its id, at the end', () => {
    expect(allowedEditionsEs(['P-C-2', 'P-A-1', 'P-C-3'], index)).toBe('Poción (P-A-1), P-C-2, P-C-3')
  })
})

describe('ediciones permitidas aparte: as the API stores them', () => {
  it('known editions without repeats; an empty list is dropped; banned cards and expansions as before', () => {
    expect(normalizeEventRules({ expansions: ['C1'], allow: ['P-A-1', 'A2b-111', 'P-A-1'] }, index)).toEqual({
      ok: true,
      rules: { expansions: ['C1'], allow: ['P-A-1', 'A2b-111'] },
    })
    expect(normalizeEventRules({ expansions: ['C1'], allow: [] }, index)).toEqual({
      ok: true,
      rules: { expansions: ['C1'] },
    })
    expect(normalizeEventRules({ banned: ['A4b-1', 'A1-1'] }, index)).toEqual({ ok: true, rules: { banned: ['A1-1'] } })
    expect(normalizeEventRules({ banned: ['ZZ-999'] }, index)).toEqual({
      ok: false,
      message: 'Una carta prohibida no existe en el catálogo.',
    })
    expect(normalizeEventRules({ expansions: ['ZZ'] }, index)).toEqual({
      ok: false,
      message: 'Expansión desconocida: ZZ.',
    })
  })

  it('refuses editions the catalog does not know, and allowed editions without an edition rule', () => {
    // This fixture has no Promo-C.
    expect(normalizeEventRules(DUAL_FUSION, index)).toEqual({
      ok: false,
      message: `Ediciones desconocidas: ${PROMO_C_VOL_1.join(', ')}.`,
    })
    expect(normalizeEventRules({ expansions: ['C1'], allow: ['P-A-1', 'P-C-2'] }, index)).toEqual({
      ok: false,
      message: 'Edición desconocida: P-C-2.',
    })
    expect(normalizeEventRules({ noEx: true, allow: ['P-A-1'] }, index)).toEqual({
      ok: false,
      message: 'Las ediciones permitidas aparte solo valen con una regla de expansiones o de rarezas.',
    })
    expect(normalizeEventRules({ rarities: ['◊'], allow: ['P-A-1'] }, index).ok).toBe(true)
  })

  it('refuses an allowed edition of a banned card (by its card or by one of its editions)', () => {
    expect(normalizeEventRules({ expansions: ['C1'], allow: ['P-A-5', 'P-A-1'], banned: ['A2b-111'] }, index)).toEqual({
      ok: false,
      message: 'Una edición permitida es de una carta prohibida: Poké Ball (P-A-5).',
    })
    expect(normalizeEventRules({ expansions: ['C1'], allow: ['P-A-5', 'A2b-111'], banned: ['P-A-5'] }, index)).toEqual({
      ok: false,
      message: 'Estas ediciones permitidas son de una carta prohibida: Poké Ball (P-A-5 y A2b-111).',
    })
    expect(
      normalizeEventRules({ expansions: ['C1'], allow: ['P-A-5', 'P-A-1'], banned: ['P-A-1', 'A2b-111'] }, index),
    ).toEqual({
      ok: false,
      message: 'Estas ediciones permitidas son de cartas prohibidas: Poké Ball (P-A-5), Poción (P-A-1).',
    })
    // Another card banned: fine.
    expect(normalizeEventRules({ expansions: ['C1'], allow: ['P-A-5'], banned: ['P-A-1'] }, index)).toEqual({
      ok: true,
      rules: { expansions: ['C1'], allow: ['P-A-5'], banned: ['P-A-1'] },
    })
  })
})

describe('ediciones permitidas aparte: the Laboratorio', () => {
  const all: EngineStatus = () => true

  it('eventEdition: the display edition, or the one the event accepts, or none', () => {
    expect(eventEdition('A2b-111', index, all)?.id).toBe('P-A-5')
    expect(eventEdition('A2b-111', index, all, DUAL_FUSION)?.id).toBe('P-A-5')
    // Only the Crown Rare allowed: that one goes in.
    expect(eventEdition('A2b-111', index, all, { expansions: ['C1'], allow: ['A2b-111'] })?.id).toBe('A2b-111')
    // Bulbasaur: A1-1 is the display edition; a «solo A4b» plays A4b-1.
    expect(eventEdition('A1-1', index, all, { expansions: ['A4b'] })?.id).toBe('A4b-1')
    expect(eventEdition('A1-1', index, all, DUAL_FUSION)).toBeNull()
    // A card rule breaks every edition.
    expect(eventEdition('A2b-111', index, all, { ...DUAL_FUSION, banned: ['A2b-111'] })).toBeNull()
    expect(eventEdition('A1-1', index, all, { expansions: ['A4b'], types: ['fire'] })).toBeNull()
  })

  it('eventEdition: only an edition the engine plays goes in', () => {
    const noCrown: EngineStatus = (engineId) => engineId !== 'A2b 111'
    expect(eventEdition('A2b-111', index, noCrown, { expansions: ['C1'], allow: ['A2b-111'] })).toBeNull()
    expect(eventEdition('A2b-111', index, noCrown, DUAL_FUSION)?.id).toBe('P-A-5')
    // The display edition the engine does not play is played as another one, as before (no event).
    const noPromo: EngineStatus = (engineId) => engineId !== 'P-A 005'
    expect(eventEdition('A2b-111', index, noPromo)?.id).toBe('A2b-111')
    expect(eventEdition('A2b-111', index, noPromo, { expansions: ['C1'], allow: ['P-A-5'] })).toBeNull()
    expect(eventEdition('A2b-111', index, () => false)).toBeNull()
  })

  it('preEvolutionFor: under an event, the first functional card of the name with an edition it accepts', () => {
    // Exeggcute: A1-21 comes first by name, A1a-1 is another functional card.
    const named = index.catalog.groups.filter((group) => index.cardById(group.displayCardId)?.nameEn === 'Exeggcute')
    expect(named.map((group) => group.id).slice(0, 2)).toEqual(['A1-21', 'A1a-1'])
    expect(preEvolutionFor('Exeggcute', index, all, new Set())?.groupId).toBe('A1-21')
    const onlyA1a: EventRules = { expansions: ['A1a'] }
    expect(preEvolutionFor('Exeggcute', index, all, new Set(), onlyA1a)).toMatchObject({
      groupId: 'A1a-1',
      edition: { id: 'A1a-1' },
    })
    // Through `allow` too, with the allowed edition.
    expect(
      preEvolutionFor('Exeggcute', index, all, new Set(), { expansions: ['C1'], allow: ['A1a-1'] })?.edition.id,
    ).toBe('A1a-1')
    // Already in the pool, or none that fits: nothing.
    expect(preEvolutionFor('Exeggcute', index, all, new Set(['A1a-1']), onlyA1a)).toBeNull()
    expect(preEvolutionFor('Exeggcute', index, all, new Set(), DUAL_FUSION)).toBeNull()
    // Without an event, only the first one, as before: the engine not playing it leaves nothing.
    const first = new Set(index.cardsOfGroup('A1-21').map((edition) => edition.engineId))
    const notFirst: EngineStatus = (engineId) => !first.has(engineId)
    expect(preEvolutionFor('Exeggcute', index, notFirst, new Set())).toBeNull()
    expect(preEvolutionFor('Exeggcute', index, notFirst, new Set(), onlyA1a)?.groupId).toBe('A1a-1')
    // The engine plays another edition of it: that one.
    const noA1: EngineStatus = (engineId) => !engineId.startsWith('A1 ')
    const bulbasaur = preEvolutionFor('Bulbasaur', index, noA1, new Set())
    expect(bulbasaur?.groupId).toBe('A1-1')
    expect(bulbasaur?.edition.expansionId).not.toBe('A1')
  })

  it('the pool of a search under the event: the allowed trainers come in with their allowed edition', () => {
    const pool = mutationPool({
      index,
      energies: ['water'],
      edition: (groupId) => eventEdition(groupId, index, all, DUAL_FUSION),
      maxCopies: () => 2,
      allow: (edition) => cardBreaksEvent(edition, DUAL_FUSION) === null,
    })
    const byGroup = new Map(pool.map((item) => [item.groupId, item.cardId]))
    expect(byGroup.get('A2b-111')).toBe('P-A-5')
    expect(byGroup.get('A4b-373')).toBe('P-A-7')
    expect(byGroup.get('P-A-1')).toBe('P-A-1')
    expect(byGroup.get('C1-3')).toBe('C1-3')
    expect(byGroup.has('A1-1')).toBe(false)
    expect(pool.every((item) => cardBreaksEvent(card(item.cardId), DUAL_FUSION) === null)).toBe(true)
  })
})
