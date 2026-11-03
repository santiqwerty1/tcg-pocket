/**
 * What an import writes to the settings of Sobres: the pack points saved per expansion (`packPoints`, S-002) and the
 * pack hourglasses in stock (`hourglasses`, Fase 14: one hour of a pack each, 12 a pack). Both are the same thing the
 * game counts, so the import replaces them; Santi can still edit them by hand afterwards.
 */
import type { PokemonZoneSnapshot } from './payload.js'

/** The settings' bounds (`packPoints` values and `hourglasses`, apps/api packs.service.ts). */
export const PACK_POINTS_MAX = 1_000_000
export const HOURGLASSES_MAX = 100_000

export interface PackPointsChange {
  expansionId: string
  before: number
  after: number
}

export interface PackPointsUpdate {
  /** The setting after the import: every expansion the game lists takes its value (0 removes it). */
  next: Record<string, number>
  /** Expansions whose points change, in the game's order. */
  changes: PackPointsChange[]
  /** Expansions the game lists with the same points as now. */
  unchanged: number
}

/**
 * The `packPoints` setting after an import. Expansions the game does not list keep what they have (nothing says they
 * changed); 0 is not stored, as the settings screen does.
 */
export function packPointsUpdate(
  current: Readonly<Record<string, number>>,
  snapshot: Pick<PokemonZoneSnapshot, 'packPoints'>,
): PackPointsUpdate {
  const next: Record<string, number> = { ...current }
  const changes: PackPointsChange[] = []
  let unchanged = 0
  for (const [expansionId, value] of Object.entries(snapshot.packPoints)) {
    const after = Math.min(PACK_POINTS_MAX, Math.max(0, Math.trunc(value)))
    // Own keys only (the ids are checked by the payload's schema; this is belt and braces).
    const before = Object.hasOwn(current, expansionId) ? (current[expansionId] ?? 0) : 0
    if (after > 0) next[expansionId] = after
    else delete next[expansionId]
    if (after === before) unchanged += 1
    else changes.push({ expansionId, before, after })
  }
  return { next, changes, unchanged }
}

export interface HourglassesUpdate {
  before: number
  after: number
}

/** The `hourglasses` setting after an import; null when the game did not give the pack hourglasses. */
export function hourglassesUpdate(
  current: number,
  snapshot: Pick<PokemonZoneSnapshot, 'hourglasses'>,
): HourglassesUpdate | null {
  const pack = snapshot.hourglasses.pack
  if (pack === null) return null
  return { before: current, after: Math.min(HOURGLASSES_MAX, Math.max(0, Math.trunc(pack))) }
}

/** Two `packPoints` settings hold the same points (0 and absent are the same). */
export function samePackPoints(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const value = (points: Readonly<Record<string, number>>, key: string) =>
    Object.hasOwn(points, key) ? (points[key] ?? 0) : 0
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (value(a, key) !== value(b, key)) return false
  return true
}
