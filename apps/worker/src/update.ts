/**
 * The worker that updates itself (Fase 42, D-026, decided by Santiago on 11/10/2026: trust the server). Every
 * managed install (the Windows portable package and the Android one) asks the app which package it serves for its
 * platform; when the sha256 differs from the one it runs, it downloads it with its worker token, checks the sum,
 * unpacks it next to the others (`releases/<sha256>`) and runs the new release's own engine check in a separate
 * process. Only then does the worker stop claiming, finish what it is playing, switch the pointer and exit with
 * `RESTART_FOR_UPDATE`; its supervisor starts it again on the new release. A release that fails the check, or that
 * exits with an error before it was ever ready, is marked bad and the previous one is used again.
 *
 * Layout under `releases/`: one folder per package (its sha256), `current.json` (the release to start and the one it
 * replaced), `<sha256>.bad` (why it is not used). In a release: `verified` (passed its check here) and `healthy` (got
 * to «worker listo» at least once).
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Log, PackageInfo, WorkerClient } from './client.js'
import { DETERMINISM_MISMATCH } from './determinism.js'

export type Platform = 'windows-x64' | 'android-arm64'

/** The exit code of a worker that switched to a new release: its supervisor starts it again (EX_TEMPFAIL). */
export const RESTART_FOR_UPDATE = 75
/** How often a running worker asks for a new package (also on start and when the queue asks for another engine). */
export const UPDATE_INTERVAL_MS = 10 * 60_000
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024
const CHECK_TIMEOUT_MS = 5 * 60_000
/** A release check that fails without a mismatch (timeout, crash) is tried this many times before giving up. */
const CHECK_ATTEMPTS = 3
const SHA256 = /^[0-9a-f]{64}$/

/** `releases/current.json`. `sha: null` is the code built into tcg-worker.exe (Windows); `base` names that build. */
export interface Pointer {
  sha: string | null
  previous: string | null
  base?: string
}

/** A managed install: where its releases live, which one runs and how the next one is checked and chosen. */
export interface Installation {
  platform: Platform
  releases: string
  /** The release this process runs; null when it runs the code built into the executable. */
  current: string | null
  /** The offline check of a release (engine version and determinism), run in its own process. */
  checkCommand(dir: string): { command: string; args: string[]; env?: Record<string, string> }
  /** Makes `sha` the release the next start runs (null: the built-in code), remembering `previous`. */
  activate(sha: string | null, previous: string | null): void
}

export type ReadyRelease = PackageInfo & { sha256: string }

export function readPointer(releases: string): Pointer | null {
  try {
    const pointer = JSON.parse(readFileSync(join(releases, 'current.json'), 'utf8')) as Pointer
    const valid = (sha: unknown) => sha === null || (typeof sha === 'string' && SHA256.test(sha))
    return valid(pointer.sha) && valid(pointer.previous ?? null)
      ? { sha: pointer.sha, previous: pointer.previous ?? null, ...(pointer.base ? { base: pointer.base } : {}) }
      : null
  } catch {
    return null
  }
}

/** Written next to the file and renamed over it: a start never reads half a pointer. */
export function writePointer(releases: string, pointer: Pointer): void {
  mkdirSync(releases, { recursive: true })
  const file = join(releases, 'current.json')
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(pointer, null, 2)}\n`)
  renameSync(temporary, file)
}

export const isHealthy = (releases: string, sha: string) => existsSync(join(releases, sha, 'healthy'))
export const isBad = (releases: string, sha: string) => existsSync(join(releases, `${sha}.bad`))

export function markBad(releases: string, sha: string, reason: string): void {
  mkdirSync(releases, { recursive: true })
  writeFileSync(join(releases, `${sha}.bad`), `${JSON.stringify({ reason, at: new Date().toISOString() })}\n`)
}

/**
 * Windows: the releases sit in the data folder and `current.json` says which one `tcg-worker.exe` loads. `base` is
 * the build of the executable that wrote it: a zip installed by hand later (another build) starts on its own code.
 */
export function windowsInstallation(dataDir: string, releaseDir: string | null, base: string): Installation {
  const releases = join(dataDir, 'releases')
  return {
    platform: 'windows-x64',
    releases,
    current: releaseDir ? basename(releaseDir) : null,
    checkCommand: (dir) => ({ command: process.execPath, args: ['--check-engine'], env: { TCG_WORKER_RELEASE: dir } }),
    activate: (sha, previous) => writePointer(releases, { sha, previous, base }),
  }
}

/**
 * Android (T-015): the installer unpacks each package in `releases/<sha256>` and points the `current` symlink at it;
 * the launcher runs `current/worker.mjs`. Null outside that layout (a copy run by hand): no updates there.
 */
export function androidInstallation(releaseDir: string): Installation | null {
  const releases = dirname(releaseDir)
  if (basename(releases) !== 'releases' || !SHA256.test(basename(releaseDir))) return null
  const link = join(dirname(releases), 'current')
  return {
    platform: 'android-arm64',
    releases,
    current: basename(releaseDir),
    checkCommand: (dir) => ({ command: process.execPath, args: [join(dir, 'worker.mjs'), '--check-engine'] }),
    activate: (sha, previous) => {
      if (!sha) throw new Error('Android siempre corre un paquete bajado.')
      writePointer(releases, { sha, previous })
      // A new link renamed over the old one; Windows (only the tests) cannot rename over a directory link.
      const temporary = `${link}.${process.pid}.tmp`
      rmSync(temporary, { force: true, recursive: true })
      symlinkSync(join(releases, sha), temporary, process.platform === 'win32' ? 'junction' : 'dir')
      try {
        renameSync(temporary, link)
      } catch (error) {
        if (process.platform !== 'win32') throw error
        unlinkSync(link)
        renameSync(temporary, link)
      }
    },
  }
}

/**
 * For a supervisor, after its worker exited with an error: if the release it ran never got to «worker listo», mark it
 * bad and go back to the one before (true: start the worker again). A release that worked once is not rolled back.
 */
export function rollBackUnhealthy(installation: Pick<Installation, 'releases' | 'activate'>, log: Log): boolean {
  const pointer = readPointer(installation.releases)
  if (!pointer?.sha || isHealthy(installation.releases, pointer.sha) || pointer.previous === pointer.sha) return false
  // Only Windows has built-in code to go back to (its pointers carry `base`); Android needs a previous release.
  if (pointer.previous === null && !pointer.base) return false
  markBad(installation.releases, pointer.sha, 'terminó con error antes de quedar listo')
  installation.activate(pointer.previous, null)
  log('la versión nueva no arrancó: vuelvo a la anterior', {
    failed: pointer.sha.slice(0, 12),
    back: pointer.previous?.slice(0, 12) ?? 'la del ejecutable',
  })
  return true
}

/** Runs a command to its end; resolves with its exit code and the end of its output (for the log). */
export function runProcess(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; timeoutMs: number; signal?: AbortSignal },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    const keep = (data: Buffer) => {
      output = (output + data.toString('utf8')).slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const stop = () => child.kill()
    const timer = setTimeout(stop, options.timeoutMs)
    options.signal?.addEventListener('abort', stop, { once: true })
    child.once('error', (error) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
      resolve({ code, output: output.trim() })
    })
  })
}

/** Code is taken only over HTTPS (D-026), or from this same machine (tests, a local API). */
export function updatesAllowedFrom(server: string): boolean {
  return /^https:\/\//i.test(server) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(server)
}

/** Windows' own bsdtar (Git's GNU tar, first in some PATHs, does not take `C:` paths); Termux's tar on Android. */
function tarCommand(): string {
  return process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
}

export class Updater {
  /** A verified release waiting for the worker to stop between chunks. */
  ready: ReadyRelease | null = null
  /** Tests shorten it. */
  intervalMs = UPDATE_INTERVAL_MS
  private running: Promise<ReadyRelease | null> | null = null
  private readonly reported = new Set<string>()

  constructor(
    readonly installation: Installation,
    private readonly client: WorkerClient,
    private readonly log: Log,
  ) {}

  /**
   * Asks the server and, when it offers another package, prepares it. Resolves with the release ready to switch to,
   * or null. Never rejects: a failed attempt is logged and the next check tries again. One check at a time.
   */
  check(signal?: AbortSignal): Promise<ReadyRelease | null> {
    this.running ??= this.checkOnce(signal).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async checkOnce(signal?: AbortSignal): Promise<ReadyRelease | null> {
    const { releases, current, platform } = this.installation
    try {
      const info = await this.client.packageInfo(platform, signal)
      const sha = info.sha256
      // A server from before D-026 does not say which package it serves.
      if (!sha || !SHA256.test(sha)) return null
      if (sha === current) {
        this.ready = null
        return null
      }
      if (this.ready?.sha256 === sha) return this.ready
      if (isBad(releases, sha)) {
        if (!this.reported.has(sha)) {
          this.reported.add(sha)
          this.log('el servidor ofrece una versión que ya falló acá; sigo con la actual', {
            package: sha.slice(0, 12),
            reason: readFileSync(join(releases, `${sha}.bad`), 'utf8')
              .trim()
              .slice(0, 300),
          })
        }
        return null
      }
      await this.stage(sha, info, signal)
      this.ready = { ...info, sha256: sha }
      this.log('versión nueva lista: cambio cuando termine lo que estoy jugando', {
        package: sha.slice(0, 12),
        worker: info.workerVersion ?? null,
        engine: info.cliVersion,
      })
      return this.ready
    } catch (error) {
      if (!signal?.aborted) {
        this.log('no se pudo preparar la versión nueva; reintento más tarde', { error: String(error).slice(0, 500) })
      }
      return null
    }
  }

  /** Download, sum, unpack and the release's own engine check, all before anything else changes. */
  private async stage(sha: string, info: PackageInfo, signal?: AbortSignal): Promise<void> {
    const { releases, platform } = this.installation
    const dir = join(releases, sha)
    if (existsSync(join(dir, 'verified'))) return
    mkdirSync(releases, { recursive: true })
    const partial = join(releases, `${sha}.partial`)
    const unpack = join(releases, `${sha}.tmp`)
    await rm(dir, { recursive: true, force: true })
    try {
      const limit = info.size && info.size > 0 ? Math.min(info.size, MAX_PACKAGE_BYTES) : MAX_PACKAGE_BYTES
      const got = await this.client.download(platform, partial, limit, signal)
      if (got.sha256 !== sha || (got.announced !== null && got.announced !== sha)) {
        // A deploy between the two requests, most likely: the next check sees the new sum.
        throw new Error('la descarga no coincide con la suma anunciada')
      }
      await rm(unpack, { recursive: true, force: true })
      mkdirSync(unpack, { recursive: true })
      const tar = await runProcess(tarCommand(), ['-xzf', partial, '-C', unpack], {
        timeoutMs: CHECK_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      })
      if (tar.code !== 0) throw new Error(`no se pudo desempaquetar (${tar.code}): ${tar.output}`)
      if (!existsSync(join(unpack, 'tcg-worker'))) throw new Error('el paquete no trae la carpeta tcg-worker')
      renameSync(join(unpack, 'tcg-worker'), dir)
    } finally {
      await rm(partial, { force: true })
      await rm(unpack, { recursive: true, force: true })
    }
    const { command, args, env } = this.installation.checkCommand(dir)
    const check = await runProcess(command, args, {
      timeoutMs: CHECK_TIMEOUT_MS,
      ...(env ? { env } : {}),
      ...(signal ? { signal } : {}),
    })
    if (signal?.aborted) throw new Error('detenido')
    if (check.code !== 0) {
      await rm(dir, { recursive: true, force: true })
      // Another engine, or other games for the same seeds: never this package. A timeout on a busy PC or a crash
      // could pass next time, so only after a few tries.
      const attempts = join(releases, `${sha}.attempts`)
      const tried = (existsSync(attempts) ? Number(readFileSync(attempts, 'utf8')) || 0 : 0) + 1
      if (check.code === DETERMINISM_MISMATCH || tried >= CHECK_ATTEMPTS) {
        markBad(releases, sha, `la prueba del motor falló (${check.code}): ${check.output.slice(-500)}`)
        rmSync(attempts, { force: true })
      } else writeFileSync(attempts, String(tried))
      throw new Error(`la versión nueva no pasó la prueba del motor (${check.code}): ${check.output.slice(-300)}`)
    }
    rmSync(join(releases, `${sha}.attempts`), { force: true })
    writeFileSync(join(dir, 'verified'), `${new Date().toISOString()}\n`)
  }

  /** The next start runs the ready release; the one running now stays as the way back. */
  activate(): ReadyRelease {
    const ready = this.ready
    if (!ready) throw new Error('No hay una versión nueva lista.')
    this.installation.activate(ready.sha256, this.installation.current)
    return ready
  }

  /** «worker listo» on this release: from now on an error exit does not roll it back. */
  markHealthy(): void {
    const { releases, current } = this.installation
    if (current && !isHealthy(releases, current)) {
      writeFileSync(join(releases, current, 'healthy'), `${new Date().toISOString()}\n`)
    }
  }

  /** Leftovers of cut downloads and releases nobody points at any more (the current one and the way back stay). */
  cleanup(): void {
    const { releases, current } = this.installation
    if (!existsSync(releases)) return
    const keep = new Set([current, readPointer(releases)?.sha, readPointer(releases)?.previous, this.ready?.sha256])
    for (const entry of readdirSync(releases)) {
      const sha = entry.replace(/\.(partial|tmp)$/, '')
      if (!SHA256.test(sha)) continue
      if (entry !== sha || !keep.has(sha)) {
        try {
          rmSync(join(releases, entry), { recursive: true, force: true })
        } catch {
          // In use (Windows keeps a running engine's folder): next time.
        }
      }
    }
  }
}
