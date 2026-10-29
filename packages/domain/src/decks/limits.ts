/**
 * The game holds at most 30 built decks at a time (BRIEF §2, I8; it was 25 until 29/10/2026); the app may store
 * more. Archived decks do not count against the limit.
 */

export const MAX_BUILT_IN_GAME = 30

export interface BuiltInGameDeck {
  id: string
  builtInGame: boolean
  archivedAt?: Date | string | null | undefined
}

export interface BuiltInGameCheck {
  ok: boolean
  /** Non-archived decks currently marked as built, excluding `deckId`. */
  built: number
  max: number
  /** Spanish reason when `ok` is false. */
  message: string | null
}

export function isArchived(deck: Pick<BuiltInGameDeck, 'archivedAt'>): boolean {
  return deck.archivedAt !== undefined && deck.archivedAt !== null
}

/** Decks marked as built in the game that are not archived. */
export function countBuiltInGame(decks: readonly BuiltInGameDeck[]): number {
  return decks.filter((d) => d.builtInGame && !isArchived(d)).length
}

/** Whether `deckId` can be marked as built in the game given the other decks. Already-built decks pass. */
export function canMarkBuiltInGame(decks: readonly BuiltInGameDeck[], deckId: string): BuiltInGameCheck {
  const others = decks.filter((d) => d.id !== deckId)
  const built = countBuiltInGame(others)
  if (built < MAX_BUILT_IN_GAME) return { ok: true, built, max: MAX_BUILT_IN_GAME, message: null }
  return {
    ok: false,
    built,
    max: MAX_BUILT_IN_GAME,
    message: `Ya hay ${built} mazos armados en el juego (máximo ${MAX_BUILT_IN_GAME}); desarmá o archivá uno antes`,
  }
}
