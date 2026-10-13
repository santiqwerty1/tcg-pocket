/**
 * The engine of the browser (T-015) in a Web Worker: loads the WebAssembly build of engine/wasm (the files listed in
 * /engine/manifest.json) and plays one game at a time for the page, one call per message (protocol.ts). The bot's
 * moves and the coach take their time here, not on the page. A panic in the engine aborts the module: the answer says
 * `fatal` and the page starts another worker.
 */
import { ENGINE_BASE, type EngineManifest, type EngineRequest, type EngineResponse } from './protocol'

interface WasmGame {
  info(): string
  advance(choice?: number): string
  coach(): string
  restoreCoach(values: Float64Array): void
  replay(): string | undefined
  free(): void
}

interface WasmModule {
  default(input: { module_or_path: string }): Promise<unknown>
  engineInfo(): string
  LiveGame: new (job: string) => WasmGame
}

interface WorkerScope {
  postMessage(message: EngineResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null
  location: { origin: string }
  __tcgEnginePanic?: (message: string) => void
}

const scope = globalThis as unknown as WorkerScope
let loading: Promise<WasmModule> | null = null
let game: WasmGame | null = null
let panic: string | null = null
let dead = false

// engine/wasm/src/lib.rs calls it from its panic hook, right before the module aborts.
scope.__tcgEnginePanic = (message) => {
  panic = message
}

function load(): Promise<WasmModule> {
  loading ??= (async () => {
    const base = new URL(ENGINE_BASE, scope.location.origin).toString()
    const response = await fetch(`${base}manifest.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error('El motor del navegador no está en esta instalación.')
    const manifest = (await response.json()) as EngineManifest
    const module = (await import(/* @vite-ignore */ `${base}${manifest.js}`)) as WasmModule
    await module.default({ module_or_path: `${base}${manifest.wasm}` })
    return module
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

function requireGame(): WasmGame {
  if (!game) throw new Error('No hay ninguna partida empezada.')
  return game
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

async function handle(message: EngineRequest): Promise<{ value: unknown; transfer?: Transferable[] }> {
  const module = await load()
  switch (message.type) {
    case 'info':
      return { value: JSON.parse(module.engineInfo()) }
    case 'start':
      game?.free()
      game = null
      game = new module.LiveGame(JSON.stringify(message.job))
      return { value: JSON.parse(game.info()) }
    case 'advance':
      return { value: JSON.parse(requireGame().advance(message.choice)) }
    case 'coach':
      return { value: JSON.parse(requireGame().coach()) }
    case 'restoreCoach':
      requireGame().restoreCoach(new Float64Array(message.values))
      return { value: null }
    case 'replay': {
      const replay = requireGame().replay()
      if (replay === undefined) throw new Error('La partida todavía no terminó.')
      const compressed = await gzip(replay)
      return { value: compressed, transfer: [compressed] }
    }
  }
}

scope.onmessage = (event) => {
  const message = event.data
  if (dead) {
    scope.postMessage({ id: message.id, ok: false, error: panic ?? 'El motor se detuvo.', fatal: true })
    return
  }
  handle(message).then(
    ({ value, transfer }) => scope.postMessage({ id: message.id, ok: true, value }, transfer ?? []),
    (error: unknown) => {
      // wasm32 cannot unwind: a panic is a trap («unreachable») and the module's state is gone.
      const fatal = error instanceof WebAssembly.RuntimeError
      if (fatal) dead = true
      const text = error instanceof Error ? error.message : String(error)
      scope.postMessage({ id: message.id, ok: false, error: fatal && panic ? panic : text, fatal })
    },
  )
}
