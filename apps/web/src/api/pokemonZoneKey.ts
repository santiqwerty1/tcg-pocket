/**
 * The query key of `GET /api/pokemon-zone`, on its own so the settings and the matches can mark it stale without
 * importing the pokemon-zone module (which imports theirs).
 */
export const pokemonZoneKey = ['pokemon-zone'] as const
