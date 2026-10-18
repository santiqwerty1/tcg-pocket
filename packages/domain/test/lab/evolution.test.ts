import { describe, expect, it } from 'vitest'
import { type CardEdition, SELECTABLE_ENERGIES, type SelectableEnergy } from '../../src/index.js'
import {
  comboVariant,
  evolutionLine,
  fillRound,
  groupsOfCards,
  labCardNameEs,
  mutationPool,
  type PoolCard,
  poolForZone,
  revertVariant,
  seededRandom,
  sharedNames,
  strandsPreEvolution,
  usableWith,
  variantOf,
  zoneNoteEs,
} from '../../src/lab/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const group = (cardId: string) => index.cardById(cardId)?.functionalGroupId ?? cardId
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

  it('self-review: a swap brings the pre-evolution drawn on its own first, not one that only comes along', () => {
    // Mega-Steelix ex into a deck without Onix: Onix B1a-38 (three Colorless, drawn) rather than A1-150 (weight 0),
    // whatever their order in the pool.
    const deck = deckDraft(2)
    const pool: PoolCard[] = [
      { cardId: 'B1a-52', groupId: 'B1a-52', nameEn: 'Mega Steelix ex', maxCopies: 2, weight: 10 },
      { cardId: 'A1-150', groupId: 'A1-150', nameEn: 'Onix', maxCopies: 2, weight: 0 },
      { cardId: 'B1a-38', groupId: 'B1a-38', nameEn: 'Onix', maxCopies: 2, weight: 1 },
    ]
    const random = seededRandom(5)
    let checked = 0
    for (let k = 0; k < 50; k++) {
      const variant = variantOf(deck.cards, metal, pool, index, random)
      const onix = variant?.add.find((change) => index.cardById(change.cardId)?.nameEn === 'Onix')
      if (!variant?.add.some((change) => change.cardId === 'B1a-52') || !onix) continue
      expect(onix.cardId).toBe('B1a-38')
      checked += 1
    }
    expect(checked).toBeGreaterThan(5)
    // With only the one that comes along, it is that one.
    const only = variantOf(deck.cards, metal, pool.slice(0, 2), index, seededRandom(5))
    expect(only?.add.map((change) => change.cardId).sort()).toEqual(['A1-150', 'B1a-52'])
  })

  describe('review of #107', () => {
    // Deck 2 (Fire) with Sinistea and Polteageist in place of two trainers: Sinistea only comes along in Fire.
    const base = deckDraft(2)
    const trainers = base.cards.filter((entry) => index.cardById(entry.cardId)?.cardType === 'trainer')
    const [t1, t2] = trainers
    if (!t1 || !t2) throw new Error('deck shape')
    const withLine = [
      ...base.cards.filter((entry) => entry !== t1 && entry !== t2),
      ...(t1.count > 1 ? [{ cardId: t1.cardId, count: t1.count - 1 }] : []),
      ...(t2.count > 1 ? [{ cardId: t2.cardId, count: t2.count - 1 }] : []),
      { cardId: 'B2-74', count: 1 },
      { cardId: 'B2-75', count: 1 },
    ]
    const pool = poolForZone(mutationPool({ index, energies: fire, edition, maxCopies: () => 2 }), fire, index)

    it('Sinistea is a pre-evolution in Fire; a variant never takes Polteageist out and leaves Sinistea alone', () => {
      expect(pool.find((item) => item.groupId === 'B2-74')?.weight).toBe(0)
      const alone = withLine.filter((entry) => entry.cardId !== 'B2-75')
      expect(strandsPreEvolution(withLine, alone, pool, index)).toBe(true)
      // A list that already had it alone is left as it was; one without Sinistea is never stranded.
      expect(strandsPreEvolution(alone, alone, pool, index)).toBe(false)
      expect(strandsPreEvolution(base.cards, base.cards, pool, index)).toBe(false)
      const random = seededRandom(107)
      let kept = 0
      for (let k = 0; k < 600; k++) {
        const variant = variantOf(withLine, fire, pool, index, random)
        if (!variant) continue
        const names = new Set(variant.cards.map((entry) => index.cardById(entry.cardId)?.nameEn))
        expect(names.has('Sinistea') && !names.has('Polteageist')).toBe(false)
        kept += 1
      }
      expect(kept).toBeGreaterThan(400)
    })

    it('the fill round never leaves it alone either', () => {
      const round = fillRound(withLine, ['B2-75', group(t1.cardId === 'B2-75' ? t2.cardId : t1.cardId)], pool, index, {
        maxCopies: () => 2,
        valid: () => true,
      })
      expect(round?.out).toContain('B2-75')
      expect(round?.variants.length).toBeGreaterThan(3)
      for (const variant of round?.variants ?? []) {
        const names = new Set(variant.cards.map((entry) => index.cardById(entry.cardId)?.nameEn))
        expect(names.has('Sinistea') && !names.has('Polteageist')).toBe(false)
      }
    })

    it('review of #113: neither a combo of two swaps nor undoing one leaves it alone', () => {
      // Two Polteageist: «−Polteageist» passes alone (one stays); the combo takes both out.
      const two = withLine.map((entry) => (entry.cardId === 'B2-75' ? { ...entry, count: 2 } : entry))
      const swaps = [
        { add: [t1.cardId], remove: [group('B2-75')], difference: 5 },
        { add: [t2.cardId], remove: [group('B2-75')], difference: 4 },
      ]
      expect(comboVariant(two, swaps, index, { pool: [], valid: () => true })).not.toBeNull()
      expect(comboVariant(two, swaps, index, { pool, valid: () => true })).toBeNull()
      // Polteageist came in with a swap, Sinistea with another: undoing the first one leaves Sinistea alone.
      const accepted = [
        { add: ['B2-75'], remove: [group(t1.cardId)], difference: 3 },
        { add: ['B2-74'], remove: [group(t2.cardId)], difference: 2 },
      ]
      const editionOf = (groupId: string) => index.groupById(groupId)?.displayCardId ?? groupId
      expect(revertVariant(withLine, accepted, 0, index, editionOf, { pool: [], valid: () => true })?.undoes).toBe(0)
      // With the pool it skips to the next one: undoing «+Sinistea» leaves no one alone.
      expect(revertVariant(withLine, accepted, 0, index, editionOf, { pool, valid: () => true })?.undoes).toBe(1)
    })

    it('review of #121: with the zone in play, only an evolution that does something strands its pre-evolution', () => {
      // Nosepass only comes along with Metal, where Probopass attacks; with Grass, Probopass does nothing.
      const full = mutationPool({ index, energies: [...SELECTABLE_ENERGIES], edition, maxCopies: () => 2 })
      const zoneOf = (energies: SelectableEnergy[]) => poolForZone(full, energies, index)
      expect(zoneOf(['metal']).find((card) => card.groupId === 'A2-86')?.weight).toBe(0)
      const line = [
        ...base.cards.filter((entry) => entry !== t1 && entry !== t2),
        { cardId: 'A2-86', count: 1 },
        { cardId: 'A2-118', count: 2 },
      ]
      const swaps = [
        { add: [t1.cardId], remove: [group('A2-118')], difference: 5 },
        { add: [t2.cardId], remove: [group('A2-118')], difference: 4 },
      ]
      const combo = (energies: SelectableEnergy[]) =>
        comboVariant(line, swaps, index, { pool: zoneOf(energies), energies, valid: () => true })
      // With Metal, taking both Probopass out leaves Nosepass alone: refused.
      expect(combo(['metal'])).toBeNull()
      // After a change to Grass, Probopass cannot attack: taking it out frees the line (the coordinator's review).
      expect(combo(['grass'])).not.toBeNull()
      // The same for undoing «+Probopass» while Nosepass came in apart.
      const accepted = [
        { add: ['A2-118'], remove: [group(t1.cardId)], difference: 3 },
        { add: ['A2-86'], remove: [group(t2.cardId)], difference: 2 },
      ]
      const single = line.map((entry) => (entry.cardId === 'A2-118' ? { ...entry, count: 1 } : entry))
      const editionOf = (groupId: string) => index.groupById(groupId)?.displayCardId ?? groupId
      const revert = (energies: SelectableEnergy[]) =>
        revertVariant(single, accepted, 0, index, editionOf, { pool: zoneOf(energies), energies, valid: () => true })
          ?.undoes
      expect(revert(['metal'])).toBe(1)
      expect(revert(['grass'])).toBe(0)
      // A dead line (Bulbasaur and Ivysaur with Water: neither attacks): Ivysaur can go, even with Bulbasaur left.
      const dead = [
        ...base.cards.filter((entry) => entry !== t1 && entry !== t2),
        { cardId: 'A1-1', count: 1 },
        { cardId: 'A1-2', count: 2 },
      ]
      const deadSwaps = [
        { add: [t1.cardId], remove: [group('A1-2')], difference: 5 },
        { add: [t2.cardId], remove: [group('A1-2')], difference: 4 },
      ]
      expect(zoneOf(['water']).some((card) => card.groupId === group('A1-1') || card.groupId === group('A1-2'))).toBe(
        false,
      )
      expect(
        comboVariant(dead, deadSwaps, index, { pool: zoneOf(['water']), energies: ['water'], valid: () => true }),
      ).not.toBeNull()
    })

    it('review of #121: a pre-evolution the pool does not have (none in the collection) is still protected', () => {
      // No Sinistea in the collection: the zone's pool does not know it, but Polteageist (an ability) does something
      // and Sinistea (Psychic) cannot attack with Fire.
      const noSinistea = poolForZone(
        mutationPool({ index, energies: fire, edition, maxCopies: (groupId) => (groupId === 'B2-74' ? 0 : 2) }),
        fire,
        index,
      )
      expect(noSinistea.some((card) => card.groupId === 'B2-74')).toBe(false)
      expect(noSinistea.some((card) => card.groupId === 'B2-75')).toBe(true)
      const two = withLine.map((entry) => (entry.cardId === 'B2-75' ? { ...entry, count: 2 } : entry))
      const swaps = [
        { add: [t1.cardId], remove: [group('B2-75')], difference: 5 },
        { add: [t2.cardId], remove: [group('B2-75')], difference: 4 },
      ]
      expect(comboVariant(two, swaps, index, { pool: noSinistea, valid: () => true })).not.toBeNull()
      expect(comboVariant(two, swaps, index, { pool: noSinistea, energies: fire, valid: () => true })).toBeNull()
      // variantOf and fillRound pass their zone on (review of #121: changing that left every test green).
      const strands = (cards: readonly { cardId: string }[]) => {
        const names = new Set(cards.map((entry) => index.cardById(entry.cardId)?.nameEn))
        return names.has('Sinistea') && !names.has('Polteageist')
      }
      const random = seededRandom(121)
      let drawn = 0
      for (let k = 0; k < 600; k++) {
        const variant = variantOf(withLine, fire, noSinistea, index, random)
        if (!variant) continue
        expect(strands(variant.cards)).toBe(false)
        drawn += 1
      }
      expect(drawn).toBeGreaterThan(300)
      const round = fillRound(withLine, ['B2-75'], noSinistea, index, {
        maxCopies: () => 2,
        valid: () => true,
        energies: fire,
      })
      expect(round?.out).toEqual(['B2-75'])
      expect(round?.variants ?? []).toEqual([])
      const unchecked = fillRound(withLine, ['B2-75'], noSinistea, index, { maxCopies: () => 2, valid: () => true })
      expect(unchecked?.variants.length).toBeGreaterThan(0)
    })

    it('review of #121 (verification): a Stage 1 that does nothing still counts when the Stage 2 of the list works', () => {
      const full = mutationPool({ index, energies: [...SELECTABLE_ENERGIES], edition, maxCopies: () => 2 })
      const rest = base.cards.filter((entry) => entry !== t1 && entry !== t2)
      // Gastly → Haunter → Gengar ex (an ability) with Fire: taking Haunter and Gengar ex out leaves Gastly alone.
      const firePool = poolForZone(full, fire, index)
      const gastly = firePool.find((card) => card.groupId === group('A1-120'))
      expect(gastly === undefined || gastly.weight === 0).toBe(true)
      const ghosts = [
        ...rest,
        { cardId: 'A1-120', count: 1 },
        { cardId: 'A1-121', count: 1 },
        { cardId: 'A1-123', count: 1 },
      ]
      const swaps = [
        { add: [t1.cardId], remove: [group('A1-121')], difference: 5 },
        { add: [t2.cardId], remove: [group('A1-123')], difference: 4 },
      ]
      expect(comboVariant(ghosts, swaps, index, { pool: firePool, energies: fire, valid: () => true })).toBeNull()
      // Undoing the change that brought Haunter and Gengar ex together, the same.
      const editionOf = (groupId: string) => index.groupById(groupId)?.displayCardId ?? groupId
      const together = [{ add: ['A1-121', 'A1-123'], remove: [group(t1.cardId), group(t2.cardId)], difference: 3 }]
      expect(
        revertVariant(ghosts, together, 0, index, editionOf, { pool: firePool, energies: fire, valid: () => true }),
      ).toBeNull()
      // revertVariant takes the zone too: Sinistea without copies (no pool), Polteageist came in apart.
      const noSinistea = poolForZone(
        mutationPool({ index, energies: fire, edition, maxCopies: (groupId) => (groupId === 'B2-74' ? 0 : 2) }),
        fire,
        index,
      )
      const accepted = [
        { add: ['B2-75'], remove: [group(t1.cardId)], difference: 3 },
        { add: ['B2-74'], remove: [group(t2.cardId)], difference: 2 },
      ]
      expect(
        revertVariant(withLine, accepted, 0, index, editionOf, { pool: noSinistea, energies: fire, valid: () => true })
          ?.undoes,
      ).toBe(1)
      // A pre-evolution the pool does not have that attacks on its own stays free: Nosepass ([C][C]) with Metal.
      const noNosepass = poolForZone(
        mutationPool({ index, energies: ['metal'], edition, maxCopies: (groupId) => (groupId === 'A2-86' ? 0 : 2) }),
        ['metal'],
        index,
      )
      expect(noNosepass.some((card) => card.groupId === 'A2-86')).toBe(false)
      const rocks = [...rest, { cardId: 'A2-86', count: 1 }, { cardId: 'A2-118', count: 2 }]
      const out = [
        { add: [t1.cardId], remove: [group('A2-118')], difference: 5 },
        { add: [t2.cardId], remove: [group('A2-118')], difference: 4 },
      ]
      expect(
        comboVariant(rocks, out, index, { pool: noNosepass, energies: ['metal'], valid: () => true }),
      ).not.toBeNull()
    })

    it('self-review of the follow-up: with what is shown, only names two of its cards share carry the code', () => {
      const shared = sharedNames(['A1-150', 'B3-211', 'B1a-52', 'B1-44'], index)
      expect([...shared]).toEqual(['Onix'])
      expect(labCardNameEs('A1-150', index, shared)).toBe('Onix (A1-150)')
      expect(labCardNameEs('B3-211', index, shared)).toBe('Onix (B1a-38)')
      // Heatmor has another card of its name in the catalog, but not here: no code.
      expect(labCardNameEs('B1-44', index, shared)).toBe(index.cardById('B1-44')?.nameEs)
      // Two editions of one functional card are one card.
      expect(sharedNames(['B1a-38', 'B3-211'], index).size).toBe(0)
    })

    it('a card is named with its code only when another card shares its name', () => {
      expect(labCardNameEs('A1-150', index)).toBe('Onix (A1-150)')
      // A reprint carries its functional card's code (the one the plan shows).
      expect(labCardNameEs('B3-211', index)).toBe('Onix (B1a-38)')
      expect(labCardNameEs('B1a-52', index)).toBe('Mega-Steelix ex')
    })

    it('the note names only evolutions that can come in', () => {
      const noMega = (step: CardEdition) => step.functionalGroupId !== 'B1a-52'
      expect(zoneNoteEs(landCrushOnix, metal, index, noMega)).toBe(
        'no puede atacar con las energías de la lista, pero evoluciona en Steelix',
      )
      expect(zoneNoteEs(landCrushOnix, metal, index, () => false)).toBe('no puede atacar con las energías de la lista')
    })
  })
})
