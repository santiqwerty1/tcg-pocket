/**
 * Fase 44: «¿Qué mazo armo después?» (T-014). For each archetype of the era, the exact tournament list closest to
 * the collection (fewest copies missing, then the most played), with what it costs to finish — pack points of the
 * cheapest print of each missing card, and how many copies could be traded instead — and how the archetype does in
 * tournaments. Ranked by the archetype's rate at the low end of its interval (an archetype with few lists does not
 * jump ahead on luck), then by the copies missing. Archetypes the owner already has a deck of go last.
 */
import type { CardId } from '../catalog/types.js'
import { type ListAgainstCollection, listsAgainstCollection, type MissingCopies } from './buildable.js'
import type { TournamentDataset } from './dataset.js'
import { entriesOfArchetype, type RecordRow, recordOf } from './stats.js'

/** Copies missing above which a list is not «close». */
export const NEXT_BUILD_MAX_MISSING = 8
/** Lists of an archetype below which its rate is too thin to rank by. */
export const NEXT_BUILD_MIN_LISTS = 10

export interface NextBuildCost {
  /** Pack points of the cheapest print; null when no print can be bought with points. */
  points: number | null
  tradeable: boolean
}

export interface NextBuildRow {
  archetypeId: string
  /** The archetype's tournament record and rate (every list of it). */
  archetype: RecordRow
  /** The closest list of the archetype, with what the collection lacks. */
  closest: ListAgainstCollection
  /** Points for every missing copy; null when some copy cannot be bought with points (`unpriced`). */
  points: number | null
  unpriced: number
  /** Missing copies of a card that can be traded. */
  tradeable: number
  /** The owner already has a deck of this archetype. */
  built: boolean
}

export function nextBuilds(
  dataset: TournamentDataset,
  options: {
    playable: (groupId: CardId) => number
    cost: (groupId: CardId) => NextBuildCost | null
    built: (archetypeId: string) => boolean
    maxMissing?: number
    minLists?: number
  },
): NextBuildRow[] {
  const maxMissing = options.maxMissing ?? NEXT_BUILD_MAX_MISSING
  const minLists = options.minLists ?? NEXT_BUILD_MIN_LISTS
  const best = new Map<string, ListAgainstCollection>()
  for (const row of listsAgainstCollection(dataset, options.playable)) {
    const id = row.list.archetypeId
    if (id === null || row.missingCopies > maxMissing) continue
    const current = best.get(id)
    if (
      !current ||
      row.missingCopies < current.missingCopies ||
      (row.missingCopies === current.missingCopies && row.list.lists > current.list.lists)
    ) {
      best.set(id, row)
    }
  }
  const rows: NextBuildRow[] = []
  for (const [archetypeId, closest] of best) {
    const archetype = recordOf(dataset, entriesOfArchetype(dataset, archetypeId))
    if (archetype.lists < minLists || !archetype.rate) continue
    let points: number | null = 0
    let unpriced = 0
    let tradeable = 0
    for (const item of closest.missing as MissingCopies[]) {
      const copies = item.need - item.have
      const cost = options.cost(item.groupId)
      if (cost?.points == null) {
        unpriced += copies
        points = null
      } else if (points !== null) {
        points += cost.points * copies
      }
      if (cost?.tradeable) tradeable += copies
    }
    rows.push({ archetypeId, archetype, closest, points, unpriced, tradeable, built: options.built(archetypeId) })
  }
  return rows.sort(
    (a, b) =>
      Number(a.built) - Number(b.built) ||
      (b.archetype.rate?.ci95[0] ?? 0) - (a.archetype.rate?.ci95[0] ?? 0) ||
      a.closest.missingCopies - b.closest.missingCopies ||
      a.archetypeId.localeCompare(b.archetypeId),
  )
}
