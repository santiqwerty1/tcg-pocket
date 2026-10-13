import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type RefObject, useEffect, useRef } from 'react'
import { z } from 'zod'
import type { RunnerApi } from '@/engine/runner'
import { request } from './client'
import {
  browserJobSchema,
  browserStepSchema,
  type LiveGame,
  liveGameSchema,
  liveGamesSchema,
  type PlayInput,
  recentListsSchema,
} from './schemas'

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

const ACTIVE = new Set(['queued', 'running', 'waiting'])

/** Over for good: nothing else will change (a finished game still waits for its replay). */
function isOver(game: Pick<LiveGame, 'status' | 'replay'>): boolean {
  return (
    game.status === 'failed' ||
    game.status === 'abandoned' ||
    game.status === 'engine_changed' ||
    (game.status === 'done' && game.replay)
  )
}

/**
 * Fase 33: the server pushes the game whenever it changes (`GET /api/play/:id/events`, server-sent events): the bot's
 * move shows at once instead of on the next poll. `live` says whether the stream is connected (the browser reconnects
 * by itself after a cut; meanwhile the polling is fast again).
 */
function useGameEvents(id: string, open: boolean, live: RefObject<boolean>): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!open || typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/play/${encodeURIComponent(id)}/events`, { withCredentials: true })
    source.onopen = () => {
      live.current = true
    }
    source.onmessage = (event) => {
      let parsed: ReturnType<typeof liveGameSchema.safeParse>
      try {
        parsed = liveGameSchema.safeParse(JSON.parse(String(event.data)))
      } catch {
        return
      }
      if (!parsed.success) return
      queryClient.setQueryData(playKeys.game(id), parsed.data)
      // The server ends the stream once the game is over: close it so the browser does not reconnect.
      if (isOver(parsed.data)) {
        source.close()
        live.current = false
      }
    }
    source.onerror = () => {
      live.current = false
    }
    return () => {
      source.close()
      live.current = false
    }
  }, [id, open, live, queryClient])
}

/**
 * The game, pushed by the server while it is going (Fase 33). Polling is the safety net: every 15 s with the stream
 * connected; without it, 1 s while the bot plays, 3 s while a worker is awaited and 10 s on the owner's turn.
 */
export function usePlayGame(id: string) {
  const live = useRef(false)
  const query = useQuery({
    queryKey: playKeys.game(id),
    queryFn: ({ signal }) => request(`/api/play/${encodeURIComponent(id)}`, { schema: liveGameSchema, signal }),
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (!status) return false
      if (live.current) return ACTIVE.has(status) ? 15_000 : false
      return status === 'running' ? 1000 : status === 'queued' ? 3000 : status === 'waiting' ? 10_000 : false
    },
    placeholderData: keepPreviousData,
  })
  const game = query.data
  useGameEvents(id, game !== undefined && !isOver(game), live)
  return query
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

/** Fase 22: the same decks and bot again; `sameSeed` for the very same shuffle (T-015: the page's engine for the browser). */
export function useRematch(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { sameSeed?: boolean; engineRev?: string; gamesRev?: number; build?: string }) =>
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

const okSchema = z.object({ status: z.string() }).passthrough()

/** T-015: the page's side of a browser game (engine/runner.ts), like a worker's side of a PC game. */
export const browserPlayApi: RunnerApi = {
  // A POST: it can end the game (another engine), and a GET never changes anything (review of #86).
  job: (id, engine, signal) =>
    request(`/api/play/${id}/browser`, { method: 'POST', body: engine, schema: browserJobSchema, signal }),
  decision: (id, body, signal) =>
    request(`/api/play/${id}/browser/decision`, { method: 'PUT', body, schema: browserStepSchema, signal }),
  choice: (id, body, signal) =>
    request(`/api/play/${id}/browser/choice`, { method: 'POST', body, schema: browserStepSchema, signal }),
  end: (id, body, signal) => request(`/api/play/${id}/browser/end`, { method: 'PUT', body, schema: okSchema, signal }),
  failure: (id, body, signal) => request(`/api/play/${id}/browser/failure`, { method: 'PUT', body, signal }),
  replay: (id, choices, build, gzipped, signal) =>
    request(`/api/play/${id}/browser/replay`, {
      method: 'PUT',
      query: { choices: choices.join('.'), build },
      body: gzipped,
      headers: { 'Content-Type': 'application/gzip' },
      signal,
    }),
}
