/**
 * The engine of the browser (T-015): deckgym compiled to WebAssembly (engine/wasm), run in a Web Worker. These are
 * the messages between the page and that worker, and what the engine answers (the same fields as `engine-cli play`).
 */

/** What the engine needs to start a game (the server's `GET /api/play/:id/browser`). */
export interface EngineJob {
  deckHuman: string
  deckBot: string
  bot: string
  /** In decimal: a u64. */
  seed: string
  coach: boolean
}

export interface EngineAction {
  i: number
  text: string
  action: unknown
}

/** One action of either player, as the game's log keeps it. */
export type EngineLogEntry = Record<string, unknown>

export type EngineStep =
  | {
      type: 'decide'
      ply: number
      turn: number
      state: Record<string, unknown>
      actions: EngineAction[]
      log: EngineLogEntry[]
    }
  | {
      type: 'end'
      winner: 'you' | 'bot' | 'tie'
      turns: number
      state: Record<string, unknown>
      log: EngineLogEntry[]
    }

/** Modo entrenador: the value of each option (`scores` rounded, `values` exact, to restore after a rebuild). */
export interface EngineCoach {
  scores: number[]
  best: number
  values: number[]
}

export interface EngineInfo {
  engineRev: string
  /** How its games play (engine-cli's GAMES_REV): a game started with another one cannot go on here. */
  gamesRev: number
  version: string
  /** What was compiled (the manifest's hash): a browser game keeps it (review of #86). */
  build: string
}

export type EngineRequest =
  | { id: number; type: 'info' }
  | { id: number; type: 'start'; job: EngineJob }
  | { id: number; type: 'advance'; choice?: number }
  | { id: number; type: 'coach' }
  | { id: number; type: 'restoreCoach'; values: number[] }
  | { id: number; type: 'replay' }

export type EngineResponse =
  | { id: number; ok: true; value: unknown }
  /** `fatal`: the module aborted (a panic in the engine) and cannot be used again. */
  | { id: number; ok: false; error: string; fatal: boolean }

/** The published engine: `apps/web/public/engine/manifest.json` (scripts/build-engine-wasm.mjs). */
export interface EngineManifest {
  engineRev: string
  gamesRev: number
  version: string
  build: string
  js: string
  wasm: string
  sources?: string
  wasmBytes?: number
}

/** Where the PWA serves the engine's files. */
export const ENGINE_BASE = '/engine/'
