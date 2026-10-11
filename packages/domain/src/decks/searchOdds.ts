/**
 * Fase 44: draws counting the cards that search (T-014). The exact odds of Fase 10 count natural draws only; with
 * Poké Ball, Investigación de Profesores and Comunicación Pokémon in the deck the real chance of having a card by own
 * turn N is higher. Those plays depend on what is in hand, so this one is a seeded Monte Carlo (the same deck and seed
 * give the same numbers), with the rules as deckgym plays them:
 *
 * - Opening hand of 5 with at least one Basic Pokémon (redealt otherwise), one card drawn every own turn (the first
 *   player's first turn included). Turn 0 is the opening hand: nothing is played before it. One Basic of the opening
 *   hand goes to the Active Spot and leaves the hand.
 * - While the card is not in hand, every turn plays, in this order and again while something changes: each Poké Ball
 *   (a random Basic Pokémon of the deck to the hand), each Comunicación Pokémon when the card is a Pokémon and the hand
 *   holds another Pokémon (that one goes to the deck and a random Pokémon of the deck comes), and one Investigación de
 *   Profesores per turn (draw 2). Supporters can be played on the first turn.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { seededRandom } from '../lab/mutate.js'
import { isBasicPokemon } from './drawOdds.js'
import type { DeckCardEntry } from './types.js'

export type SearchKind = 'pokeball' | 'research' | 'communication'

/** Which search card an English name is (editions of the same card share it). */
export function searchKindOf(nameEn: string): SearchKind | null {
  const key = nameEn
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
  if (key === 'poke ball') return 'pokeball'
  if (key === 'professor s research') return 'research'
  if (key === 'pokemon communication') return 'communication'
  return null
}

export interface SearchDeckCard {
  /** Functional group (the target is matched by it). */
  groupId: string
  count: number
  pokemon: boolean
  basic: boolean
  search: SearchKind | null
}

/** The deck's cards by functional group, with what each one is for the simulation. */
export function searchDeckCards(cards: readonly DeckCardEntry[], index: CatalogIndex): SearchDeckCard[] {
  const byGroup = new Map<string, SearchDeckCard>()
  for (const entry of cards) {
    const card = index.cardById(entry.cardId)
    if (!card) continue
    const row = byGroup.get(card.functionalGroupId)
    if (row) row.count += entry.count
    else {
      byGroup.set(card.functionalGroupId, {
        groupId: card.functionalGroupId,
        count: entry.count,
        pokemon: card.cardType === 'pokemon',
        basic: isBasicPokemon(card),
        search: card.cardType === 'trainer' ? searchKindOf(card.nameEn) : null,
      })
    }
  }
  return [...byGroup.values()]
}

export interface SearchOddsInput {
  cards: readonly SearchDeckCard[]
  /** Groups of the card looked for («any of these»). */
  targets: readonly string[]
  turns?: number
  runs?: number
  seed?: number
}

export interface SearchOddsRow {
  turn: number
  /** P(at least one card of the targets in hand by the end of that own turn), 0–1. */
  probability: number
  /** Monte Carlo standard error of `probability`. */
  se: number
}

export interface SearchOdds {
  rows: SearchOddsRow[]
  runs: number
  seed: number
  /** Copies of each search card in the deck. */
  searchCards: Record<SearchKind, number>
}

export const SEARCH_ODDS_RUNS = 20_000
export const SEARCH_ODDS_SEED = 44
const OPENING_HAND = 5

interface Card {
  target: boolean
  pokemon: boolean
  basic: boolean
  search: SearchKind | null
}

export function searchOdds(input: SearchOddsInput): SearchOdds {
  const turns = input.turns ?? 6
  const runs = input.runs ?? SEARCH_ODDS_RUNS
  const seed = input.seed ?? SEARCH_ODDS_SEED
  const targets = new Set(input.targets)
  const deck: Card[] = []
  const searchCards: Record<SearchKind, number> = { pokeball: 0, research: 0, communication: 0 }
  for (const entry of input.cards) {
    if (entry.search) searchCards[entry.search] += entry.count
    for (let i = 0; i < entry.count; i++) {
      deck.push({
        target: targets.has(entry.groupId),
        pokemon: entry.pokemon,
        basic: entry.basic,
        search: entry.search,
      })
    }
  }
  if (!deck.some((card) => card.basic)) throw new RangeError('searchOdds: the deck needs a Basic Pokémon')
  if (deck.length < OPENING_HAND) throw new RangeError('searchOdds: fewer cards than an opening hand')
  const targetIsPokemon = deck.some((card) => card.target && card.pokemon)
  const random = seededRandom(seed)
  const found = new Array<number>(turns + 1).fill(0)

  const shuffle = (cards: Card[]) => {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const swap = cards[i] as Card
      cards[i] = cards[j] as Card
      cards[j] = swap
    }
  }
  const takeRandom = (pile: Card[], which: (card: Card) => boolean): Card | null => {
    const candidates: number[] = []
    pile.forEach((card, i) => {
      if (which(card)) candidates.push(i)
    })
    if (candidates.length === 0) return null
    const at = candidates[Math.floor(random() * candidates.length)] as number
    return pile.splice(at, 1)[0] ?? null
  }
  const removeFrom = (hand: Card[], which: (card: Card) => boolean): Card | null => {
    const at = hand.findIndex(which)
    return at === -1 ? null : (hand.splice(at, 1)[0] ?? null)
  }

  for (let run = 0; run < runs; run++) {
    const pile = [...deck]
    let hand: Card[] = []
    // Redealt until the opening hand holds a Basic Pokémon.
    do {
      pile.push(...hand)
      shuffle(pile)
      hand = pile.splice(0, OPENING_HAND)
    } while (!hand.some((card) => card.basic))
    const has = () => hand.some((card) => card.target)
    if (has()) {
      for (let turn = 0; turn <= turns; turn++) found[turn] = (found[turn] ?? 0) + 1
      continue
    }
    // Setup: one Basic of the opening hand (not the card looked for, or it would have counted) goes to the Active
    // Spot, so Comunicación Pokémon cannot give it (Codex on #52).
    removeFrom(hand, (card) => card.basic)
    for (let turn = 1; turn <= turns; turn++) {
      const drawn = pile.shift()
      if (drawn) hand.push(drawn)
      let supporter = false
      let changed = true
      while (changed && !has()) {
        changed = false
        while (!has() && hand.some((card) => card.search === 'pokeball') && pile.some((card) => card.basic)) {
          removeFrom(hand, (card) => card.search === 'pokeball')
          const basic = takeRandom(pile, (card) => card.basic)
          if (basic) hand.push(basic)
          changed = true
        }
        while (
          !has() &&
          targetIsPokemon &&
          hand.some((card) => card.search === 'communication') &&
          hand.some((card) => card.pokemon && !card.target) &&
          pile.some((card) => card.pokemon)
        ) {
          removeFrom(hand, (card) => card.search === 'communication')
          const given = removeFrom(hand, (card) => card.pokemon && !card.target)
          const taken = takeRandom(pile, (card) => card.pokemon)
          if (taken) hand.push(taken)
          if (given) {
            pile.push(given)
            shuffle(pile)
          }
          changed = true
        }
        if (!has() && !supporter && hand.some((card) => card.search === 'research')) {
          removeFrom(hand, (card) => card.search === 'research')
          supporter = true
          for (let i = 0; i < 2; i++) {
            const card = pile.shift()
            if (card) hand.push(card)
          }
          changed = true
        }
      }
      if (has()) {
        for (let later = turn; later <= turns; later++) found[later] = (found[later] ?? 0) + 1
        break
      }
    }
  }
  return {
    rows: found.map((count, turn) => {
      const probability = count / runs
      return { turn, probability, se: Math.sqrt((probability * (1 - probability)) / runs) }
    }),
    runs,
    seed,
    searchCards,
  }
}
