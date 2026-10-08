/**
 * «Sugerir el mejor reemplazo cuando falta una carta de una lista de torneo» (BRIEF, «más adelante»; PLAN Fase 8).
 * For each card the collection lacks, the cards that can take its place, best first:
 * 1. Another version of the same card (same English name, other text), when the collection has it.
 * 2. What the archetype's lists that play fewer copies of it play more of: the cards whose share rises in the lists
 *    without it (by at least one list) — what players actually put in its place.
 * 3. Otherwise, the cards the archetype plays most that the list does not.
 * Only cards the collection has spare copies of, of the same kind (a trainer for a trainer, a Pokémon for a Pokémon),
 * that keep the list legal (2 per name, an evolution needs its pre-evolution in the list).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId } from '../catalog/types.js'
import type { DatasetEntry, TournamentDataset } from './dataset.js'
import { entriesOfArchetype } from './stats.js'

export interface SubstituteOption {
  groupId: CardId
  /** Why: «misma carta, otra versión», or how the archetype's lists use it. */
  reason: 'same_name' | 'replaces' | 'archetype'
  /** Lists of the archetype without (or with fewer of) the missing card that play this one, and of those lists. */
  lists: number
  of: number
  /** Copies the collection has. */
  have: number
}

export interface MissingWithSubstitutes {
  groupId: CardId
  need: number
  have: number
  options: SubstituteOption[]
}

/** Lists of the archetype that play fewer copies of `groupId` than `need` (where players made do without it). */
function without(entries: readonly DatasetEntry[], groupId: CardId, need: number): DatasetEntry[] {
  return entries.filter((entry) => (entry.groups.get(groupId) ?? 0) < need)
}

function shareOf(entries: readonly DatasetEntry[], groupId: CardId): number {
  if (entries.length === 0) return 0
  return entries.filter((entry) => (entry.groups.get(groupId) ?? 0) > 0).length / entries.length
}

/** A trainer for a trainer, a Pokémon for a Pokémon (a missing supporter is often replaced by an item). */
function sameKind(a: CardEdition, b: CardEdition): boolean {
  return a.cardType === b.cardType
}

/** Display edition of a functional card. */
function editionOf(index: CatalogIndex, groupId: CardId): CardEdition | undefined {
  const group = index.groupById(groupId)
  return group ? index.cardById(group.displayCardId) : undefined
}

/**
 * Substitutes for every card of `groups` (a tournament list, by functional card) the collection lacks. `playable`:
 * copies the collection has per functional card. Up to `limit` options per missing card.
 */
export function substitutesFor(
  dataset: TournamentDataset,
  archetypeId: string | null,
  groups: ReadonlyMap<CardId, number>,
  index: CatalogIndex,
  playable: (groupId: CardId) => number,
  limit = 3,
): MissingWithSubstitutes[] {
  const archetype = entriesOfArchetype(dataset, archetypeId)
  const names = new Map<string, number>()
  for (const [groupId, count] of groups) {
    const name = editionOf(index, groupId)?.nameEn
    if (name) names.set(name, (names.get(name) ?? 0) + count)
  }
  const namesInList = new Set(names.keys())
  const out: MissingWithSubstitutes[] = []
  for (const [groupId, need] of groups) {
    const have = playable(groupId)
    if (have >= need) continue
    const missing = editionOf(index, groupId)
    if (!missing) continue
    const fits = (candidateId: CardId): CardEdition | null => {
      if (candidateId === groupId) return null
      const card = editionOf(index, candidateId)
      if (!card || !sameKind(missing, card)) return null
      const spare = playable(candidateId) - (groups.get(candidateId) ?? 0)
      if (spare < 1) return null
      // Two per name: a missing card freed its own slots.
      const sameNameInList = (names.get(card.nameEn) ?? 0) - (card.nameEn === missing.nameEn ? need : 0)
      if (sameNameInList >= 2) return null
      if (card.cardType === 'pokemon' && card.evolvesFrom && !namesInList.has(card.evolvesFrom)) return null
      return card
    }
    const options: SubstituteOption[] = []
    const taken = new Set<CardId>()
    // 1. Same name, another text (Riolu A2-91 for Riolu B3-79).
    for (const other of index.groupsByNameEn(missing.nameEn)) {
      if (other.id === groupId || !fits(other.id)) continue
      options.push({ groupId: other.id, reason: 'same_name', lists: 0, of: 0, have: playable(other.id) })
      taken.add(other.id)
    }
    // 2. What the lists without it play more of.
    const without_ = without(archetype, groupId, need)
    const withIt = archetype.filter((entry) => (entry.groups.get(groupId) ?? 0) >= need)
    if (without_.length > 0) {
      const candidates = new Set<CardId>()
      for (const entry of without_) for (const candidate of entry.groups.keys()) candidates.add(candidate)
      const ranked = [...candidates]
        .filter((candidate) => !taken.has(candidate) && fits(candidate))
        .map((candidate) => ({
          candidate,
          lists: without_.filter((entry) => (entry.groups.get(candidate) ?? 0) > (groups.get(candidate) ?? 0)).length,
          lift: shareOf(without_, candidate) - shareOf(withIt, candidate),
        }))
        .filter((item) => item.lists > 0 && item.lift > 0)
        .sort((a, b) => b.lift - a.lift || b.lists - a.lists || a.candidate.localeCompare(b.candidate))
      for (const item of ranked) {
        if (options.length >= limit) break
        options.push({
          groupId: item.candidate,
          reason: 'replaces',
          lists: item.lists,
          of: without_.length,
          have: playable(item.candidate),
        })
        taken.add(item.candidate)
      }
    }
    // 3. What the archetype plays most that the list does not.
    if (options.length < limit && archetype.length > 0) {
      const usage = new Map<CardId, number>()
      for (const entry of archetype) {
        for (const candidate of entry.groups.keys()) usage.set(candidate, (usage.get(candidate) ?? 0) + 1)
      }
      const ranked = [...usage]
        .filter(([candidate]) => !groups.has(candidate) && !taken.has(candidate) && fits(candidate))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      for (const [candidate, lists] of ranked) {
        if (options.length >= limit) break
        options.push({
          groupId: candidate,
          reason: 'archetype',
          lists,
          of: archetype.length,
          have: playable(candidate),
        })
      }
    }
    out.push({ groupId, need, have, options: options.slice(0, limit) })
  }
  return out
}
