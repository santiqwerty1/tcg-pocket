/**
 * What a worker can play, decided in one place for the queue, the alerts and the Laboratorio (H-010, H-018, B2). A
 * worker reports its own version and its engine's (`cliVersion`); from worker 0.2.6 on also the engine's `features`
 * (`engine-cli version`). A feature names one thing an engine can do, so changes to the engine made in parallel do
 * not fight over one version number.
 */
import { PER_GAME_CLI_VERSION, PER_GAME_WORKER_VERSION } from './perGame.js'

/**
 * «perGame»: every game by index (H-010) · «batch»: several pairings per process (B2) · «fairBots»: the f bots (H-018)
 * · «etBot»: the bot that ends its turn, which deckgym's parser never reaches (H-051, engine-cli 0.3.5) · «gBots»:
 * the g bots (T-021, engine-cli 0.3.13).
 */
export const ENGINE_FEATURES = ['perGame', 'batch', 'fairBots', 'etBot', 'gBots'] as const
export type EngineFeature = (typeof ENGINE_FEATURES)[number]

/** Workers from this version on report `engineFeatures`. */
export const ENGINE_FEATURES_WORKER_VERSION = '0.2.6'

export interface WorkerAbilities {
  version?: string | null | undefined
  cliVersion?: string | null | undefined
  /** Empty or missing: an engine (or worker) from before features; the version rules apply. */
  engineFeatures?: readonly string[] | null | undefined
}

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})/

function versionParts(version: string | null | undefined): [number, number, number] {
  const match = VERSION.exec(version?.trim() ?? '')
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0]
}

/**
 * Versions compared as numbers (H-002): «0.2.10» is newer than «0.2.2», which a text comparison gets wrong. The
 * version is free text from the worker, so anything that does not start with three numbers counts as 0.0.0.
 */
export function versionAtLeast(version: string | null | undefined, minimum: string): boolean {
  const have = versionParts(version)
  const need = versionParts(minimum)
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (need[i] ?? 0)) return (have[i] ?? 0) > (need[i] ?? 0)
  }
  return true
}

function reported(worker: WorkerAbilities): readonly string[] | null {
  return worker.engineFeatures && worker.engineFeatures.length > 0 ? worker.engineFeatures : null
}

/** Whether the engine has `feature`; engines from before features have none of them. */
export function hasEngineFeature(worker: WorkerAbilities, feature: EngineFeature): boolean {
  return reported(worker)?.includes(feature) ?? false
}

/** Jobs with `perGame`: a worker that forwards it (0.2.5) and an engine that plays it (feature, or engine-cli 0.2.0). */
export function canPlayPerGame(worker: WorkerAbilities): boolean {
  if (!versionAtLeast(worker.version, PER_GAME_WORKER_VERSION)) return false
  return reported(worker)
    ? hasEngineFeature(worker, 'perGame')
    : versionAtLeast(worker.cliVersion, PER_GAME_CLI_VERSION)
}

/** Several pairings of one job in one engine process (the worker asks for them itself when it can). */
export function canBatch(worker: WorkerAbilities): boolean {
  return hasEngineFeature(worker, 'batch')
}

/** Phase 42: engine-cli 0.3.3 on plays like games revision 1, even the engines that do not say it yet (0.3.3–0.3.5). */
export const FIRST_GAMES_REV_CLI_VERSION = '0.3.3'

/**
 * How a worker's engine plays (`gamesRev` of `engine-cli version`, phase 42): a job is played whole with one, so the
 * queue gives its chunks only to engines with the same. Before engines said it, 1 from engine-cli 0.3.3 on (nothing
 * that already existed plays otherwise since the f bots' clock) and 0 before.
 */
export function gamesRevOf(worker: {
  gamesRev?: number | null | undefined
  cliVersion?: string | null | undefined
}): number {
  if (typeof worker.gamesRev === 'number' && Number.isInteger(worker.gamesRev) && worker.gamesRev >= 0)
    return worker.gamesRev
  return versionAtLeast(worker.cliVersion, FIRST_GAMES_REV_CLI_VERSION) ? 1 : 0
}

/**
 * Phase 42: how an engine plays, from what it said: its games revision, else its version (`gamesRevOf`). Null when it
 * said neither: nothing is fixed or checked with a guess (`gamesRevOf({})` is 0, an old revision; review of #68).
 */
export function saidGamesRev(said: { gamesRev?: number | null; cliVersion?: string | null }): number | null {
  return typeof said.gamesRev === 'number' || said.cliVersion ? gamesRevOf(said) : null
}

/** Jobs played with the f bots (H-018): only engines that list them. */
export function canPlayFairBots(worker: WorkerAbilities): boolean {
  return hasEngineFeature(worker, 'fairBots')
}

/** Jobs and games with «et» (H-051): an older engine answers «Invalid player code» and the job fails. */
export function canPlayEtBot(worker: WorkerAbilities): boolean {
  return hasEngineFeature(worker, 'etBot')
}

/**
 * The first engine-cli with the g the app plays (T-021). Engines from 0.3.13 to 0.3.15 list «gBots» too, but their g
 * is an earlier one: it changed in #128, #139 and #140 while no job could ask for it, so `GAMES_REV` did not go up.
 * From here on g1 and g2 are in the golden games, and a change to g raises it as for any other bot.
 */
export const G_BOTS_CLI_VERSION = '0.3.16'

/** Jobs and games with a g bot (T-021): an engine with «gBots» and this g, so that one job never mixes two of them. */
export function canPlayGBots(worker: WorkerAbilities): boolean {
  return hasEngineFeature(worker, 'gBots') && versionAtLeast(worker.cliVersion, G_BOTS_CLI_VERSION)
}
