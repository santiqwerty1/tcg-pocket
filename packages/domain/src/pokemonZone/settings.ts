/**
 * What an import writes to the settings of Sobres: the pack points saved per expansion (`packPoints`, S-002) and the
 * pack hourglasses in stock (`hourglasses`, Fase 14: one hour of a pack each, 12 a pack). Both are the same thing the
 * game counts, so the import replaces them — except a value Santi changed by hand after pokemon-zone read the game
 * (review of pz/import): that one is newer than the import's, so it stays, and the import says so. When each one was
 * changed by hand is kept apart (`HandEdits`), per expansion for the points (Codex on #170: saving one expansion never
 * dates the others).
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
  /** When its points were changed by hand (ISO), after the read. */
  editedAt: string
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
 * changed); 0 is not stored, as the settings screen does. Expansions in `handEdited` (changed by hand after the read,
 * with when: `handEditedAfter`) keep their points.
 */
export function packPointsUpdate(
  current: Readonly<Record<string, number>>,
  snapshot: Pick<PokemonZoneSnapshot, 'packPoints'>,
  handEdited: Readonly<Record<string, string>> = {},
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
    const editedAt = Object.hasOwn(handEdited, expansionId) ? handEdited[expansionId] : undefined
    if (editedAt !== undefined) {
      kept.push({ expansionId, value: before, game: after, editedAt })
      continue
    }
    if (after > 0) next[expansionId] = after
    else delete next[expansionId]
    changes.push({ expansionId, before, after })
  }
  return { next, changes, unchanged, kept, game }
}

/**
 * When Santi last changed each value by hand in Sobres → Ajustes (ISO times; Codex on #170): the points per expansion
 * (a save gives its time only to the expansions whose points it changed), and the pack hourglasses. What an import
 * writes is not a hand edit. A value saved by hand before these times were kept has none: it counts as older than any
 * read.
 */
export interface HandEdits {
  packPoints: Record<string, string>
  hourglasses: string | null
}

const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

/** The stored `HandEdits`, leniently: what is not a time is left out. */
export function parseHandEdits(value: unknown): HandEdits {
  const record = (item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : null
  const stored = record(value)
  const points = record(stored?.packPoints)
  const hourglasses = stored?.hourglasses
  return {
    packPoints: Object.fromEntries(
      Object.entries(points ?? {}).filter((entry): entry is [string, string] => isTime(entry[1])),
    ),
    hourglasses: isTime(hourglasses) ? hourglasses : null,
  }
}

/** After the points are saved by hand at `at`: the expansions whose points changed take that time, the rest keep theirs. */
export function recordPointsEdit(
  edits: HandEdits,
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
  at: Date,
): HandEdits {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => pointsOf(before, key) !== pointsOf(after, key),
  )
  if (changed.length === 0) return edits
  const time = at.toISOString()
  return {
    ...edits,
    packPoints: Object.fromEntries([
      ...Object.entries(edits.packPoints),
      ...changed.map((key): [string, string] => [key, time]),
    ]),
  }
}

/** After the pack hourglasses are saved by hand at `at` (a save that does not change them is not an edit). */
export function recordHourglassesEdit(edits: HandEdits, before: number, after: number, at: Date): HandEdits {
  return before === after ? edits : { ...edits, hourglasses: at.toISOString() }
}

/**
 * What was changed by hand after pokemon-zone read the game (`readAt`, ms): each expansion by its own time, so a later
 * save of another expansion does not make an older one newer than the read.
 */
export function handEditedAfter(
  edits: HandEdits,
  readAt: number,
): { packPoints: Record<string, string>; hourglasses: string | null } {
  const after = (time: string) => Date.parse(time) > readAt
  return {
    packPoints: Object.fromEntries(Object.entries(edits.packPoints).filter(([, time]) => after(time))),
    hourglasses: edits.hourglasses !== null && after(edits.hourglasses) ? edits.hourglasses : null,
  }
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
