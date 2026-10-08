/**
 * Variants of a deck for the automatic search (T-008): one or two card swaps at a time (a copy goes out, a copy of
 * another card goes in) with the energies fixed. What goes in comes from a pool (the collection or every card the
 * engine plays): trainers, and Pokémon that can attack with the deck's energies (or have an ability) and are of one of
 * its types or played somewhere in the era. Cards the era plays, and above all the ones lists like this deck play,
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
}

/** How much more often a card comes up: trainers ×2, then up to ×11 for era usage and ×11 for archetype usage. */
export function poolWeight(cardType: 'pokemon' | 'trainer', usage: number, affinity: number): number {
  return (cardType === 'trainer' ? 2 : 1) * (1 + 10 * (usage / 100)) * (1 + 10 * (affinity / 100))
}

/** A Pokémon is worth trying when one of its attacks can be paid with the deck's energies, or it has an ability. */
export function usableWith(card: CardEdition, energies: readonly SelectableEnergy[]): boolean {
  if (card.cardType !== 'pokemon') return true
  if (card.ability !== null) return true
  const have = new Set<string>(energies)
  return card.attacks.some((attack) => attack.cost.every((type) => type === 'colorless' || have.has(type)))
}

export function mutationPool(options: PoolOptions): PoolCard[] {
  const pool: PoolCard[] = []
  for (const group of options.index.catalog.groups) {
    const maxCopies = Math.min(2, options.maxCopies(group.id))
    if (maxCopies < 1) continue
    const card = options.edition(group.id)
    if (!card || !usableWith(card, options.energies)) continue
    const usage = options.usage?.(group.id) ?? 0
    const affinity = options.affinity?.(group.id) ?? 0
    // An off-type Pokémon without an ability that no list of the era plays is noise: it stays out.
    const ownType = (options.energies as readonly string[]).includes(card.energy)
    if (card.cardType === 'pokemon' && !ownType && card.ability === null && usage <= 0 && affinity <= 0) continue
    pool.push({
      cardId: card.id,
      groupId: group.id,
      nameEn: card.nameEn,
      maxCopies,
      weight: poolWeight(card.cardType, usage, affinity),
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
}

export interface VariantOptions {
  /** Functional cards that never go out. */
  locked?: ReadonlySet<CardId> | undefined
  /** Swaps per variant (default: 1 most of the time, 2 sometimes). */
  swaps?: number | undefined
  /** Draws before giving up (default 40). */
  attempts?: number | undefined
  /** Keys already tried: a variant never repeats one. */
  seen?: ReadonlySet<string> | undefined
  /** Share of the lists like this deck that play the card (0–100): the more, the less often it goes out. */
  affinity?: ((groupId: CardId) => number) | undefined
}

function weightedPick<T extends { weight: number }>(items: readonly T[], random: () => number): T | null {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  if (items.length === 0 || total <= 0) return null
  let at = random() * total
  for (const item of items) {
    at -= item.weight
    if (at < 0) return item
  }
  return items[items.length - 1] ?? null
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
    const swaps = options.swaps ?? (random() < 0.7 ? 1 : 2)
    let ok = true
    for (let swap = 0; swap < swaps && ok; swap++) ok = swapOnce(cards, pool, index, random, locked, options.affinity)
    if (!ok) continue
    const groups = groupsOfCards(cards, index)
    const key = listKeyByGroup(groups)
    if (key === baseKey || options.seen?.has(key)) continue
    if (validateDeck({ cards, energies: [...energies] }, index).errors.length > 0) continue
    const sorted = cards.filter((entry) => entry.count > 0)
    return { cards: sorted, key, ...cardChanges(deck, sorted, index) }
  }
  return null
}

/**
 * One swap in place: a pool card in (with its pre-evolution when missing), as many random copies out — weighted by
 * copies and away from the archetype's core (a card every similar list plays goes out 10 times less often).
 */
function swapOnce(
  cards: DeckCardEntry[],
  pool: readonly PoolCard[],
  index: CatalogIndex,
  random: () => number,
  locked: ReadonlySet<CardId>,
  affinity: ((groupId: CardId) => number) | undefined,
): boolean {
  const groupCount = (groupId: CardId) =>
    cards.reduce(
      (sum, entry) => sum + (index.cardById(entry.cardId)?.functionalGroupId === groupId ? entry.count : 0),
      0,
    )
  const nameCount = (nameEn: string) =>
    cards.reduce((sum, entry) => sum + (index.cardById(entry.cardId)?.nameEn === nameEn ? entry.count : 0), 0)
  const fits = (item: PoolCard) => groupCount(item.groupId) < item.maxCopies && nameCount(item.nameEn) < 2
  const pick = weightedPick(pool.filter(fits), random)
  if (!pick) return false
  const incoming = [pick]
  const card = index.cardById(pick.cardId)
  if (card?.evolvesFrom && nameCount(card.evolvesFrom) === 0) {
    const pre = pool.find((item) => item.nameEn === card.evolvesFrom && fits(item))
    if (!pre) return false
    incoming.unshift(pre)
  }
  const added = new Set(incoming.map((item) => item.groupId))
  for (const item of incoming) {
    const existing = cards.find((entry) => index.cardById(entry.cardId)?.functionalGroupId === item.groupId)
    if (existing) existing.count += 1
    else cards.push({ cardId: item.cardId, count: 1 })
  }
  for (let out = 0; out < incoming.length; out++) {
    const removable = cards
      .map((entry) => ({ entry, groupId: index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId }))
      .filter(({ entry, groupId }) => entry.count > 0 && !locked.has(groupId) && !added.has(groupId))
      .map(({ entry, groupId }) => ({ entry, weight: entry.count / (1 + 9 * ((affinity?.(groupId) ?? 0) / 100)) }))
    const victim = weightedPick(removable, random)
    if (!victim) return false
    victim.entry.count -= 1
  }
  for (let i = cards.length - 1; i >= 0; i--) if ((cards[i]?.count ?? 0) <= 0) cards.splice(i, 1)
  return true
}
