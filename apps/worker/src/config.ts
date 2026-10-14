/**
 * Worker configuration (PLAN §3.7): `%LOCALAPPDATA%\tcg-worker\config.json` (server, token, cores, name, engine path),
 * overridable by environment variables. The token is a `tcg_wk_*` API token created in the app (Más → Tokens de API);
 * it never leaves this PC except as the Authorization header to the app.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism, homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EnginePriority } from './priority.js'

export interface WorkerConfig {
  server: string
  token: string
  /** Threads per chunk (the engine plays the games of a chunk in parallel). */
  cores: number
  /** Background engines yield CPU to CI; interactive engines always use normal priority. */
  priority: EnginePriority
  /** D-025: Android opts out of MCTS and depth 3+ jobs before leasing; PC opts in. */
  allowSlowBots: boolean
  name: string
  enginePath: string
  dataDir: string
  workerId: string
  /** Mobile packages cap a job's requested threads at the configured budget. */
  capThreads?: boolean
  /** D-026: a managed install (portable or Android package) follows the app's package; false keeps this one. */
  autoUpdate: boolean
  /**
   * The CPU regulator (Windows, engine feature `regulate`): the engines use every logical processor up to `cores`
   * while nothing else needs them, and give whole cores back when another program does. On by default on Windows.
   */
  cpuRegulator: boolean
}

export function dataDir(): string {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share')
  return process.env.TCG_WORKER_DIR ?? join(base, 'tcg-worker')
}

/** The engine built in this repository (`pnpm -F @tcg/worker engine:build`). */
export function defaultEnginePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const exe = process.platform === 'win32' ? 'engine-cli.exe' : 'engine-cli'
  return resolve(here, '..', '..', '..', 'engine', 'target', 'release', exe)
}

export interface FileConfig {
  priority?: EnginePriority
  allowSlowBots?: boolean
  server?: string
  token?: string
  cores?: number
  name?: string
  enginePath?: string
  onlyCharging?: boolean
  autoUpdate?: boolean
  cpuRegulator?: boolean
}

/** What a caller knows better than the repository layout (the portable package: the engine next to the exe). */
export interface ConfigDefaults {
  enginePath?: string | undefined
  determinismPath?: string | undefined
  capThreads?: boolean
  allowSlowBots?: boolean
  /**
   * D-026: the engine of the package that runs, never `enginePath` from config.json or TCG_ENGINE_PATH (an old setting
   * would keep an engine the updates no longer replace). Ignored when the owner turned updates off.
   */
  packageEngine?: boolean
  /** How the start's determinism check runs its engine (Android: normal priority, 2 minutes per case). */
  determinismCheck?: { priority?: EnginePriority; caseTimeoutMs?: number }
}

export function configFile(): string {
  return join(dataDir(), 'config.json')
}

export function readFileConfig(): FileConfig {
  const file = configFile()
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as FileConfig) : {}
}

/** Saves the file configuration (the portable package's setup). */
export function writeFileConfig(config: FileConfig): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  writeFileSync(
    configFile(),
    `${JSON.stringify(config, null, 2)}
`,
    { mode: 0o600 },
  )
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, defaults: ConfigDefaults = {}): WorkerConfig {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'config.json')
  const fromFile: FileConfig = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as FileConfig) : {}
  const token = env.TCG_WORKER_TOKEN ?? fromFile.token
  if (!token?.startsWith('tcg_wk_')) {
    throw new Error(
      `Falta el token del worker: creá uno en la app (Más → Tokens de API, tipo worker) y guardalo en ${file} como {"token": "tcg_wk_…"} o en TCG_WORKER_TOKEN.`,
    )
  }
  const idFile = join(dir, 'worker-id')
  if (!existsSync(idFile)) writeFileSync(idFile, randomUUID())
  const cores = Number(
    env.TCG_WORKER_CORES ??
      fromFile.cores ??
      (defaults.capThreads ? Math.max(1, Math.floor(availableParallelism() / 2)) : availableParallelism()),
  )
  const priority = env.TCG_WORKER_PRIORITY ?? fromFile.priority ?? 'below_normal'
  if (priority !== 'below_normal' && priority !== 'normal' && priority !== 'idle') {
    throw new Error('Prioridad inválida: usá below_normal, normal o idle en priority o TCG_WORKER_PRIORITY.')
  }
  const slowBotsEnv = env.TCG_WORKER_ALLOW_SLOW_BOTS
  if (slowBotsEnv !== undefined && slowBotsEnv !== 'true' && slowBotsEnv !== 'false') {
    throw new Error('TCG_WORKER_ALLOW_SLOW_BOTS inválido: usá true o false.')
  }
  const allowSlowBots =
    slowBotsEnv !== undefined ? slowBotsEnv === 'true' : (fromFile.allowSlowBots ?? defaults.allowSlowBots ?? true)
  if (typeof allowSlowBots !== 'boolean') {
    throw new Error('allowSlowBots inválido: usá un booleano true o false en config.json.')
  }
  const autoUpdateEnv = env.TCG_WORKER_AUTO_UPDATE
  if (autoUpdateEnv !== undefined && autoUpdateEnv !== 'true' && autoUpdateEnv !== 'false') {
    throw new Error('TCG_WORKER_AUTO_UPDATE inválido: usá true o false.')
  }
  const autoUpdate = autoUpdateEnv !== undefined ? autoUpdateEnv === 'true' : (fromFile.autoUpdate ?? true)
  if (typeof autoUpdate !== 'boolean') {
    throw new Error('autoUpdate inválido: usá un booleano true o false en config.json.')
  }
  const regulatorEnv = env.TCG_WORKER_CPU_REGULATOR
  if (regulatorEnv !== undefined && regulatorEnv !== 'true' && regulatorEnv !== 'false') {
    throw new Error('TCG_WORKER_CPU_REGULATOR inválido: usá true o false.')
  }
  const cpuRegulator =
    regulatorEnv !== undefined ? regulatorEnv === 'true' : (fromFile.cpuRegulator ?? process.platform === 'win32')
  if (typeof cpuRegulator !== 'boolean') {
    throw new Error('cpuRegulator inválido: usá un booleano true o false en config.json.')
  }
  const configuredEngine = env.TCG_ENGINE_PATH ?? fromFile.enginePath
  const enginePath =
    defaults.packageEngine && autoUpdate && defaults.enginePath
      ? defaults.enginePath
      : (configuredEngine ?? defaults.enginePath ?? defaultEnginePath())
  return {
    server: (env.TCG_SERVER ?? fromFile.server ?? 'https://tcg-pocket.fly.dev').replace(/\/+$/, ''),
    token,
    cores: Number.isInteger(cores) && cores > 0 ? cores : 2,
    priority,
    allowSlowBots,
    name: env.TCG_WORKER_NAME ?? fromFile.name ?? hostname(),
    enginePath,
    dataDir: dir,
    workerId: readFileSync(idFile, 'utf8').trim(),
    ...(defaults.capThreads ? { capThreads: true } : {}),
    autoUpdate,
    cpuRegulator,
  }
}
