/**
 * Opening hand and natural draws (Fase 10): the chance of having a card by a given own turn, exactly (no
 * simulation). Rules as deckgym plays them and the game promises: 20 cards, an opening hand of 5 with at least one
 * Basic Pokémon (fossils are trainers and do not count), and one card drawn at the start of every turn, the first
 * player's first turn included, so by own turn N a player has seen 5 + N cards. The opening hand is modeled as a
 * fair deal redealt until it holds a Basic (the hypergeometric conditioned on «at least one Basic»). Cards that draw
 * or search (Professor's Research, Poké Ball…) are not counted: these are natural draws only.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { DeckCardEntry } from './types.js'
import { DECK_SIZE } from './validate.js'

export const OPENING_HAND = 5
/** Cards in a legal deck (re-exported for the calculator's defaults). */
export const DRAW_DECK_SIZE = DECK_SIZE
/** Own turns reported by default (own turn 6 = 11 cards seen). */
export const DRAW_ODDS_TURNS = 6

/** Copies of a group of cards («any of these»), split by whether they are Basic Pokémon. */
export interface DrawGroup {
  basic: number
  other: number
}

export interface DrawOddsInput {
  /** Cards in the deck (20 for a legal deck). */
  deckSize: number
  /** Basic Pokémon in the whole deck (the groups' basic copies included). */
  basics: number
  /** One or two disjoint groups: the odds of at least one card of each. */
  groups: readonly DrawGroup[]
  turns?: number
}

export interface DrawOddsRow {
  /** 0 = the opening hand; N = own turn N, after its draw. */
  turn: number
  cardsSeen: number
  /** P(at least one card of each group), 0–1, in the order of the groups. */
  each: number[]
  /** P(at least one card of every group at once); null with a single group. */
  all: number | null
}

export interface DrawOdds {
  rows: DrawOddsRow[]
  /** P(exactly j Basic Pokémon in the opening hand), j = 1…5. */
  basicsInHand: { count: number; probability: number }[]
}

function choose(n: number, k: number): number {
  if (k < 0 || n < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= Math.min(k, n - k); i++) result = (result * (n - i + 1)) / i
  return result
}

interface Category {
  size: number
  basic: boolean
  /** Index of the group it belongs to, or -1. */
  group: number
}

/** Every way to split `total` drawn cards among the categories, with its count of combinations. */
function* splits(categories: readonly Category[], total: number, at = 0, taken: number[] = []): Generator<number[]> {
  if (at === categories.length) {
    if (total === 0) yield [...taken]
    return
  }
  const size = categories[at]?.size ?? 0
  for (let x = 0; x <= Math.min(size, total); x++) {
    taken.push(x)
    yield* splits(categories, total - x, at + 1, taken)
    taken.pop()
  }
}

/** Exact odds for one or two groups of cards by own turn, under the opening-hand rule above. */
export function drawOdds(input: DrawOddsInput): DrawOdds {
  const { deckSize, basics, groups } = input
  const turns = input.turns ?? DRAW_ODDS_TURNS
  if (groups.length < 1 || groups.length > 2) throw new RangeError('drawOdds: one or two groups')
  const groupBasics = groups.reduce((sum, group) => sum + group.basic, 0)
  const groupCards = groups.reduce((sum, group) => sum + group.basic + group.other, 0)
  if (basics < 1 || basics < groupBasics || groupCards - groupBasics > deckSize - basics || deckSize < OPENING_HAND) {
    throw new RangeError('drawOdds: counts do not fit the deck (at least one Basic, groups inside the deck)')
  }
  const categories: Category[] = []
  groups.forEach((group, index) => {
    categories.push({ size: group.basic, basic: true, group: index })
    categories.push({ size: group.other, basic: false, group: index })
  })
  categories.push({ size: basics - groupBasics, basic: true, group: -1 })
  categories.push({ size: deckSize - basics - (groupCards - groupBasics), basic: false, group: -1 })

  const hands = choose(deckSize, OPENING_HAND)
  const rest = deckSize - OPENING_HAND
  let withBasic = 0
  const basicsCount = new Array<number>(OPENING_HAND + 1).fill(0)
  const each = Array.from({ length: turns + 1 }, () => new Array<number>(groups.length).fill(0))
  const all = new Array<number>(turns + 1).fill(0)
  for (const split of splits(categories, OPENING_HAND)) {
    let weight = 1
    split.forEach((x, at) => {
      weight *= choose(categories[at]?.size ?? 0, x)
    })
    weight /= hands
    const basicsDrawn = split.reduce((sum, x, at) => sum + (categories[at]?.basic ? x : 0), 0)
    if (basicsDrawn === 0) continue
    withBasic += weight
    basicsCount[basicsDrawn] = (basicsCount[basicsDrawn] ?? 0) + weight
    // Per group: already in hand, and how many of its cards are left in the deck.
    const inHand = groups.map((_, g) => split.some((x, at) => categories[at]?.group === g && x > 0))
    const left = groups.map(
      (group, g) =>
        group.basic + group.other - split.reduce((sum, x, at) => sum + (categories[at]?.group === g ? x : 0), 0),
    )
    for (let turn = 0; turn <= turns; turn++) {
      const drawn = Math.min(turn, rest)
      const miss = (cards: number) => choose(rest - cards, drawn) / choose(rest, drawn)
      const noGroup = groups.map((_, g) => (inHand[g] ? 0 : miss(left[g] ?? 0)))
      noGroup.forEach((p, g) => {
        const row = each[turn] as number[]
        row[g] = (row[g] ?? 0) + weight * (1 - p)
      })
      if (groups.length === 2) {
        const noBoth = inHand[0] || inHand[1] ? 0 : miss((left[0] ?? 0) + (left[1] ?? 0))
        all[turn] = (all[turn] ?? 0) + weight * (1 - (noGroup[0] ?? 0) - (noGroup[1] ?? 0) + noBoth)
      }
    }
  }
  return {
    rows: each.map((row, turn) => ({
      turn,
      cardsSeen: OPENING_HAND + Math.min(turn, rest),
      each: row.map((value) => value / withBasic),
      all: groups.length === 2 ? (all[turn] ?? 0) / withBasic : null,
    })),
    basicsInHand: basicsCount
      .map((value, count) => ({ count, probability: value / withBasic }))
      .filter((row) => row.count >= 1),
  }
}

/** A group of the deck's cards by functional group: its Basic and other copies. */
export function deckDrawGroup(
  cards: readonly DeckCardEntry[],
  groupIds: readonly CardId[],
  index: CatalogIndex,
): DrawGroup {
  const wanted = new Set(groupIds)
  const group: DrawGroup = { basic: 0, other: 0 }
  for (const entry of cards) {
    const card = index.cardById(entry.cardId)
    if (!card || !wanted.has(card.functionalGroupId)) continue
    if (isBasicPokemon(card)) group.basic += entry.count
    else group.other += entry.count
  }
  return group
}

export function isBasicPokemon(card: { cardType: string; evolutionType: string }): boolean {
  return card.cardType === 'pokemon' && card.evolutionType === 'basic'
}

/** The deck's size and Basic Pokémon, the base of `drawOdds`. */
export function deckDrawBase(
  cards: readonly DeckCardEntry[],
  index: CatalogIndex,
): { deckSize: number; basics: number } {
  let deckSize = 0
  let basics = 0
  for (const entry of cards) {
    deckSize += entry.count
    const card = index.cardById(entry.cardId)
    if (card && isBasicPokemon(card)) basics += entry.count
  }
  return { deckSize, basics }
}
