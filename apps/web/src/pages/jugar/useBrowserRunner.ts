/**
 * T-015: while a «browser» game's page is open, this page plays the bot's side with the engine of the browser
 * (engine/runner.ts). Every open page of the game runs it the same way (same seed, same choices), so a second tab or
 * the phone and the PC at once do no harm. The game stops when the page closes and goes on when it opens again.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { browserPlayApi, playKeys } from '@/api/play'
import type { LiveGame } from '@/api/schemas'
import { WorkerEngine } from '@/engine/browserEngine'
import type { EngineManifest } from '@/engine/protocol'
import { type RunnerStatus, runBrowserGame } from '@/engine/runner'

/** The coach's values computed on this page, by game and choices: an undo keeps them in the replay. */
const coachCache = new Map<string, number[]>()

/** The game needs this page's engine: being played, or finished without its replay. */
export function needsBrowserEngine(game: Pick<LiveGame, 'runner' | 'status' | 'replay'>): boolean {
  if (game.runner !== 'browser') return false
  return game.status === 'queued' || game.status === 'running' || game.status === 'waiting'
    ? true
    : game.status === 'done' && !game.replay
}

export function useBrowserRunner(
  game: Pick<LiveGame, 'id' | 'runner' | 'status' | 'replay'>,
  engine: EngineManifest | null | undefined,
): { status: RunnerStatus | null; retry: () => void } {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RunnerStatus | null>(null)
  const [attempt, setAttempt] = useState(0)
  const active = needsBrowserEngine(game)
  const engineRev = engine?.engineRev ?? null
  const id = game.id

  useEffect(() => {
    if (!active || !engineRev) return
    void attempt
    const controller = new AbortController()
    void runBrowserGame({
      id,
      engineRev,
      api: browserPlayApi,
      createEngine: () => new WorkerEngine(),
      signal: controller.signal,
      onStatus: setStatus,
      coachCache,
    }).then((result) => {
      if (controller.signal.aborted) return
      setStatus(result.kind === 'error' ? { kind: 'error', message: result.message } : null)
      void queryClient.invalidateQueries({ queryKey: playKeys.game(String(id)) })
    })
    return () => controller.abort()
  }, [id, active, engineRev, attempt, queryClient])

  const retry = useCallback(() => {
    setStatus(null)
    setAttempt((value) => value + 1)
  }, [])
  return { status: active ? status : null, retry }
}
