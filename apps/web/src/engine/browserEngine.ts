/**
 * The engine of the browser (T-015) seen from the page: is it in this installation (its manifest), and a client of the
 * Web Worker that runs it. `GameEngine` is what the runner needs, so its tests use a stand-in.
 */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import {
  ENGINE_BASE,
  type EngineCoach,
  type EngineInfo,
  type EngineJob,
  type EngineManifest,
  type EngineRequest,
  type EngineResponse,
  type EngineStep,
} from './protocol'

export interface GameEngine {
  /** Loads the engine (the first call does): its revision and version. */
  info(): Promise<EngineInfo>
  /** Starts a game (the one before is dropped). */
  start(job: EngineJob): Promise<unknown>
  advance(choice?: number): Promise<EngineStep>
  coach(): Promise<EngineCoach>
  restoreCoach(values: number[]): Promise<void>
  /** The finished game's replay, gzipped. */
  replay(): Promise<Blob>
  dispose(): void
}

/** The engine refused something (`fatal`: it stopped and this engine cannot be used again). */
export class EngineError extends Error {
  readonly fatal: boolean
  constructor(message: string, fatal: boolean) {
    super(message)
    this.name = 'EngineError'
    this.fatal = fatal
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void }
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never
type Payload = WithoutId<EngineRequest>

/** The engine in its Web Worker: one per game being run. */
export class WorkerEngine implements GameEngine {
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private next = 1
  private failure: EngineError | null = null

  constructor(
    create: () => Worker = () => new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    this.worker = create()
    this.worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const answer = event.data
      const waiting = this.pending.get(answer.id)
      if (!waiting) return
      this.pending.delete(answer.id)
      if (answer.ok) waiting.resolve(answer.value)
      else waiting.reject(new EngineError(answer.error, answer.fatal))
    }
    this.worker.onerror = (event) => {
      event.preventDefault()
      this.stop(new EngineError(event.message || 'No se pudo cargar el motor en este dispositivo.', true))
    }
  }

  private call<T>(message: Payload): Promise<T> {
    if (this.failure) return Promise.reject(this.failure)
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.worker.postMessage({ ...message, id })
    })
  }

  private stop(error: EngineError): void {
    this.failure = error
    for (const waiting of this.pending.values()) waiting.reject(error)
    this.pending.clear()
    this.worker.terminate()
  }

  info(): Promise<EngineInfo> {
    return this.call({ type: 'info' })
  }

  start(job: EngineJob): Promise<unknown> {
    return this.call({ type: 'start', job })
  }

  advance(choice?: number): Promise<EngineStep> {
    return this.call(choice === undefined ? { type: 'advance' } : { type: 'advance', choice })
  }

  coach(): Promise<EngineCoach> {
    return this.call({ type: 'coach' })
  }

  async restoreCoach(values: number[]): Promise<void> {
    await this.call({ type: 'restoreCoach', values })
  }

  async replay(): Promise<Blob> {
    const data = await this.call<ArrayBuffer>({ type: 'replay' })
    return new Blob([data], { type: 'application/gzip' })
  }

  dispose(): void {
    this.stop(new EngineError('El motor se cerró.', true))
  }
}

const manifestSchema = z.object({
  engineRev: z.string().regex(/^[0-9a-f]{40}$/),
  gamesRev: z.number().int().min(0),
  version: z.string(),
  js: z.string().regex(/^[\w.-]+\.js$/),
  wasm: z.string().regex(/^[\w.-]+\.wasm$/),
  sources: z.string().optional(),
  wasmBytes: z.number().optional(),
})

/** This browser can run it at all (WebAssembly, module workers). */
export function browserCanRunEngine(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker === 'function'
}

/** The engine's manifest, or null when this installation has none (not built) or the browser cannot run it. */
export async function fetchEngineManifest(signal?: AbortSignal): Promise<EngineManifest | null> {
  if (!browserCanRunEngine()) return null
  try {
    const response = await fetch(`${ENGINE_BASE}manifest.json`, {
      cache: 'no-cache',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) return null
    const parsed = manifestSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** T-015: the engine of the browser, when this installation has it (`null` otherwise). */
export function useBrowserEngine() {
  return useQuery({
    queryKey: ['browser-engine'] as const,
    queryFn: ({ signal }) => fetchEngineManifest(signal),
    staleTime: 10 * 60_000,
    retry: false,
  })
}
