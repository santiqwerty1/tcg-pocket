import { describe, expect, it } from 'vitest'
import type { CardEdition, SelectableEnergy } from '../../src/index.js'
import {
  evolutionLine,
  fillRound,
  groupsOfCards,
  mutationPool,
  type PoolCard,
  poolForZone,
  seededRandom,
  usableWith,
  variantOf,
  zoneNoteEs,
} from '../../src/lab/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const card = (id: string) => {
  const found = index.cardById(id)
  if (!found) throw new Error(`no ${id}`)
  return found
}
const edition = (groupId: string) => index.cardById(index.groupById(groupId)?.displayCardId ?? groupId) ?? null
// Onix A1-150 (Land Crush: three Fighting) and Onix B1a-38 (Dig: three Colorless) are different functional cards;
// both evolve into Steelix (A4-122, B1a-51) and Mega-Steelix ex (B1a-52), all Metal.
const landCrushOnix = card('A1-150')
const digOnix = card('B1a-38')
const megaSteelix = card('B1a-52')
const metal: SelectableEnergy[] = ['metal']
const fire: SelectableEnergy[] = ['fire']

describe('evolution lines in the pool («probar estas cartas» with Onix)', () => {
  it('the line of a Basic reaches every card that evolves from it, each functional card once', () => {
    const line = evolutionLine(landCrushOnix, index).map((step) => step.functionalGroupId)
    expect(line[0]).toBe('A1-150')
    expect(line).toEqual(expect.arrayContaining(['A4-122', 'B1a-51', 'B1a-52']))
    expect(new Set(line).size).toBe(line.length)
    // A Stage 2's line from its Basic: Froakie → Frogadier → Greninja.
    expect(evolutionLine(card('B1-71'), index).map((step) => step.nameEn)).toContain('Greninja')
    expect(evolutionLine(megaSteelix, index)).toEqual([megaSteelix])
  })

  it('a Pokémon that evolves into one the zone pays is usable with the index, and not without it', () => {
    expect(usableWith(landCrushOnix, metal)).toBe(false)
    expect(usableWith(landCrushOnix, metal, index)).toBe(true)
    // Neither Onix nor its evolutions can attack with Fire alone.
    expect(usableWith(landCrushOnix, fire, index)).toBe(false)
    expect(usableWith(digOnix, fire)).toBe(true)
  })

  it('the pool of a Metal deck has the Fighting Onix nobody plays (Mega-Steelix ex is Metal); a Fire one does not', () => {
    const inPool = (energies: SelectableEnergy[]) =>
      mutationPool({ index, energies, edition, maxCopies: () => 2 }).some((item) => item.groupId === 'A1-150')
    expect(inPool(metal)).toBe(true)
    expect(inPool(fire)).toBe(false)
    // The zone's filter on a pool frozen for every zone gives the same answer.
    const all = mutationPool({ index, energies: ['fire', 'metal', 'fighting'], edition, maxCopies: () => 2 })
    expect(poolForZone(all, metal, index).some((item) => item.groupId === 'A1-150')).toBe(true)
    expect(poolForZone(all, fire, index).some((item) => item.groupId === 'A1-150')).toBe(false)
  })

  it('a card asked for, and the cards down its line, stay in the pool whatever the zone', () => {
    const all = mutationPool({ index, energies: ['fire', 'metal', 'fighting'], edition, maxCopies: () => 2 })
    const groups = (energies: SelectableEnergy[], asked?: Set<string>) =>
      new Set(poolForZone(all, energies, index, asked).map((item) => item.groupId))
    const plain = groups(fire)
    expect(plain.has('B1a-52')).toBe(false)
    expect(plain.has('A1-150')).toBe(false)
    const asked = groups(fire, new Set(['B1a-52']))
    expect(asked.has('B1a-52')).toBe(true)
    // Its Basic comes along (every Onix: they share the name), but not its siblings (Steelix).
    expect(asked.has('A1-150')).toBe(true)
    expect(asked.has('A4-122')).toBe(false)
    // Nothing else changes.
    expect([...asked].filter((group) => !plain.has(group)).sort()).toEqual(
      ['B1a-52', ...index.groupsByNameEn('Onix').map((group) => group.id)].filter((id) => !plain.has(id)).sort(),
    )
    // A Stage 2 asked for keeps its Stage 1 and its Basic (Greninja in a Fire deck).
    const water = mutationPool({ index, energies: ['water'], edition, maxCopies: () => 2 })
    const greninja = new Set(poolForZone(water, fire, index, new Set(['A1-89'])).map((item) => item.nameEn))
    expect(['Greninja', 'Frogadier', 'Froakie'].every((name) => greninja.has(name))).toBe(true)
  })

  it('the note says why a card asked for cannot attack, and what it evolves into that can', () => {
    expect(zoneNoteEs(landCrushOnix, metal, index)).toBe(
      'no puede atacar con las energías de la lista, pero evoluciona en Steelix y Mega-Steelix ex',
    )
    expect(zoneNoteEs(megaSteelix, fire, index)).toBe('no puede atacar con las energías de la lista')
    expect(zoneNoteEs(digOnix, metal, index)).toBeNull()
    // Trainers and Pokémon with an ability never get one.
    const trainer = index.catalog.groups
      .map((group) => index.cardById(group.displayCardId))
      .find((found): found is CardEdition => found?.cardType === 'trainer')
    if (!trainer) throw new Error('no trainer')
    expect(zoneNoteEs(trainer, fire, index)).toBeNull()
    expect(zoneNoteEs(card('A1-89'), fire, index)).toBeNull()
  })

  it('self-review: a card that fits only through its line is a pre-evolution (weight 0), never drawn on its own', () => {
    const weightOf = (pool: readonly PoolCard[], groupId: string) =>
      pool.find((item) => item.groupId === groupId)?.weight
    const metalPool = mutationPool({ index, energies: metal, edition, maxCopies: () => 2 })
    expect(weightOf(metalPool, 'A1-150')).toBe(0)
    // Mega-Steelix ex is drawn as before.
    expect(weightOf(metalPool, 'B1a-52')).toBeGreaterThan(0)
    const all = mutationPool({ index, energies: ['fire', 'metal', 'fighting'], edition, maxCopies: () => 2 })
    expect(weightOf(poolForZone(all, metal, index), 'A1-150')).toBe(0)
    // Asked for by hand it keeps its weight (the most played card's at the start of a search).
    expect(weightOf(poolForZone(all, metal, index, new Set(['A1-150'])), 'A1-150')).toBeGreaterThan(0)
    // The pre-evolution of a card asked for is kept as a pre-evolution only.
    expect(weightOf(poolForZone(all, fire, index, new Set(['B1a-52'])), 'A1-150')).toBe(0)

    // In hundreds of variants of a Metal and a Fire deck, a card with weight 0 only ever comes in with what it
    // evolves into (the property the self-review broke: «+Magneton +Magnemite» in a Grass deck).
    for (const [number, zone] of [
      [20, metal],
      [2, fire],
    ] as const) {
      const deck = deckDraft(number)
      const pool = poolForZone(all, zone, index)
      const zero = new Set(pool.filter((item) => item.weight === 0).map((item) => item.groupId))
      expect(zero.size).toBeGreaterThan(0)
      const random = seededRandom(number)
      let variants = 0
      for (let k = 0; k < 400; k++) {
        const variant = variantOf(deck.cards, zone, pool, index, random)
        if (!variant) continue
        variants += 1
        const added = variant.add.map((change) => index.cardById(change.cardId))
        for (const card of added) {
          if (!card || !zero.has(card.functionalGroupId)) continue
          expect(added.some((other) => other?.evolvesFrom === card.nameEn)).toBe(true)
        }
      }
      expect(variants).toBeGreaterThan(300)
    }
  })

  it('self-review: the fill round never fills a place with a pre-evolution alone', () => {
    const deck = deckDraft(20)
    const counts = groupsOfCards(deck.cards, index)
    const weakest = [...counts.entries()].filter(([, count]) => count === 1).map(([groupId]) => groupId)
    const full = poolForZone(mutationPool({ index, energies: metal, edition, maxCopies: () => 2 }), metal, index)
    // Two cards drawn on their own and many that only come along: the favourites never reach the second kind.
    const pool = [
      ...full.filter((item) => item.weight > 0 && index.cardById(item.cardId)?.cardType === 'trainer').slice(0, 2),
      ...full.filter((item) => item.weight === 0),
    ]
    const round = fillRound(deck.cards, weakest, pool, index, { maxCopies: () => 2, valid: () => true })
    if (!round) throw new Error('no fill round')
    const zero = new Set(pool.filter((item) => item.weight === 0).map((item) => item.cardId))
    expect(zero.size).toBeGreaterThan(3)
    expect(round.candidates).toHaveLength(2)
    for (const cardId of round.candidates) expect(zero.has(cardId)).toBe(false)
  })

  it('self-review: «pero evoluciona en» names what attacks, else what has an ability, and says so', () => {
    // Charmander (Fire attacks) in a Grass deck: no card of its line attacks with Grass; Charmeleon has an ability.
    const charmander = index.groupsByNameEn('Charmander').map((group) => card(group.displayCardId))
    const note = charmander.map((step) => zoneNoteEs(step, ['grass'], index)).find((text) => text !== null)
    expect(note).toMatch(
      /^no puede atacar con las energías de la lista, pero evoluciona en .+, que tienen? (una habilidad|habilidades)$/,
    )
    expect(note).toContain('Charmeleon')
  })
})
