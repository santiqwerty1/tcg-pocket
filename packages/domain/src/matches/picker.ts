/**
 * Helpers of the quick-entry sheet (PLAN §3.6): which decks to offer first and which deck revision a match belongs
 * to.
 */

export interface PickerDeckInput {
  id: string
  name: string
  builtInGame: boolean
  archived: boolean
  lastPlayedAt: Date | null
}

/**
 * Deck order for the picker: decks played before, most recent first; then the ones built in the game; then the rest
 * by name. Archived decks are left out (they can still be chosen when editing a match).
 */
export function orderDecksForPicker<T extends PickerDeckInput>(decks: readonly T[]): T[] {
  const rank = (deck: T) => (deck.lastPlayedAt ? 0 : deck.builtInGame ? 1 : 2)
  return decks
    .filter((deck) => !deck.archived)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.lastPlayedAt?.getTime() ?? 0) - (a.lastPlayedAt?.getTime() ?? 0) ||
        // Numeric collation: «2. …» before «10. …» (the 40 decks are numbered).
        a.name.localeCompare(b.name, 'es', { numeric: true }) ||
        a.id.localeCompare(b.id, 'en', { numeric: true }),
    )
}

export interface RevisionStamp {
  number: number
  createdAt: Date
}

/**
 * The revision that was current when the match was played: the newest one created at or before `playedAt`. A match
 * dated before the deck existed in the app (logged after the fact) belongs to the first revision.
 */
export function revisionAt<T extends RevisionStamp>(revisions: readonly T[], playedAt: Date): T {
  if (revisions.length === 0) throw new RangeError('a deck always has at least one revision')
  const sorted = [...revisions].sort((a, b) => a.number - b.number)
  let current = sorted[0] as T
  for (const revision of sorted) {
    if (revision.createdAt.getTime() <= playedAt.getTime()) current = revision
  }
  return current
}
