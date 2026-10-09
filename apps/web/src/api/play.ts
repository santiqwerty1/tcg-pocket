import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import { type LiveGame, liveGameSchema, liveGamesSchema, type PlayInput, recentListsSchema } from './schemas'

export const playKeys = {
  all: ['play'] as const,
  list: ['play', 'list'] as const,
  game: (id: string) => ['play', 'game', id] as const,
}

/** Fase 23: the exact lists that placed well in the last days, checked against the engine. */
export function useRecentLists(enabled: boolean) {
  return useQuery({
    queryKey: ['play', 'recent-lists'] as const,
    queryFn: ({ signal }) => request('/api/play/recent-lists', { schema: recentListsSchema, signal }),
    enabled,
    staleTime: 10 * 60_000,
  })
}

export function usePlayGames() {
  return useQuery({
    queryKey: playKeys.list,
    queryFn: ({ signal }) => request('/api/play', { schema: liveGamesSchema, signal }),
    select: (data) => data.items,
  })
}

/** Polls while the bot plays (1 s), while a worker is awaited (3 s) and slowly on the owner's turn (10 s, another device may answer). */
export function usePlayGame(id: string) {
  return useQuery({
    queryKey: playKeys.game(id),
    queryFn: ({ signal }) => request(`/api/play/${encodeURIComponent(id)}`, { schema: liveGameSchema, signal }),
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'running' ? 1000 : status === 'queued' ? 3000 : status === 'waiting' ? 10_000 : false
    },
    placeholderData: keepPreviousData,
  })
}

export function useCreateGame() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PlayInput) => request('/api/play', { method: 'POST', body: input, schema: liveGameSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: playKeys.list }),
  })
}

export function useChoose(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { ply: number; i: number }) =>
      request(`/api/play/${encodeURIComponent(id)}/choice`, { method: 'POST', body, schema: liveGameSchema }),
    onSuccess: (game: LiveGame) => queryClient.setQueryData(playKeys.game(id), game),
  })
}

/** Modo entrenador: reveal the coach's option for the pending decision. */
export function useHint(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { ply: number }) =>
      request(`/api/play/${encodeURIComponent(id)}/hint`, { method: 'POST', body, schema: liveGameSchema }),
    onSuccess: (game: LiveGame) => queryClient.setQueryData(playKeys.game(id), game),
  })
}

/** Fase 22: back to the previous decision (the PC rebuilds the game up to it). */
export function useUndo(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request(`/api/play/${encodeURIComponent(id)}/undo`, { method: 'POST', schema: liveGameSchema }),
    onSuccess: (game: LiveGame) => queryClient.setQueryData(playKeys.game(id), game),
  })
}

/** Fase 22: the same decks and bot again; `sameSeed` for the very same shuffle. */
export function useRematch(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { sameSeed?: boolean }) =>
      request(`/api/play/${encodeURIComponent(id)}/rematch`, { method: 'POST', body, schema: liveGameSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: playKeys.list }),
  })
}

/** Fase 22: the replay of a finished game (deckgym's JSON), for the app's own viewer. */
export function useGameReplay(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['play', 'replay', id] as const,
    queryFn: ({ signal }) => request(`/api/play/${encodeURIComponent(id)}/replay/raw`, { signal }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useAbandon(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      request(`/api/play/${encodeURIComponent(id)}/abandon`, { method: 'POST', schema: liveGameSchema }),
    onSuccess: (game: LiveGame) => {
      queryClient.setQueryData(playKeys.game(id), game)
      void queryClient.invalidateQueries({ queryKey: playKeys.list })
    },
  })
}
