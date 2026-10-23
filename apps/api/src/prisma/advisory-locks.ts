/**
 * Every `pg_advisory_*lock` key of the API, in one place (T-020, Codex on #150: ptcgpocket.gg's sync had taken the
 * catalog sync's key). A new lock gets a key that is not here, and goes here; `advisory-locks.spec.ts` fails if two
 * keys coincide or if a key used in the code is missing from this list.
 *
 * Postgres keeps the one-key (bigint) and the two-key (int, int) spaces apart, so they are listed apart.
 */
export const ADVISORY_LOCKS = {
  /** A tracker read or apply in flight (collection/tracker-sync.service.ts, session lock). */
  trackerSync: 994_201,
  /** Collection writes and the sources' configuration (link, friend id, switches): imports, settings, snapshots. */
  collectionConfig: 994_202,
  /** Claiming a catalog sync across processes (catalog/catalog-sync.service.ts). */
  catalogSyncBegin: 994_203,
  /** A ptcgpocket.gg read or apply in flight (collection/dotgg-sync.service.ts, session lock). */
  dotggSync: 994_204,
  /** Deck writes (decks/decks.service.ts). */
  deckWrites: 1001,
  /** The chat's inserts, import and moves (chat/chat-locks.ts). */
  chatWrite: 20_261_009,
  /** The lab's meta-bank refresh (lab/lab.service.ts, session lock). */
  labRefresh: 43_031,
  /** Rank notes (ranked/ranked.service.ts, backup restore). */
  rankNote: 43_120,
} as const

/** Two-key locks: the first key names the lock, the second the row (a rival's key, a token id). */
export const ADVISORY_PAIR_LOCKS = {
  /** Notes by rival (rivals/rival-notes.service.ts, matches). */
  rivalNote: 43_012,
  /** A token's clients (tokens/tokens.service.ts). */
  tokenClients: 43_020,
} as const
