import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  archetypeCardsSchema,
  archetypeDetailSchema,
  archetypesResponseSchema,
  buildableResponseSchema,
  deckVersionDetailSchema,
  deckVersionsResponseSchema,
  listDetailSchema,
  listsResponseSchema,
  matchupMatrixSchema,
  metaTrendsSchema,
  setReleaseSchema,
  setReleasesResponseSchema,
  type TournamentFormat,
  tournamentEventsSchema,
  tournamentStatusSchema,
  unknownCardsSchema,
  unlockResponseSchema,
} from './schemas'

export interface TournamentScopeParams {
  era?: string | undefined
  format?: TournamentFormat | undefined
}

export const tournamentKeys = {
  all: ['tournaments'] as const,
  status: ['tournaments', 'status'] as const,
  sets: ['tournaments', 'sets'] as const,
  archetypes: (scope: TournamentScopeParams) => ['tournaments', 'archetypes', scope] as const,
  archetype: (id: string, scope: TournamentScopeParams, card: string | null, minCount: number) =>
    ['tournaments', 'archetype', id, scope, card, minCount] as const,
  archetypeCards: (id: string, scope: TournamentScopeParams) => ['tournaments', 'archetype-cards', id, scope] as const,
  lists: (scope: TournamentScopeParams, kind: 'group' | 'name') => ['tournaments', 'lists', scope, kind] as const,
  list: (key: string, scope: TournamentScopeParams, kind: 'group' | 'name') =>
    ['tournaments', 'list', key, scope, kind] as const,
  buildable: (scope: TournamentScopeParams) => ['tournaments', 'buildable', scope] as const,
  unlock: (scope: TournamentScopeParams) => ['tournaments', 'unlock', scope] as const,
  events: (scope: TournamentScopeParams) => ['tournaments', 'events', scope] as const,
  unknown: (scope: TournamentScopeParams) => ['tournaments', 'unknown', scope] as const,
  matchups: (scope: TournamentScopeParams, top: number) => ['tournaments', 'matchups', scope, top] as const,
  trends: (scope: TournamentScopeParams, days: number) => ['tournaments', 'trends', scope, days] as const,
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** The «versión de torneo» of one deck (current era, Estándar). */
export function useDeckVersion(deckId: string | undefined) {
  return useQuery({
    queryKey: ['tournaments', 'deck-version', deckId ?? ''] as const,
    queryFn: ({ signal }) =>
      request(`/api/tournaments/decks/${encodeURIComponent(deckId ?? '')}/version`, {
        schema: deckVersionDetailSchema,
        signal,
      }),
    enabled: Boolean(deckId),
    retry: false,
  })
}

/** The «versión de torneo» of every active deck (Sobres). */
export function useDeckVersions(enabled = true) {
  return useQuery({
    queryKey: ['tournaments', 'deck-versions'] as const,
    queryFn: ({ signal }) => request('/api/tournaments/decks/versions', { schema: deckVersionsResponseSchema, signal }),
    enabled,
    retry: false,
  })
}

/** Polls every 10 s while a sync runs, so the progress line moves. */
export function useTournamentStatus() {
  return useQuery({
    queryKey: tournamentKeys.status,
    queryFn: ({ signal }) => request('/api/tournaments/status', { schema: tournamentStatusSchema, signal }),
    refetchInterval: (q) => (q.state.data?.sync.running ? 10_000 : false),
  })
}

/** Fase 11: what is played more and less, this week against the week before. */
export function useMetaTrends(scope: TournamentScopeParams, days: number) {
  return useQuery({
    queryKey: tournamentKeys.trends(scope, days),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/trends${query({ ...scope, days })}`, { schema: metaTrendsSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

/** Fase 9: the most played archetypes against each other, from the era's pairings. */
export function useMatchupMatrix(scope: TournamentScopeParams, top: number) {
  return useQuery({
    queryKey: tournamentKeys.matchups(scope, top),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/matchups${query({ ...scope, top })}`, { schema: matchupMatrixSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

export function useArchetypes(scope: TournamentScopeParams) {
  return useQuery({
    queryKey: tournamentKeys.archetypes(scope),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/archetypes${query({ ...scope })}`, { schema: archetypesResponseSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

export function useArchetype(id: string, scope: TournamentScopeParams, card: string | null, minCount: number) {
  return useQuery({
    queryKey: tournamentKeys.archetype(id, scope, card, minCount),
    queryFn: ({ signal }) =>
      request(
        `/api/tournaments/archetypes/${encodeURIComponent(id)}${query({ ...scope, card, minCount: card ? minCount : undefined })}`,
        { schema: archetypeDetailSchema, signal },
      ),
    placeholderData: keepPreviousData,
  })
}

/** Fase 44: núcleo, techs, copias y conversión al top 8 (bootstrap en el servidor: se pide al abrir la sección). */
export function useArchetypeCards(id: string, scope: TournamentScopeParams) {
  return useQuery({
    queryKey: tournamentKeys.archetypeCards(id, scope),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/archetypes/${encodeURIComponent(id)}/cards${query({ ...scope })}`, {
        schema: archetypeCardsSchema,
        signal,
      }),
  })
}

export function useTournamentLists(scope: TournamentScopeParams, kind: 'group' | 'name') {
  return useQuery({
    queryKey: tournamentKeys.lists(scope, kind),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/lists${query({ ...scope, kind, limit: 200 })}`, {
        schema: listsResponseSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  })
}

export function useTournamentList(key: string, scope: TournamentScopeParams, kind: 'group' | 'name') {
  return useQuery({
    queryKey: tournamentKeys.list(key, scope, kind),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/lists/${encodeURIComponent(key)}${query({ ...scope, kind })}`, {
        schema: listDetailSchema,
        signal,
      }),
  })
}

export function useBuildable(scope: TournamentScopeParams) {
  return useQuery({
    queryKey: tournamentKeys.buildable(scope),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/buildable${query({ ...scope })}`, { schema: buildableResponseSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

export function useUnlock(scope: TournamentScopeParams) {
  return useQuery({
    queryKey: tournamentKeys.unlock(scope),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/unlock${query({ ...scope })}`, { schema: unlockResponseSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

export function useTournamentEvents(scope: TournamentScopeParams, enabled: boolean) {
  return useQuery({
    queryKey: tournamentKeys.events(scope),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/events${query({ ...scope })}`, { schema: tournamentEventsSchema, signal }),
    enabled,
  })
}

export function useUnknownCards(scope: TournamentScopeParams, enabled: boolean) {
  return useQuery({
    queryKey: tournamentKeys.unknown(scope),
    queryFn: ({ signal }) =>
      request(`/api/tournaments/unknown-cards${query({ ...scope })}`, { schema: unknownCardsSchema, signal }),
    enabled,
  })
}

export function useSetReleases() {
  return useQuery({
    queryKey: tournamentKeys.sets,
    queryFn: ({ signal }) => request('/api/tournaments/sets', { schema: setReleasesResponseSchema, signal }),
    select: (data) => data.items,
  })
}

const setProposalSchema = z.object({
  code: z.string(),
  nameEn: z.string(),
  nameEs: z.string().nullable(),
  releaseDate: z.string(),
  opensEra: z.boolean(),
  tournaments: z.number(),
  firstTournament: z.object({ id: z.string(), name: z.string(), date: z.string() }),
  inCatalog: z.boolean(),
})
export type SetProposal = z.infer<typeof setProposalSchema>

/** Fase 40 (H-006): the rows the era table lacks, proposed from the tournaments that play those sets. */
export function useSetProposals() {
  return useQuery({
    queryKey: [...tournamentKeys.sets, 'proposals'] as const,
    queryFn: ({ signal }) =>
      request('/api/tournaments/sets/proposals', { schema: z.object({ items: z.array(setProposalSchema) }), signal }),
    select: (data) => data.items,
  })
}

export function useSaveSetRelease() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (set: { code: string; nameEn: string; releaseDate: string; opensEra: boolean }) =>
      request(`/api/tournaments/sets/${encodeURIComponent(set.code)}`, {
        method: 'PUT',
        body: { nameEn: set.nameEn, releaseDate: set.releaseDate, opensEra: set.opensEra },
        schema: setReleaseSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tournamentKeys.all }),
  })
}

export function useStartSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (backfillDays?: number) =>
      request('/api/tournaments/sync', { method: 'POST', body: backfillDays ? { backfillDays } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tournamentKeys.status }),
  })
}

export function useSetArchetypeAlias() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, canonicalId }: { id: string; canonicalId: string | null }) =>
      request(`/api/tournaments/archetypes/${encodeURIComponent(id)}/alias`, { method: 'PUT', body: { canonicalId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: tournamentKeys.all })
      await queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
  })
}
