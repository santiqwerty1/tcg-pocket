/**
 * What an import writes to the settings of Sobres: the pack points saved per expansion (`packPoints`, S-002) and the
 * pack hourglasses in stock (`hourglasses`, Fase 14: one hour of a pack each, 12 a pack). Both are the same thing the
 * game counts, so the import replaces them — except a value Santi changed by hand after pokemon-zone read the game
 * (review of pz/import): that one is newer than the import's, so it stays, and the import says so.
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

/** An expansion whose points stay as Santi left them by hand, and what the game said. */
export interface PackPointsKept {
  expansionId: string
  value: number
  game: number
}

export interface PackPointsUpdate {
  /** The setting after the import: every expansion the game lists takes its value (0 removes it), but the kept ones. */
  next: Record<string, number>
  /** Expansions whose points change, in the game's order. */
  changes: PackPointsChange[]
  /** Expansions the game lists with the same points as now. */
  unchanged: number
  /** Expansions changed by hand after the read whose points stay (they differ from the game's). */
  kept: PackPointsKept[]
  /**
   * The setting as the game has it (`next` with the game's points where they were kept): what the import records as
   * applied, so a value kept by hand still reads as «changed by hand» afterwards.
   */
  game: Record<string, number>
}

/** Own keys only: the ids are checked by the payload's schema; this is belt and braces. */
const pointsOf = (points: Readonly<Record<string, number>>, key: string): number =>
  Object.hasOwn(points, key) ? (points[key] ?? 0) : 0

/**
 * The `packPoints` setting after an import. Expansions the game does not list keep what they have (nothing says they
 * changed); 0 is not stored, as the settings screen does. Expansions in `handEdited` (changed by hand after the read)
 * keep their points.
 */
export function packPointsUpdate(
  current: Readonly<Record<string, number>>,
  snapshot: Pick<PokemonZoneSnapshot, 'packPoints'>,
  handEdited: ReadonlySet<string> = new Set(),
): PackPointsUpdate {
  const next: Record<string, number> = { ...current }
  const game: Record<string, number> = { ...current }
  const changes: PackPointsChange[] = []
  const kept: PackPointsKept[] = []
  let unchanged = 0
  for (const [expansionId, value] of Object.entries(snapshot.packPoints)) {
    const after = Math.min(PACK_POINTS_MAX, Math.max(0, Math.trunc(value)))
    const before = pointsOf(current, expansionId)
    if (after > 0) game[expansionId] = after
    else delete game[expansionId]
    if (after === before) {
      unchanged += 1
      continue
    }
    if (handEdited.has(expansionId)) {
      kept.push({ expansionId, value: before, game: after })
      continue
    }
    if (after > 0) next[expansionId] = after
    else delete next[expansionId]
    changes.push({ expansionId, before, after })
  }
  return { next, changes, unchanged, kept, game }
}

/**
 * The expansions whose points were changed by hand after the read: the setting was written after it (`editedAfter`)
 * and differs, there, from what the last import recorded (`applied`; with none, every expansion with points).
 */
export function handEditedPoints(
  current: Readonly<Record<string, number>>,
  applied: Readonly<Record<string, number>> | undefined,
  editedAfter: boolean,
): Set<string> {
  const edited = new Set<string>()
  if (!editedAfter) return edited
  for (const key of new Set([...Object.keys(current), ...Object.keys(applied ?? {})])) {
    if (applied === undefined ? pointsOf(current, key) > 0 : pointsOf(current, key) !== pointsOf(applied, key))
      edited.add(key)
  }
  return edited
}

export interface HourglassesUpdate {
  before: number
  after: number
  /** What the game said. */
  game: number
  /** Changed by hand after the read and different from the game's: the setting stays (`after` = `before`). */
  kept: boolean
}

/**
 * The `hourglasses` setting after an import; null when the game did not give the pack hourglasses. With `handEdited`
 * (changed by hand after the read) the value stays.
 */
export function hourglassesUpdate(
  current: number,
  snapshot: Pick<PokemonZoneSnapshot, 'hourglasses'>,
  handEdited = false,
): HourglassesUpdate | null {
  const pack = snapshot.hourglasses.pack
  if (pack === null) return null
  const game = Math.min(HOURGLASSES_MAX, Math.max(0, Math.trunc(pack)))
  if (handEdited && current !== game) return { before: current, after: current, game, kept: true }
  return { before: current, after: game, game, kept: false }
}

/** Two `packPoints` settings hold the same points (0 and absent are the same). */
export function samePackPoints(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (pointsOf(a, key) !== pointsOf(b, key)) return false
  return true
}
