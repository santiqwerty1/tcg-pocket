/**
 * Armar desde un núcleo (Fase 19): a first list around 1–4 cards the owner wants to play together. The rest comes
 * from what the era's tournament lists that play those cards together also play (most played first, at the number of
 * copies they usually play), with each evolution's line, only cards that can be played (the engine plays them, the
 * collection has them when asked) and Pokémon whose attacks the energies can pay. When no list plays the whole core,
 * the lists that play any of it; when none does, what the era plays. The draft is the starting point of a test or a
 * search in the Laboratorio, not a finished deck.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, SelectableEnergy } from '../catalog/types.js'
import { SELECTABLE_ENERGIES } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { validateDeck } from '../decks/validate.js'
import { suggestEnergies } from '../simulation/snapshot.js'
import type { DatasetEntry, TournamentDataset } from '../tournaments/dataset.js'
import { cardUsage } from '../tournaments/stats.js'
import { usableWith } from './mutate.js'

/** Lists playing the whole core below which the builder also looks at lists that play part of it. */
export const CORE_MIN_LISTS = 3
const DECK_SIZE = 20
const RARE_CANDY = 'Rare Candy'

export interface CoreBuildInput {
  dataset: TournamentDataset
  index: CatalogIndex
  /** Functional cards of the core (1–4). */
  core: readonly CardId[]
  /** The edition to play for a functional card, or null when it cannot be played (engine, collection). */
  edition: (groupId: CardId) => CardEdition | null
  /** Copies available: 2, or the collection's playable copies. */
  maxCopies: (groupId: CardId) => number
  /** Energies; by default the ones the core's attacks cost. */
  energies?: readonly SelectableEnergy[] | undefined
}

export interface CorePick {
  groupId: CardId
  cardId: CardId
  copies: number
  /** Share (0–100) of the basis lists that play it; null for the core and its lines. */
  share: number | null
  reason: 'core' | 'line' | 'usage'
}

export interface CoreBuild {
  cards: DeckCardEntry[]
  energies: SelectableEnergy[]
  /** Which lists the rest came from. */
  basis: { kind: 'together' | 'partial' | 'era'; lists: number }
  picks: CorePick[]
  /** Core cards that could not go in, and why. */
  left: { groupId: CardId; reason: 'unplayable' | 'not_owned' }[]
  /** Errors of the draft as a deck (empty = it validates). */
  problems: string[]
}

export function buildFromCore(input: CoreBuildInput): CoreBuild {
  const { dataset, index } = input
  const core = [...new Set(input.core)]
  const left: CoreBuild['left'] = []
  const picks: CorePick[] = []
  const counts = new Map<CardId, number>()
  const nameCount = (nameEn: string) =>
    picks.reduce((sum, pick) => sum + (index.cardById(pick.cardId)?.nameEn === nameEn ? pick.copies : 0), 0)
  const total = () => picks.reduce((sum, pick) => sum + pick.copies, 0)

  const add = (groupId: CardId, copies: number, share: number | null, reason: CorePick['reason']): number => {
    const card = input.edition(groupId)
    if (!card) return 0
    const room = Math.min(
      copies,
      input.maxCopies(groupId) - (counts.get(groupId) ?? 0),
      2 - nameCount(card.nameEn),
      DECK_SIZE - total(),
    )
    if (room <= 0) return 0
    const existing = picks.find((pick) => pick.groupId === groupId)
    if (existing) existing.copies += room
    else picks.push({ groupId, cardId: card.id, copies: room, share, reason })
    counts.set(groupId, (counts.get(groupId) ?? 0) + room)
    return room
  }

  /** The groups named `nameEn` that can be played, most played first (pre-evolutions, Rare Candy). */
  const usage = new Map(cardUsage(dataset.entries).map((row) => [row.groupId, row.share]))
  const lineGroups = (nameEn: string): CardId[] =>
    index
      .groupsByNameEn(nameEn)
      .filter((group) => input.edition(group.id) !== null && input.maxCopies(group.id) > 0)
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0))
      .map((group) => group.id)
  const lineGroup = (nameEn: string): CardId | null => lineGroups(nameEn)[0] ?? null
  /** Copies of a line card by name: the most played group first, the next ones while the collection runs short. */
  const addByName = (nameEn: string, copies: number) => {
    let added = 0
    for (const groupId of lineGroups(nameEn)) {
      if (added >= copies) break
      added += add(groupId, copies - added, null, 'line')
    }
  }

  // Which core cards can go in.
  const playable: CardId[] = []
  for (const groupId of core) {
    if (!input.edition(groupId)) left.push({ groupId, reason: 'unplayable' })
    else if (input.maxCopies(groupId) < 1) left.push({ groupId, reason: 'not_owned' })
    else playable.push(groupId)
  }

  // The basis: lists that play the whole core; else the ones that play part of it; else the era.
  const plays = (entry: DatasetEntry, groupId: CardId) => (entry.groups.get(groupId) ?? 0) > 0
  let basis: DatasetEntry[] = dataset.entries.filter((entry) => playable.every((groupId) => plays(entry, groupId)))
  let kind: CoreBuild['basis']['kind'] = 'together'
  if (playable.length === 0 || basis.length < CORE_MIN_LISTS) {
    const partial = dataset.entries.filter((entry) => playable.some((groupId) => plays(entry, groupId)))
    if (partial.length >= CORE_MIN_LISTS) {
      basis = partial
      kind = 'partial'
    } else {
      basis = dataset.entries
      kind = 'era'
    }
  }

  // Share (0–100) of the basis lists that play a card by name, any edition: decides Stage 1 or Rare Candy.
  const listsByName = new Map<string, number>()
  for (const entry of basis) {
    const names = new Set<string>()
    for (const groupId of entry.groups.keys()) {
      const name = index.groupById(groupId)?.nameEn
      if (name) names.add(name)
    }
    for (const name of names) listsByName.set(name, (listsByName.get(name) ?? 0) + 1)
  }
  const nameShare = (nameEn: string) => (basis.length === 0 ? 0 : ((listsByName.get(nameEn) ?? 0) / basis.length) * 100)
  const candy = lineGroup(RARE_CANDY)
  /** A Stage 1 the basis lists skip: most of them play Rare Candy and fewer than half play that Stage 1. */
  const skipsStage1 = (nameEn: string) =>
    kind !== 'era' && candy !== null && nameShare(RARE_CANDY) >= 50 && nameShare(nameEn) < 50

  /**
   * Adds a card and, before it, its pre-evolutions when the list lacks them (same copies), or Rare Candy instead of
   * the Stage 1 when the basis lists do that.
   */
  const addWithLine = (groupId: CardId, copies: number, share: number | null, reason: CorePick['reason']): number => {
    const card = input.edition(groupId)
    if (!card) return 0
    const line: CardId[] = []
    let needsCandy = false
    let from = card.evolvesFrom
    while (from && nameCount(from) === 0) {
      const pre = lineGroup(from)
      if (!pre) return 0
      const preCard = input.edition(pre)
      if (card.evolutionType === 'stage2' && preCard?.evolutionType === 'stage1' && skipsStage1(from)) needsCandy = true
      else line.unshift(pre)
      from = preCard?.evolvesFrom ?? null
    }
    const candyCopies = needsCandy && nameCount(RARE_CANDY) === 0 ? 2 : 0
    if (total() + copies * (line.length + 1) + candyCopies > DECK_SIZE && reason !== 'core') return 0
    if (candyCopies > 0) addByName(RARE_CANDY, candyCopies)
    for (const pre of line) addByName(index.groupById(pre)?.nameEn ?? pre, copies)
    return add(groupId, copies, share, reason)
  }

  for (const groupId of playable) addWithLine(groupId, 2, null, 'core')

  // Energies: given; else what the core's attacks cost; else the energies the basis lists play most.
  const coreCards = playable.map((groupId) => input.edition(groupId)).filter((card): card is CardEdition => !!card)
  const energies: SelectableEnergy[] =
    input.energies && input.energies.length > 0
      ? [...input.energies]
      : (suggestEnergies(
          coreCards.map((card) => ({ cardId: card.id, count: 1 })),
          index,
        ) ?? commonEnergies(basis))

  const fill = (entries: readonly DatasetEntry[]) => {
    for (const row of cardUsage(entries)) {
      if (total() >= DECK_SIZE) break
      if (counts.has(row.groupId)) continue
      const card = input.edition(row.groupId)
      if (!card || input.maxCopies(row.groupId) < 1 || !usableWith(card, energies)) continue
      const copies = (row.byCopies[2] ?? 0) >= (row.byCopies[1] ?? 0) ? 2 : 1
      addWithLine(row.groupId, copies, row.share, 'usage')
    }
  }
  fill(basis)
  if (total() < DECK_SIZE) fill(dataset.entries)

  const cards = picks.map((pick) => ({ cardId: pick.cardId, count: pick.copies }))
  const validation = validateDeck({ cards, energies }, index)
  return {
    cards,
    energies,
    basis: { kind, lists: basis.length },
    picks,
    left,
    problems: validation.errors.map((issue) => issue.message),
  }
}

/** The energy set the lists play most (only types the Energy Zone generates). */
function commonEnergies(entries: readonly DatasetEntry[]): SelectableEnergy[] {
  const counts = new Map<string, { energies: SelectableEnergy[]; lists: number }>()
  for (const entry of entries) {
    const energies = SELECTABLE_ENERGIES.filter((energy) => entry.energies.includes(energy))
    if (energies.length === 0) continue
    const key = energies.join('|')
    const row = counts.get(key) ?? { energies, lists: 0 }
    row.lists += 1
    counts.set(key, row)
  }
  return [...counts.values()].sort((a, b) => b.lists - a.lists)[0]?.energies ?? []
}
