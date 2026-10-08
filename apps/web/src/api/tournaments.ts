import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import {
  archetypeDetailSchema,
  archetypesResponseSchema,
  buildableResponseSchema,
  listDetailSchema,
  listsResponseSchema,
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
  lists: (scope: TournamentScopeParams, kind: 'group' | 'name') => ['tournaments', 'lists', scope, kind] as const,
  list: (key: string, scope: TournamentScopeParams, kind: 'group' | 'name') =>
    ['tournaments', 'list', key, scope, kind] as const,
  buildable: (scope: TournamentScopeParams) => ['tournaments', 'buildable', scope] as const,
  unlock: (scope: TournamentScopeParams) => ['tournaments', 'unlock', scope] as const,
  events: (scope: TournamentScopeParams) => ['tournaments', 'events', scope] as const,
  unknown: (scope: TournamentScopeParams) => ['tournaments', 'unknown', scope] as const,
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** Polls every 10 s while a sync runs, so the progress line moves. */
export function useTournamentStatus() {
  return useQuery({
    queryKey: tournamentKeys.status,
    queryFn: ({ signal }) => request('/api/tournaments/status', { schema: tournamentStatusSchema, signal }),
    refetchInterval: (q) => (q.state.data?.sync.running ? 10_000 : false),
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
