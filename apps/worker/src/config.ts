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

export interface WorkerConfig {
  server: string
  token: string
  /** Threads per chunk (the engine plays the games of a chunk in parallel). */
  cores: number
  name: string
  enginePath: string
  dataDir: string
  workerId: string
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
  server?: string
  token?: string
  cores?: number
  name?: string
  enginePath?: string
}

/** What a caller knows better than the repository layout (the portable package: the engine next to the exe). */
export interface ConfigDefaults {
  enginePath?: string | undefined
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
  mkdirSync(dataDir(), { recursive: true })
  writeFileSync(
    configFile(),
    `${JSON.stringify(config, null, 2)}
`,
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
  const cores = Number(env.TCG_WORKER_CORES ?? fromFile.cores ?? Math.min(8, availableParallelism()))
  return {
    server: (env.TCG_SERVER ?? fromFile.server ?? 'https://tcg-pocket.fly.dev').replace(/\/+$/, ''),
    token,
    cores: Number.isInteger(cores) && cores > 0 ? cores : 2,
    name: env.TCG_WORKER_NAME ?? fromFile.name ?? hostname(),
    enginePath: env.TCG_ENGINE_PATH ?? fromFile.enginePath ?? defaults.enginePath ?? defaultEnginePath(),
    dataDir: dir,
    workerId: readFileSync(idFile, 'utf8').trim(),
  }
}
