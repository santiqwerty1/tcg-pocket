/**
 * Difference between two drafts, as recorded between `DeckRevision`s (PLAN §3.3). Entries are aggregated by
 * card id; a swap of edition inside the same functional group (B1-36 → B1-284) is an `editionChanged`, not a
 * removal plus an addition.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId, SelectableEnergy } from '../catalog/types.js'
import { aggregateEntries, type DeckCardEntry, type DeckDraft } from './types.js'

export interface CountChange {
  cardId: CardId
  from: number
  to: number
}

export interface EditionChange {
  groupId: CardId
  from: CardId
  to: CardId
  fromCount: number
  toCount: number
}

export interface EnergiesChange {
  from: SelectableEnergy[]
  to: SelectableEnergy[]
}

export interface DeckDiff {
  added: DeckCardEntry[]
  removed: DeckCardEntry[]
  countChanged: CountChange[]
  editionChanged: EditionChange[]
  /** Null when the energy selection is the same set. */
  energies: EnergiesChange | null
  /** False when cards and energies are identical. */
  changed: boolean
}

function sameEnergies(a: readonly SelectableEnergy[], b: readonly SelectableEnergy[]): boolean {
  const sa = [...new Set(a)].sort()
  const sb = [...new Set(b)].sort()
  return sa.length === sb.length && sa.every((e, i) => e === sb[i])
}

export function diffDeckDrafts(a: DeckDraft, b: DeckDraft, index: CatalogIndex): DeckDiff {
  const before = new Map(aggregateEntries(a.cards).map((e) => [e.cardId, e.count]))
  const after = new Map(aggregateEntries(b.cards).map((e) => [e.cardId, e.count]))
  const countChanged: CountChange[] = []
  const removedById = new Map<CardId, number>()
  const addedById = new Map<CardId, number>()
  for (const [cardId, from] of before) {
    const to = after.get(cardId)
    if (to === undefined) removedById.set(cardId, from)
    else if (to !== from) countChanged.push({ cardId, from, to })
  }
  for (const [cardId, to] of after) {
    if (!before.has(cardId)) addedById.set(cardId, to)
  }

  // Pair removals with additions inside the same functional group.
  const editionChanged: EditionChange[] = []
  const groupOf = (cardId: CardId): CardId => index.cardById(cardId)?.functionalGroupId ?? cardId
  for (const [fromId, fromCount] of [...removedById]) {
    const groupId = groupOf(fromId)
    const match = [...addedById].find(([toId]) => groupOf(toId) === groupId)
    if (!match) continue
    const [toId, toCount] = match
    editionChanged.push({ groupId, from: fromId, to: toId, fromCount, toCount })
    removedById.delete(fromId)
    addedById.delete(toId)
  }

  const added = [...addedById].map(([cardId, count]) => ({ cardId, count }))
  const removed = [...removedById].map(([cardId, count]) => ({ cardId, count }))
  const energies = sameEnergies(a.energies, b.energies) ? null : { from: [...a.energies], to: [...b.energies] }
  const changed =
    added.length > 0 || removed.length > 0 || countChanged.length > 0 || editionChanged.length > 0 || energies !== null
  return { added, removed, countChanged, editionChanged, energies, changed }
}
