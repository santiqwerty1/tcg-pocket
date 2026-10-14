/**
 * Variants of a deck for the automatic search (T-008): one or two card swaps at a time (a copy goes out, a copy of
 * another card goes in) with the energies fixed. What goes in comes from a pool (the collection or every card the
 * engine plays): trainers, and Pokémon that can attack with the deck's energies (or have an ability), themselves or
 * through an evolution, and are of one of its types (the line's) or played somewhere in the era. Cards the era plays, and above all the ones lists like this deck play,
 * come up more often, but any card in the pool can come; what goes out is drawn the other way round, so the core of
 * the archetype is rarely touched. An evolution goes in with its pre-evolution when the deck lacks it. Every variant
 * validates as a deck (20 cards, 2 copies per name, a basic, evolution lines). Draws come from a seeded generator:
 * the same seed, the same variants.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, SelectableEnergy } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { validateDeck } from '../decks/validate.js'
import { listKeyByGroup } from '../tournaments/dataset.js'
import { groupsOfCards } from './novelty.js'

/** Mulberry32 on a seed folded to 32 bits: a small, reproducible generator of numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = (Math.floor(seed) ^ Math.floor(seed / 2 ** 32)) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PoolCard {
  /** The edition that goes in (one the engine plays). */
  cardId: CardId
  groupId: CardId
  nameEn: string
  /** Most copies a variant may hold (2, or what the collection has). */
  maxCopies: number
  /** Draw weight: cards the era plays more are tried more often, but any card can come. */
  weight: number
}

export interface PoolOptions {
  index: CatalogIndex
  energies: readonly SelectableEnergy[]
  /** The edition to put in for a functional card, or null when it cannot go in (not implemented, not owned…). */
  edition: (groupId: CardId) => CardEdition | null
  /** Copies available (the collection's playable copies, or 2). */
  maxCopies: (groupId: CardId) => number
  /** Share of the era's lists that play the card (0–100). */
  usage?: ((groupId: CardId) => number) | undefined
  /** Share of the lists like this deck (its archetype) that play the card (0–100). */
  affinity?: ((groupId: CardId) => number) | undefined
  /** Fase 16: only cards an event allows can come in. */
  allow?: ((card: CardEdition) => boolean) | undefined
}

/** How much more often a card comes up: trainers ×2, then up to ×11 for era usage and ×11 for archetype usage. */
export function poolWeight(cardType: 'pokemon' | 'trainer', usage: number, affinity: number): number {
  return (cardType === 'trainer' ? 2 : 1) * (1 + 10 * (usage / 100)) * (1 + 10 * (affinity / 100))
}

/** One of the Pokémon's attacks can be paid with the zone (Colorless with any type). */
function paysAnAttack(card: CardEdition, energies: readonly SelectableEnergy[]): boolean {
  return card.attacks.some((attack) =>
    attack.cost.every((type) => type === 'colorless' || (energies as readonly string[]).includes(type)),
  )
}

/**
 * A Pokémon is worth trying when one of its attacks can be paid with the deck's energies, or it has an ability. With
 * the index, its evolutions count too: a Pokémon that evolves into one that can attack (or has an ability) is the base
 * of that line — Onix (Land Crush, three Fighting) in a Metal deck evolves into Mega-Steelix ex.
 */
export function usableWith(
  card: CardEdition,
  energies: readonly SelectableEnergy[],
  index?: CatalogIndex | undefined,
): boolean {
  const usable = (step: CardEdition) =>
    step.cardType !== 'pokemon' || step.ability !== null || paysAnAttack(step, energies)
  return index ? evolutionLine(card, index).some(usable) : usable(card)
}

/** Per catalog, the display editions of the cards that evolve from each English name. */
const evolutionsByName = new WeakMap<CatalogIndex, Map<string, CardEdition[]>>()

function evolutionsOf(nameEn: string, index: CatalogIndex): readonly CardEdition[] {
  let byName = evolutionsByName.get(index)
  if (!byName) {
    byName = new Map()
    for (const group of index.catalog.groups) {
      const card = index.cardById(group.displayCardId)
      if (!card?.evolvesFrom) continue
      const list = byName.get(card.evolvesFrom)
      if (list) list.push(card)
      else byName.set(card.evolvesFrom, [card])
    }
    evolutionsByName.set(index, byName)
  }
  return byName.get(nameEn) ?? []
}

/**
 * The card and every card up its evolution line, by English name (Onix, then each Steelix and Mega-Steelix ex), each
 * functional card once.
 */
export function evolutionLine(card: CardEdition, index: CatalogIndex): CardEdition[] {
  const line = [card]
  const groups = new Set([card.functionalGroupId])
  for (let at = 0; at < line.length; at++) {
    const step = line[at] as CardEdition
    for (const next of evolutionsOf(step.nameEn, index)) {
      if (groups.has(next.functionalGroupId)) continue
      groups.add(next.functionalGroupId)
      line.push(next)
    }
  }
  return line
}

/**
 * How a card enters a pool for an Energy Zone:
 * - `draw`, drawn on its own (as before): it can attack with the zone or has an ability, and it is of one of the
 *   zone's types, has an ability or the era or the archetype plays it (`played`);
 * - `helper`, only as the pre-evolution of a card that comes in (weight 0): it is not drawn alone, but a card up its
 *   line can attack or has an ability, and the line is of the zone's type or has one — Onix (three Fighting) in a
 *   Metal deck comes along with Mega-Steelix ex, never alone (self-review of the fix for Onix, 14/10);
 * - null: it stays out.
 */
export function zoneRole(
  card: CardEdition,
  energies: readonly SelectableEnergy[],
  index: CatalogIndex,
  played: boolean,
): 'draw' | 'helper' | null {
  if (card.cardType !== 'pokemon') return 'draw'
  const ownType = (energies as readonly string[]).includes(card.energy)
  if (usableWith(card, energies) && (ownType || card.ability !== null || played)) return 'draw'
  const line = evolutionLine(card, index)
  const fits = line.some((step) => step.ability !== null || (energies as readonly string[]).includes(step.energy))
  return fits && usableWith(card, energies, index) ? 'helper' : null
}

/**
 * Why a card asked for by hand cannot attack with the list's energies (null when it can, or has an ability): what it
 * evolves into that can («pero evoluciona en Mega-Steelix ex»), or that has an ability. The card is tried anyway: it
 * may serve as a wall, to retreat into, or as a base.
 */
export function zoneNoteEs(
  card: CardEdition,
  energies: readonly SelectableEnergy[],
  index: CatalogIndex,
  /** Review of #107: only evolutions that can come in (the engine plays them, the event allows them). */
  allowed: (card: CardEdition) => boolean = () => true,
): string | null {
  if (usableWith(card, energies)) return null
  const later = evolutionLine(card, index).slice(1).filter(allowed)
  const names = (steps: readonly CardEdition[]) => {
    const unique = [...new Set(steps.map((step) => step.nameEs))]
    const last = unique.pop()
    return unique.length > 0 ? `${unique.join(', ')} y ${last}` : last
  }
  const base = 'no puede atacar con las energías de la lista'
  const attackers = later.filter((step) => paysAnAttack(step, energies))
  if (attackers.length > 0) return `${base}, pero evoluciona en ${names(attackers)}`
  const abilities = later.filter((step) => step.ability !== null)
  if (abilities.length === 0) return base
  const many = new Set(abilities.map((step) => step.nameEs)).size > 1
  return `${base}, pero evoluciona en ${names(abilities)}, que ${many ? 'tienen habilidades' : 'tiene una habilidad'}`
}

/**
 * The pool cards worth trying with an Energy Zone (`zoneRole`): those drawn on their own keep their weight, and the
 * pre-evolutions that only come along go with weight 0. Review of #27: a search freezes its pool for every zone and
 * filters it with the zone in play, which an Energy variant may have changed. The cards asked for by hand (`asked`, by
 * functional card) always stay with their weight, and the pool cards they evolve from with weight 0 at least:
 * «probar estas cartas» tries them whatever the zone.
 */
export function poolForZone(
  pool: readonly PoolCard[],
  energies: readonly SelectableEnergy[],
  index: CatalogIndex,
  asked: ReadonlySet<CardId> = new Set(),
): PoolCard[] {
  const kept = preEvolutionNames(pool, asked, index)
  return pool.flatMap((item) => {
    if (asked.has(item.groupId)) return [item]
    const card = index.cardById(item.cardId)
    if (!card) return []
    const role = zoneRole(card, energies, index, item.weight > 1)
    if (role === 'draw') return [item]
    return role === 'helper' || kept.has(item.nameEn) ? [{ ...item, weight: 0 }] : []
  })
}

/** The English names the pool cards in `asked` evolve from (one step: a swap brings one pre-evolution along). */
function preEvolutionNames(pool: readonly PoolCard[], asked: ReadonlySet<CardId>, index: CatalogIndex): Set<string> {
  const names = new Set<string>()
  for (const item of pool) {
    const from = asked.has(item.groupId) ? index.cardById(item.cardId)?.evolvesFrom : null
    if (from) names.add(from)
  }
  return names
}

/**
 * Review of #107: `next` leaves alone a card that only comes along as a pre-evolution (weight 0 in `pool`) whose
 * evolution `parent` had: «+Polteageist +Sinistea» accepted, and two rounds later a swap takes Polteageist out and
 * Sinistea stays, a Basic that cannot attack. A list that already had it alone is left as it was.
 */
export function strandsPreEvolution(
  parent: readonly DeckCardEntry[],
  next: readonly DeckCardEntry[],
  pool: readonly PoolCard[],
  index: CatalogIndex,
): boolean {
  const helpers = new Set(pool.filter((item) => item.weight <= 0).map((item) => item.groupId))
  if (helpers.size === 0) return false
  const evolvedFrom = (cards: readonly DeckCardEntry[]) =>
    new Set(
      cards
        .filter((entry) => entry.count > 0)
        .map((entry) => index.cardById(entry.cardId)?.evolvesFrom)
        .filter((name): name is string => !!name),
    )
  const before = evolvedFrom(parent)
  const after = evolvedFrom(next)
  return next.some((entry) => {
    const card = entry.count > 0 ? index.cardById(entry.cardId) : undefined
    return !!card && helpers.has(card.functionalGroupId) && before.has(card.nameEn) && !after.has(card.nameEn)
  })
}

/**
 * A card's Spanish name in the Laboratorio, with the code of its functional card when another one shares its name
 * (review of #107): Onix A1-150 (three Fighting) and Onix B1a-38 (three Colorless) are different cards.
 */
export function labCardNameEs(cardId: CardId, index: CatalogIndex): string {
  const card = index.cardById(cardId) ?? index.cardById(index.groupById(cardId)?.displayCardId ?? cardId)
  if (!card) return cardId
  const group = index.groupById(card.functionalGroupId)
  const shared = index.groupsByNameEn(card.nameEn).length > 1
  return shared && group ? `${card.nameEs} (${group.displayCardId})` : card.nameEs
}

/**
 * The copies a combo may reach of each card: the pool's (the collection's, with «colección»), taken from the pool
 * frozen for every zone (review of #35 by Codex: the zone's filter must not drop a card's cap), 0 for a card outside
 * it with the pool «colección» and 2 with «todas».
 */
export function poolCaps(pool: readonly PoolCard[], which: 'collection' | 'all'): (groupId: CardId) => number {
  const caps = new Map(pool.map((card) => [card.groupId, card.maxCopies]))
  return (groupId) => caps.get(groupId) ?? (which === 'collection' ? 0 : 2)
}

export function mutationPool(options: PoolOptions): PoolCard[] {
  const pool: PoolCard[] = []
  for (const group of options.index.catalog.groups) {
    const maxCopies = Math.min(2, options.maxCopies(group.id))
    if (maxCopies < 1) continue
    const card = options.edition(group.id)
    if (!card) continue
    if (options.allow && !options.allow(card)) continue
    const usage = options.usage?.(group.id) ?? 0
    const affinity = options.affinity?.(group.id) ?? 0
    // An off-type Pokémon without an ability that no list of the era plays is noise: it only comes along as the
    // pre-evolution of a card that fits (weight 0), or stays out.
    const role = zoneRole(card, options.energies, options.index, usage > 0 || affinity > 0)
    if (!role) continue
    pool.push({
      cardId: card.id,
      groupId: group.id,
      nameEn: card.nameEn,
      maxCopies,
      weight: role === 'draw' ? poolWeight(card.cardType, usage, affinity) : 0,
    })
  }
  return pool
}

export interface VariantChange {
  cardId: CardId
  count: number
}

export interface Variant {
  cards: DeckCardEntry[]
  /** The list's key by functional card (the same key tournament lists use). */
  key: string
  add: VariantChange[]
  remove: VariantChange[]
  /** T-017 C6: another Energy Zone for the same cards (absent: the parent's). */
  energies?: SelectableEnergy[]
}

export interface VariantOptions {
  /** Functional cards that never go out. */
  locked?: ReadonlySet<CardId> | undefined
  /**
   * Swaps per variant (default 1). T-017 C7: two random swaps at once blur which one helped and more often carry a
   * harmful one; two changes are tried together only when they go together — an evolution with its pre-evolution, or
   * the combo of the two best measured swaps (C4).
   */
  swaps?: number | undefined
  /** Draws before giving up (default 40). */
  attempts?: number | undefined
  /** Keys already tried: a variant never repeats one. */
  seen?: ReadonlySet<string> | undefined
  /** Share of the lists like this deck that play the card (0–100): the more, the less often it goes out. */
  affinity?: ((groupId: CardId) => number) | undefined
  /** Fase 16: a variant must also pass this (an event's counts, like «al menos 8 Pokémon de tipo Fuego»). */
  accept?: ((cards: readonly DeckCardEntry[]) => boolean) | undefined
  /** T-017 C4: how much more often a card comes in, from what earlier rounds measured (`learnedFactor`). */
  boostIn?: ((groupId: CardId) => number) | undefined
  /** The same for a card going out. */
  boostOut?: ((groupId: CardId) => number) | undefined
}

function weightedPick<T extends { weight: number }>(items: readonly T[], random: () => number): T | null {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  if (items.length === 0 || total <= 0) return null
  let at = random() * total
  for (const item of items) {
    at -= item.weight
    if (at < 0) return item
  }
  // Rounding: the last item that can be drawn (never a pre-evolution that only comes along, weight 0).
  return items.findLast((item) => item.weight > 0) ?? null
}

/** Card changes from `from` to `to` by functional card, named by the edition each side plays. */
export function cardChanges(
  from: readonly DeckCardEntry[],
  to: readonly DeckCardEntry[],
  index: CatalogIndex,
): { add: VariantChange[]; remove: VariantChange[] } {
  const before = groupsOfCards(from, index)
  const after = groupsOfCards(to, index)
  const editionIn = (cards: readonly DeckCardEntry[], groupId: CardId) =>
    cards.find((entry) => index.cardById(entry.cardId)?.functionalGroupId === groupId)?.cardId ?? groupId
  const add: VariantChange[] = []
  const remove: VariantChange[] = []
  for (const [groupId, count] of after) {
    const own = before.get(groupId) ?? 0
    if (count > own) add.push({ cardId: editionIn(to, groupId), count: count - own })
  }
  for (const [groupId, count] of before) {
    const left = after.get(groupId) ?? 0
    if (count > left) remove.push({ cardId: editionIn(from, groupId), count: count - left })
  }
  return { add, remove }
}

/** A random valid variant of `deck`, or null when none turned up in `attempts` draws. */
export function variantOf(
  deck: readonly DeckCardEntry[],
  energies: readonly SelectableEnergy[],
  pool: readonly PoolCard[],
  index: CatalogIndex,
  random: () => number,
  options: VariantOptions = {},
): Variant | null {
  const locked = options.locked ?? new Set<CardId>()
  const baseKey = listKeyByGroup(groupsOfCards(deck, index))
  const attempts = options.attempts ?? 40
  for (let attempt = 0; attempt < attempts; attempt++) {
    const cards = deck.map((entry) => ({ ...entry }))
    const swaps = options.swaps ?? 1
    let ok = true
    for (let swap = 0; swap < swaps && ok; swap++) ok = swapOnce(cards, pool, index, random, locked, options)
    if (!ok) continue
    const groups = groupsOfCards(cards, index)
    const key = listKeyByGroup(groups)
    if (key === baseKey || options.seen?.has(key)) continue
    if (validateDeck({ cards, energies: [...energies] }, index).errors.length > 0) continue
    if (strandsPreEvolution(deck, cards, pool, index)) continue
    if (options.accept && !options.accept(cards)) continue
    const sorted = cards.filter((entry) => entry.count > 0)
    return { cards: sorted, key, ...cardChanges(deck, sorted, index) }
  }
  return null
}

/**
 * Puts a copy of `cardId` where one copy of `cards[at]` was (H-020). The engine shuffles a deck by position (the
 * Basics and the rest apart), so a list that keeps every other card where it was faces the same shuffles as its parent
 * under the same seed: the common random numbers then compare the swap, not a reshuffled deck. A card already in the
 * list gets a line of its own here rather than a higher count on its first line.
 */
/**
 * Puts `cardId` at copy position `slot` of the deck (deck order, every copy counted), splitting its line when it had
 * more copies (H-020). False when the deck has no such position.
 */
export function replaceSlot(cards: DeckCardEntry[], slot: number, cardId: CardId): boolean {
  let start = 0
  for (const [line, entry] of cards.entries()) {
    if (slot < start + entry.count) {
      const before = slot - start
      const after = entry.count - before - 1
      cards.splice(
        line,
        1,
        ...(before > 0 ? [{ cardId: entry.cardId, count: before }] : []),
        { cardId, count: 1 },
        ...(after > 0 ? [{ cardId: entry.cardId, count: after }] : []),
      )
      return true
    }
    start += entry.count
  }
  return false
}

/** The functional card at each copy position of the deck, in deck order. */
export function slotGroups(cards: readonly DeckCardEntry[], index: CatalogIndex): CardId[] {
  return cards.flatMap((entry) =>
    Array.from({ length: entry.count }, () => index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId),
  )
}

function replaceCopy(cards: DeckCardEntry[], at: number, cardId: CardId): void {
  const entry = cards[at]
  if (!entry) return
  if (entry.count <= 1) cards[at] = { cardId, count: 1 }
  else {
    entry.count -= 1
    cards.splice(at + 1, 0, { cardId, count: 1 })
  }
}

/**
 * T-017 C4: makes a swap measured earlier on `cards`, in place: each card that came in takes the place of a copy of
 * the card that went out with it (H-020), in the edition the list already plays when it has one. False (and `cards`
 * possibly half changed) when a card that went out is no longer there or is locked.
 */
export function applySwap(
  cards: DeckCardEntry[],
  swap: { add: readonly CardId[]; remove: readonly CardId[] },
  index: CatalogIndex,
  locked?: ReadonlySet<CardId>,
): boolean {
  for (let k = 0; k < swap.remove.length; k++) {
    const out = swap.remove[k] as CardId
    const incoming = swap.add[k]
    if (incoming === undefined || locked?.has(out)) return false
    const at = cards.findIndex((entry) => entry.count > 0 && index.cardById(entry.cardId)?.functionalGroupId === out)
    if (at < 0) return false
    const group = index.cardById(incoming)?.functionalGroupId ?? incoming
    const edition = cards.find((entry) => index.cardById(entry.cardId)?.functionalGroupId === group)?.cardId ?? incoming
    replaceCopy(cards, at, edition)
  }
  return true
}

/**
 * One swap in place: a pool card in (with its pre-evolution when missing), as many random copies out — weighted by
 * copies and away from the archetype's core (a card every similar list plays goes out 10 times less often). Each
 * copy that comes in takes the place of the one that goes out.
 */
function swapOnce(
  cards: DeckCardEntry[],
  pool: readonly PoolCard[],
  index: CatalogIndex,
  random: () => number,
  locked: ReadonlySet<CardId>,
  options: Pick<VariantOptions, 'affinity' | 'boostIn' | 'boostOut'>,
): boolean {
  const { affinity, boostIn, boostOut } = options
  const groupCount = (groupId: CardId) =>
    cards.reduce(
      (sum, entry) => sum + (index.cardById(entry.cardId)?.functionalGroupId === groupId ? entry.count : 0),
      0,
    )
  const nameCount = (nameEn: string) =>
    cards.reduce((sum, entry) => sum + (index.cardById(entry.cardId)?.nameEn === nameEn ? entry.count : 0), 0)
  const fits = (item: PoolCard) => groupCount(item.groupId) < item.maxCopies && nameCount(item.nameEn) < 2
  const candidates = pool.filter(fits)
  const pick = weightedPick(
    boostIn ? candidates.map((item) => ({ ...item, weight: item.weight * boostIn(item.groupId) })) : candidates,
    random,
  )
  if (!pick) return false
  const incoming = [pick]
  const card = index.cardById(pick.cardId)
  if (card?.evolvesFrom && nameCount(card.evolvesFrom) === 0) {
    // One drawn on its own first (as before the pre-evolutions with weight 0: Onix B1a-38, not A1-150, in Metal).
    const pres = pool.filter((item) => item.nameEn === card.evolvesFrom && fits(item))
    const pre = pres.find((item) => item.weight > 0) ?? pres[0]
    if (!pre) return false
    incoming.unshift(pre)
  }
  const added = new Set(incoming.map((item) => item.groupId))
  for (const item of incoming) {
    const removable = cards
      .map((entry, at) => ({ entry, at, groupId: index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId }))
      .filter(({ entry, groupId }) => entry.count > 0 && !locked.has(groupId) && !added.has(groupId))
      .map(({ entry, at, groupId }) => ({
        at,
        weight: (entry.count / (1 + 9 * ((affinity?.(groupId) ?? 0) / 100))) * (boostOut?.(groupId) ?? 1),
      }))
    const victim = weightedPick(removable, random)
    if (!victim) return false
    // The edition the list already plays of that card, if any (a second copy looks like the first).
    const edition =
      cards.find((entry) => index.cardById(entry.cardId)?.functionalGroupId === item.groupId)?.cardId ?? item.cardId
    replaceCopy(cards, victim.at, edition)
  }
  return true
}
