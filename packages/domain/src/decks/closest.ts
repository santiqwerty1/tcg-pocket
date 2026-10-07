/**
 * «¿Qué mazo ya armado modifico para armar esta lista?» (pedido del 7/10/2026): the distance between two decks is
 * the number of card swaps the game needs, counted by functional card (I2): a different edition of the same
 * functional card is not a change, so it is reported apart. The Energy Zone is reported separately because it is
 * one setting, not a card.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId, SelectableEnergy } from '../catalog/types.js'
import type { DeckCardEntry } from './types.js'

export interface ComparableDeck {
  cards: readonly DeckCardEntry[]
  energies: readonly SelectableEnergy[]
}

export interface CandidateDeck extends ComparableDeck {
  id: string
  name: string
  builtInGame: boolean
}

/** Copies of one functional card that enter or leave, with the editions involved. */
export interface CardChange {
  groupId: string
  nameEs: string
  count: number
  cardIds: CardId[]
}

export interface DeckDistance {
  deckId: string
  name: string
  builtInGame: boolean
  /** Card swaps in the game: max(cards to add, cards to remove). */
  swaps: number
  /** Copies already in place (same functional card, any edition). */
  keep: number
  /** Cards the target has and the candidate lacks, with the target's editions. */
  toAdd: CardChange[]
  /** Cards the candidate has and the target does not, with the candidate's editions. */
  toRemove: CardChange[]
  /** Same functional card in both, but other editions: no swap needed, only if you want the same art. */
  otherEdition: CardChange[]
  energies: { from: SelectableEnergy[]; to: SelectableEnergy[]; change: boolean }
}

interface GroupCount {
  count: number
  cardIds: Set<CardId>
}

function countByGroup(cards: readonly DeckCardEntry[], index: CatalogIndex): Map<string, GroupCount> {
  const groups = new Map<string, GroupCount>()
  for (const entry of cards) {
    const groupId = index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId
    const group = groups.get(groupId)
    if (group) {
      group.count += entry.count
      group.cardIds.add(entry.cardId)
    } else {
      groups.set(groupId, { count: entry.count, cardIds: new Set([entry.cardId]) })
    }
  }
  return groups
}

function nameOf(groupId: string, index: CatalogIndex): string {
  return index.groupById(groupId)?.nameEs ?? index.cardById(groupId)?.nameEs ?? groupId
}

function sameEnergies(a: readonly SelectableEnergy[], b: readonly SelectableEnergy[]): boolean {
  const set = new Set(a)
  return set.size === new Set(b).size && b.every((energy) => set.has(energy))
}

/** What it takes to turn `candidate` into `target`. */
export function deckDistance(target: ComparableDeck, candidate: CandidateDeck, index: CatalogIndex): DeckDistance {
  const wanted = countByGroup(target.cards, index)
  const have = countByGroup(candidate.cards, index)
  const toAdd: CardChange[] = []
  const toRemove: CardChange[] = []
  const otherEdition: CardChange[] = []
  let keep = 0
  for (const [groupId, want] of wanted) {
    const got = have.get(groupId)
    const kept = Math.min(want.count, got?.count ?? 0)
    keep += kept
    if (want.count > kept) {
      toAdd.push({ groupId, nameEs: nameOf(groupId, index), count: want.count - kept, cardIds: [...want.cardIds] })
    }
    if (got && kept > 0 && [...want.cardIds].some((cardId) => !got.cardIds.has(cardId))) {
      otherEdition.push({ groupId, nameEs: nameOf(groupId, index), count: kept, cardIds: [...want.cardIds] })
    }
  }
  for (const [groupId, got] of have) {
    const extra = got.count - Math.min(got.count, wanted.get(groupId)?.count ?? 0)
    if (extra > 0) toRemove.push({ groupId, nameEs: nameOf(groupId, index), count: extra, cardIds: [...got.cardIds] })
  }
  const added = toAdd.reduce((sum, change) => sum + change.count, 0)
  const removed = toRemove.reduce((sum, change) => sum + change.count, 0)
  return {
    deckId: candidate.id,
    name: candidate.name,
    builtInGame: candidate.builtInGame,
    swaps: Math.max(added, removed),
    keep,
    toAdd,
    toRemove,
    otherEdition,
    energies: {
      from: [...candidate.energies],
      to: [...target.energies],
      change: !sameEnergies(candidate.energies, target.energies),
    },
  }
}

/**
 * Candidates ordered by fewest swaps; ties go to the one that keeps the Energy Zone, then to decks built in the
 * game, then by name (numeric collation). `excludeId` leaves out the target itself when it is a saved deck.
 */
export function closestDecks(
  target: ComparableDeck,
  candidates: readonly CandidateDeck[],
  index: CatalogIndex,
  options: { limit?: number; excludeId?: string | null } = {},
): DeckDistance[] {
  return candidates
    .filter((candidate) => candidate.id !== options.excludeId)
    .map((candidate) => deckDistance(target, candidate, index))
    .sort(
      (a, b) =>
        a.swaps - b.swaps ||
        Number(a.energies.change) - Number(b.energies.change) ||
        Number(b.builtInGame) - Number(a.builtInGame) ||
        a.name.localeCompare(b.name, 'es', { numeric: true }) ||
        a.deckId.localeCompare(b.deckId, 'en', { numeric: true }),
    )
    .slice(0, options.limit ?? 3)
}
