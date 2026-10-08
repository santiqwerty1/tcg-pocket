/**
 * Laboratorio de mazos (T-008): the meta bank («banco del meta»), the standard rival of every test. The N most played
 * archetypes of the era, each played by its representative list (the same pick as a deck's «versión de torneo»: the
 * repeated list with the best lower bound, else the most played), weighted by its share of the era's lists. A list
 * the engine cannot play gives way to the next list of its archetype; an archetype with none playable is skipped and
 * the next archetype takes its place.
 */
import { rankArchetypeLists } from '../tournaments/buildable.js'
import type { TournamentDataset } from '../tournaments/dataset.js'
import { archetypeRows, entriesOfList, type ListRow, listRows, mostCommonEnergies } from '../tournaments/stats.js'

export const GAUNTLET_SIZES = [5, 10, 15, 20] as const
export const DEFAULT_GAUNTLET_SIZE = 10
export const MAX_GAUNTLET_SIZE = 20
/** Lists of an archetype tried before skipping it. */
const LISTS_TRIED = 3

export interface GauntletRival {
  archetypeId: string
  archetypeName: string
  /** The archetype's share of the era's lists (0–100). */
  share: number
  /** Share normalized over the bank: the weights add up to 1. */
  weight: number
  /** Lists of the archetype in the era. */
  archetypeLists: number
  list: ListRow
  /** Energies most entries of the list declare (empty in NOEX lists). */
  energies: string[]
  /** 0 = the archetype's representative list; 1–2 = a later one because the earlier ones could not be played. */
  rank: number
}

export interface GauntletSkip {
  archetypeId: string
  archetypeName: string
  share: number
  reason: string
}

export interface Gauntlet {
  rivals: GauntletRival[]
  skipped: GauntletSkip[]
  /** Share of the era's lists the bank's archetypes stand for (0–100). */
  coverage: number
  /** Lists of the era. */
  lists: number
}

/** Why a list cannot be in the bank (the engine cannot play it), or null when it can. */
export type GauntletCheck = (list: ListRow, energies: string[]) => string | null

export function metaGauntlet(
  dataset: TournamentDataset,
  options: { size?: number | undefined; check?: GauntletCheck | undefined } = {},
): Gauntlet {
  const size = Math.min(MAX_GAUNTLET_SIZE, Math.max(1, Math.round(options.size ?? DEFAULT_GAUNTLET_SIZE)))
  const byArchetype = new Map<string, ListRow[]>()
  for (const row of listRows(dataset, 'group')) {
    if (row.archetypeId === null) continue
    const bucket = byArchetype.get(row.archetypeId)
    if (bucket) bucket.push(row)
    else byArchetype.set(row.archetypeId, [row])
  }
  const rivals: GauntletRival[] = []
  const skipped: GauntletSkip[] = []
  for (const archetype of archetypeRows(dataset)) {
    if (rivals.length >= size) break
    if (!archetype.archetype) continue
    const { id, name } = archetype.archetype
    const ranked = rankArchetypeLists(byArchetype.get(id) ?? []).slice(0, LISTS_TRIED)
    let reason: string | null = null
    let taken = false
    for (const [rank, list] of ranked.entries()) {
      const energies = mostCommonEnergies(entriesOfList(dataset, list.key, 'group'))
      const problem = options.check?.(list, energies) ?? null
      if (problem === null) {
        rivals.push({
          archetypeId: id,
          archetypeName: name,
          share: archetype.share,
          weight: 0,
          archetypeLists: archetype.lists,
          list,
          energies,
          rank,
        })
        taken = true
        break
      }
      reason ??= problem
    }
    if (!taken) {
      skipped.push({
        archetypeId: id,
        archetypeName: name,
        share: archetype.share,
        reason: reason ?? 'ninguna lista completa en el catálogo',
      })
    }
  }
  const coverage = rivals.reduce((sum, rival) => sum + rival.share, 0)
  for (const rival of rivals) rival.weight = coverage === 0 ? 0 : rival.share / coverage
  return { rivals, skipped, coverage, lists: dataset.entries.length }
}
