/**
 * Laboratorio de mazos (T-008): the meta bank («banco del meta»), the standard rival of every test. The N most played
 * archetypes of the era, each played by its representative list (the same pick as a deck's «versión de torneo»: the
 * repeated list with the best lower bound, else the most played), weighted by its share of the era's lists. A list
 * the engine cannot play gives way to the next list of its archetype; an archetype with none playable is skipped and
 * the next archetype takes its place. T-017 D3: the `secondLists` most played archetypes also bring their next playable
 * list, and the archetype's weight is split between its two lists by how often each was played, so a tech that only
 * beats one exact list of a big archetype is not rewarded for the whole archetype.
 */
import { opponentKey } from '../matches/opponents.js'
import { rankArchetypeLists } from '../tournaments/buildable.js'
import type { TournamentDataset } from '../tournaments/dataset.js'
import { archetypeRows, entriesOfList, type ListRow, listRows, mostCommonEnergies } from '../tournaments/stats.js'

export const GAUNTLET_SIZES = [5, 10, 15, 20] as const
/** Santi chose 15 on 8/10/2026 (D-018): about 60 % of the era's lists. */
export const DEFAULT_GAUNTLET_SIZE = 15
export const MAX_GAUNTLET_SIZE = 20
/** Lists of an archetype tried before skipping it. */
const LISTS_TRIED = 3
/** T-017 D3: what the Laboratorio asks for (the 3 most played archetypes are ~37 % of the bank in B4a). */
export const DEFAULT_SECOND_LISTS = 3

/**
 * Second lists for a bank of `size` archetypes: 3 from 10 on (the bank in use is 15); none in the small banks of quick
 * tests, where three more rivals would be 60 % more games.
 */
export function secondListsFor(size: number): number {
  return size >= 10 ? DEFAULT_SECOND_LISTS : 0
}

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
  /** T-017 D3: this is the archetype's second list in the bank. */
  second: boolean
  /** Its part of the archetype's weight (1 when the archetype has one list in the bank). */
  part: number
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

export function metaGauntlet(dataset: TournamentDataset, options: GauntletOptions = {}): Gauntlet {
  const size = Math.min(MAX_GAUNTLET_SIZE, Math.max(1, Math.round(options.size ?? DEFAULT_GAUNTLET_SIZE)))
  const candidates = archetypeRows(dataset).flatMap((row) =>
    row.archetype
      ? [{ id: row.archetype.id, name: row.archetype.name, share: row.share, lists: row.lists, weight: row.share }]
      : [],
  )
  return gauntletOf(dataset, candidates, { ...options, size })
}

export interface GauntletOptions {
  size?: number | undefined
  check?: GauntletCheck | undefined
  secondLists?: number | undefined
}

/** T-017 D4: an archetype of the era to measure against, with its weight (any scale: the bank normalizes it). */
export interface GauntletTarget {
  archetypeId: string
  weight: number
}

/**
 * T-017 D4: a bank of chosen archetypes with chosen weights instead of the era's most played: one archetype to tune a
 * deck against, or the rivals of the owner's own matches («mi meta»). Each is played by its representative list, as in
 * `metaGauntlet` (a list the engine cannot play gives way to the next; an archetype with none is skipped), and the
 * first `secondLists` bring their next list too (D3).
 */
export function customGauntlet(
  dataset: TournamentDataset,
  targets: readonly GauntletTarget[],
  options: GauntletOptions = {},
): Gauntlet {
  const rows = new Map(
    archetypeRows(dataset).flatMap((row) => (row.archetype ? [[row.archetype.id, row] as const] : [])),
  )
  const seen = new Set<string>()
  const candidates = targets.flatMap((target) => {
    const row = rows.get(target.archetypeId)
    if (!row?.archetype || target.weight <= 0 || seen.has(target.archetypeId)) return []
    seen.add(target.archetypeId)
    const { id, name } = row.archetype
    return [{ id, name, share: row.share, lists: row.lists, weight: target.weight }]
  })
  const size = Math.min(MAX_GAUNTLET_SIZE, Math.max(1, Math.round(options.size ?? candidates.length)))
  return gauntletOf(dataset, candidates, { ...options, size })
}

interface Candidate {
  id: string
  name: string
  /** The archetype's share of the era's lists (0–100). */
  share: number
  lists: number
  /** What it weighs in the bank before normalizing: its share for the meta, the target's weight otherwise. */
  weight: number
}

/** The bank: candidates in order until `size` are taken, their representative lists, second lists, weights. */
function gauntletOf(
  dataset: TournamentDataset,
  candidates: readonly Candidate[],
  options: GauntletOptions & { size: number },
): Gauntlet {
  const byArchetype = new Map<string, ListRow[]>()
  for (const row of listRows(dataset, 'group')) {
    if (row.archetypeId === null) continue
    const bucket = byArchetype.get(row.archetypeId)
    if (bucket) bucket.push(row)
    else byArchetype.set(row.archetypeId, [row])
  }
  const rivals: GauntletRival[] = []
  const skipped: GauntletSkip[] = []
  const raw = new Map<string, number>()
  for (const candidate of candidates) {
    if (rivals.length >= options.size) break
    const { id, name } = candidate
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
          share: candidate.share,
          weight: 0,
          archetypeLists: candidate.lists,
          list,
          energies,
          rank,
          second: false,
          part: 1,
        })
        raw.set(id, candidate.weight)
        taken = true
        break
      }
      reason ??= problem
    }
    if (!taken) {
      skipped.push({
        archetypeId: id,
        archetypeName: name,
        share: candidate.share,
        reason: reason ?? 'ninguna lista completa en el catálogo',
      })
    }
  }
  const coverage = rivals.reduce((sum, rival) => sum + rival.share, 0)
  // T-017 D3: the first archetypes bring their next playable list, right after the first one.
  const seconds = Math.max(0, Math.round(options.secondLists ?? 0))
  const withSeconds: GauntletRival[] = []
  for (const [at, rival] of rivals.entries()) {
    withSeconds.push(rival)
    if (at >= seconds) continue
    const ranked = rankArchetypeLists(byArchetype.get(rival.archetypeId) ?? []).slice(0, LISTS_TRIED + 2)
    for (const [rank, list] of ranked.entries()) {
      if (list.key === rival.list.key) continue
      const energies = mostCommonEnergies(entriesOfList(dataset, list.key, 'group'))
      if ((options.check?.(list, energies) ?? null) !== null) continue
      const total = rival.list.lists + list.lists
      const second: GauntletRival = { ...rival, list, energies, rank, second: true, part: list.lists / total }
      rival.part = rival.list.lists / total
      withSeconds.push(second)
      break
    }
  }
  const total = [...raw.values()].reduce((sum, weight) => sum + weight, 0)
  for (const rival of withSeconds) {
    rival.weight = total === 0 ? 0 : ((raw.get(rival.archetypeId) ?? 0) * rival.part) / total
  }
  return { rivals: withSeconds, skipped, coverage, lists: dataset.entries.length }
}

/** T-017 D4: what a bank measures against — the era's most played, the owner's own rivals, or one archetype. */
export type LabObjective =
  | { kind: 'meta' }
  | { kind: 'mine'; halfLifeDays?: number | undefined }
  | { kind: 'rival'; archetypeId: string }

/** «Mi meta»: a match from `halfLifeDays` ago weighs half as much as one from today. */
export const MY_META_HALF_LIFE_DAYS = 14

export interface MyMetaTargets {
  /** The era's archetypes the owner's matches were against, heaviest first. */
  targets: (GauntletTarget & { matches: number })[]
  /** Matches whose rival, as typed, is an archetype of the era. */
  matched: number
  /** The rest: no rival typed, or one that is not an archetype's name (the autocomplete offers those). */
  unmatched: number
  /** The most frequent rivals that matched no archetype, as typed (up to 5). */
  unmatchedNames: string[]
}

/**
 * T-017 D4 (and fase 44, «mi meta»): the era's archetypes the owner's matches were against, each match weighing
 * ½^(days ago / `halfLifeDays`). A match counts when its rival, as typed, is an archetype's name (`opponentKey`, the
 * same key the match statistics group by).
 */
export function myMetaTargets(
  dataset: TournamentDataset,
  matches: readonly { opponent: string | null; playedAt: Date }[],
  options: { now: Date; halfLifeDays?: number | undefined },
): MyMetaTargets {
  const halfLife = Math.max(1, options.halfLifeDays ?? MY_META_HALF_LIFE_DAYS)
  const byKey = new Map<string, string>()
  for (const row of archetypeRows(dataset)) {
    const key = opponentKey(row.archetype?.name)
    if (key && row.archetype && !byKey.has(key)) byKey.set(key, row.archetype.id)
  }
  const weights = new Map<string, { weight: number; matches: number }>()
  const missing = new Map<string, number>()
  let unmatched = 0
  for (const match of matches) {
    const key = opponentKey(match.opponent)
    const id = key ? byKey.get(key) : undefined
    if (!id) {
      unmatched += 1
      const name = match.opponent?.trim()
      if (name) missing.set(name, (missing.get(name) ?? 0) + 1)
      continue
    }
    const days = Math.max(0, (options.now.getTime() - match.playedAt.getTime()) / 86_400_000)
    const item = weights.get(id) ?? { weight: 0, matches: 0 }
    item.weight += 0.5 ** (days / halfLife)
    item.matches += 1
    weights.set(id, item)
  }
  const targets = [...weights]
    .map(([archetypeId, item]) => ({ archetypeId, weight: item.weight, matches: item.matches }))
    .sort((a, b) => b.weight - a.weight || b.matches - a.matches || a.archetypeId.localeCompare(b.archetypeId))
  const unmatchedNames = [...missing]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name]) => name)
  return { targets, matched: matches.length - unmatched, unmatched, unmatchedNames }
}
