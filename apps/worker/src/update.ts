/**
 * The worker that updates itself (Fase 42, D-026, decided by Santiago on 11/10/2026: trust the server). Every
 * managed install (the Windows portable package and the Android one) asks the app which package it serves for its
 * platform; when the sha256 differs from the one it runs, it downloads it with its worker token, checks the sum,
 * unpacks it next to the others (`releases/<sha256>`) and runs the new release's own engine check in a separate
 * process. Only then does the worker stop claiming, finish what it is playing, switch the pointer and exit with
 * `RESTART_FOR_UPDATE`; its supervisor starts it again on the new release.
 *
 * Failures (revisión del #50): every failed attempt to prepare a package waits longer before the next one (5 min,
 * doubling, up to 6 h), so a cut download never turns into a loop of 15 MB downloads. A package whose engine plays
 * differently (exit 3) is never used; other failures (a timeout on a busy PC, a crash) only after a few tries, and
 * then for 24 h. A new release that cannot start is tried three times before going back to the previous one; a
 * process killed by a signal (Android's phantom process killer) does not count.
 *
 * Layout under `releases/`: one folder per package (its sha256), `current.json` (the release to start and the one it
 * replaced), `<sha256>.attempts` (failed preparations and when to try again), `<sha256>.starts` (failed starts) and
 * `<sha256>.bad` (why it is not used, and whether that expires). In a release: `verified` (passed its check here)
 * and `healthy` (got to «worker listo» at least once).
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeSync,
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
/** Never asks the server more often than this, whatever wakes it (the queue's engine, Android's 409). */
const MIN_CHECK_GAP_MS = 60_000
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024
/** Three determinism cases of up to 2 minutes each, plus the engine's start. */
const CHECK_TIMEOUT_MS = 10 * 60_000
/** A failed preparation waits this long before the next one, doubling up to the cap. */
const RETRY_BASE_MS = 5 * 60_000
const RETRY_MAX_MS = 6 * 60 * 60_000
/** A release check that fails without a mismatch (timeout, crash) is tried this many times before giving up. */
const CHECK_ATTEMPTS = 3
/** A new release that exits with an error before it is ready is started this many times before rolling back. */
const START_ATTEMPTS = 3
/** How long a release that failed without playing differently stays out. */
const BAD_FOR_MS = 24 * 60 * 60_000
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

/** Written, flushed to disk and closed: a power cut never leaves `verified` or a pointer that lies. */
export function writeDurable(file: string, data: string): void {
  const fd = openSync(file, 'w')
  try {
    writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Every file of a freshly unpacked release on disk before it is marked verified. */
function syncTree(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) syncTree(path)
    else if (entry.isFile()) {
      const fd = openSync(path, 'r+')
      try {
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    }
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function readPointer(releases: string): Pointer | null {
  const pointer = readJson<Pointer>(join(releases, 'current.json'))
  if (!pointer) return null
  const valid = (sha: unknown) => sha === null || (typeof sha === 'string' && SHA256.test(sha))
  return valid(pointer.sha) && valid(pointer.previous ?? null)
    ? { sha: pointer.sha, previous: pointer.previous ?? null, ...(pointer.base ? { base: pointer.base } : {}) }
    : null
}

/** Written next to the file and renamed over it: a start never reads half a pointer. */
export function writePointer(releases: string, pointer: Pointer): void {
  mkdirSync(releases, { recursive: true })
  const file = join(releases, 'current.json')
  const temporary = `${file}.${process.pid}.tmp`
  writeDurable(temporary, `${JSON.stringify(pointer, null, 2)}\n`)
  renameSync(temporary, file)
}

export const isHealthy = (releases: string, sha: string) => existsSync(join(releases, sha, 'healthy'))

interface BadMark {
  reason: string
  at: string
  /** The engine plays differently (or is another one): no amount of waiting changes it. */
  permanent?: boolean
}

/** Why a release is out, while it is (a mark that is not permanent expires after a day, and then it is removed). */
export function badMark(releases: string, sha: string, now = Date.now()): BadMark | null {
  const file = join(releases, `${sha}.bad`)
  if (!existsSync(file)) return null
  // A mark that cannot be read still counts, from the file's own date.
  const mark = readJson<Partial<BadMark>>(file) ?? {}
  const at = Number.isNaN(Date.parse(mark.at ?? '')) ? statSync(file).mtimeMs : Date.parse(mark.at ?? '')
  if (mark.permanent || now - at < BAD_FOR_MS) {
    return {
      reason: mark.reason ?? 'marcada a mano',
      at: new Date(at).toISOString(),
      ...(mark.permanent ? { permanent: true } : {}),
    }
  }
  rmSync(file, { force: true })
  return null
}

export const isBad = (releases: string, sha: string) => badMark(releases, sha) !== null

export function markBad(releases: string, sha: string, reason: string, permanent = false): void {
  mkdirSync(releases, { recursive: true })
  const mark: BadMark = { reason, at: new Date().toISOString(), ...(permanent ? { permanent } : {}) }
  writeDurable(join(releases, `${sha}.bad`), `${JSON.stringify(mark)}\n`)
}

/** A counter next to the releases (`<sha>.<kind>`): failed preparations or failed starts. */
function bump(releases: string, sha: string, kind: 'attempts' | 'starts', retryInMs = 0) {
  const file = join(releases, `${sha}.${kind}`)
  const failures = (readJson<{ failures: number }>(file)?.failures ?? 0) + 1
  const retryAt = new Date(Date.now() + retryInMs).toISOString()
  mkdirSync(releases, { recursive: true })
  writeDurable(file, `${JSON.stringify({ failures, retryAt })}\n`)
  return failures
}

/**
 * Windows: the releases sit in the data folder and `current.json` says which one `tcg-worker.exe` loads. `base` is
 * the build of the executable that wrote it: a zip installed by hand later (another build) starts on its own code,
 * and its first check downloads the app's package again (the app always decides).
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
 * For a supervisor, after its worker exited with an error: whether to start it again. A signal (the phantom process
 * killer, an unplugged charger killing Termux) ends it as before and counts for nothing. On a release that never got
 * to «worker listo»: a different engine (exit 3) goes back to the previous release at once and is never used again;
 * any other error starts the same release again, up to three times, and only then goes back to the previous one (for
 * a day). A release that worked once is not rolled back.
 */
export function afterFailedStart(
  installation: Pick<Installation, 'releases' | 'activate'>,
  exit: { code: number | null; signal?: string | null },
  log: Log,
): 'restart' | 'stop' {
  if (exit.signal || exit.code === 0) return 'stop'
  const pointer = readPointer(installation.releases)
  const sha = pointer?.sha
  if (!pointer || !sha || isHealthy(installation.releases, sha)) return 'stop'
  // Only Windows has built-in code to go back to (its pointers carry `base`); Android needs a previous release.
  const canGoBack = pointer.previous !== sha && (pointer.previous !== null || Boolean(pointer.base))
  const mismatch = exit.code === DETERMINISM_MISMATCH
  const starts = mismatch ? START_ATTEMPTS : bump(installation.releases, sha, 'starts')
  if (starts < START_ATTEMPTS) {
    log('la versión nueva terminó con error antes de quedar lista; la vuelvo a probar', {
      package: sha.slice(0, 12),
      code: exit.code,
      attempt: starts,
    })
    return 'restart'
  }
  if (!canGoBack) return 'stop'
  markBad(
    installation.releases,
    sha,
    mismatch ? 'el motor juega distinto que la referencia' : `no arrancó en ${START_ATTEMPTS} intentos (${exit.code})`,
    mismatch,
  )
  rmSync(join(installation.releases, `${sha}.starts`), { force: true })
  installation.activate(pointer.previous, null)
  log('la versión nueva no arrancó: vuelvo a la anterior', {
    failed: sha.slice(0, 12),
    back: pointer.previous?.slice(0, 12) ?? 'la del ejecutable',
    for: mismatch ? 'siempre' : '24 h',
  })
  return 'restart'
}

/**
 * How long a supervisor waits before starting its worker again: a moment after an update, half a minute after a
 * failure, and ten minutes once it restarted five times in ten minutes (something is wrong; never a tight loop).
 */
export class RestartPacer {
  private readonly starts: number[] = []

  delayMs(reason: 'update' | 'failure', now = Date.now()): number {
    while (this.starts.length > 0 && now - (this.starts[0] ?? now) > 10 * 60_000) this.starts.shift()
    this.starts.push(now)
    if (this.starts.length > 5) return 10 * 60_000
    return reason === 'update' ? 2_000 : 30_000
  }
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
      // Its own process group on POSIX, so a timeout stops its engine too.
      detached: process.platform !== 'win32',
    })
    let output = ''
    const keep = (data: Buffer) => {
      output = (output + data.toString('utf8')).slice(-2000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    // The whole tree: an engine left running would keep the release folder locked (Windows) and the CPU busy.
    const stop = () => {
      if (child.pid === undefined || child.exitCode !== null) return
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
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

/** A preparation that failed and when the next one may run. */
class StageError extends Error {
  constructor(
    message: string,
    readonly mismatch = false,
    readonly checkFailed = false,
  ) {
    super(message)
  }
}

export class Updater {
  /** A verified release waiting for the worker to stop between chunks. */
  ready: ReadyRelease | null = null
  /** Tests shorten it. */
  intervalMs = UPDATE_INTERVAL_MS
  /** Tests set it to 0. */
  minCheckGapMs = MIN_CHECK_GAP_MS
  private running: Promise<ReadyRelease | null> | null = null
  private lastCheckAt = 0
  /** The package the server offered last time (the one a wait applies to). */
  private offered: string | null = null
  private readonly reported = new Set<string>()

  constructor(
    readonly installation: Installation,
    private readonly client: WorkerClient,
    private readonly log: Log,
  ) {}

  /**
   * Asks the server and, when it offers another package, prepares it. Resolves with the release ready to switch to,
   * or null. Never rejects: a failed attempt is logged and waits before the next one. One check at a time, and at
   * most one question to the server a minute.
   */
  check(signal?: AbortSignal): Promise<ReadyRelease | null> {
    if (!this.running && Date.now() - this.lastCheckAt < this.minCheckGapMs) return Promise.resolve(this.ready)
    this.running ??= this.checkOnce(signal).finally(() => {
      this.running = null
      this.lastCheckAt = Date.now()
    })
    return this.running
  }

  /** How long until the offered package may be tried again (0: no wait pending). */
  retryInMs(now = Date.now()): number {
    if (!this.offered) return 0
    const attempts = readJson<{ retryAt?: string }>(join(this.installation.releases, `${this.offered}.attempts`))
    return Math.max(0, attempts?.retryAt ? Date.parse(attempts.retryAt) - now : 0)
  }

  /** What `--check` shows: the offered package, if it is out, and why. */
  status(): { offered: string | null; bad: BadMark | null; retryInMs: number } {
    const bad = this.offered ? badMark(this.installation.releases, this.offered) : null
    return { offered: this.offered, bad, retryInMs: this.retryInMs() }
  }

  private once(key: string, message: string, data: Record<string, unknown>): void {
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.log(message, data)
  }

  private async checkOnce(signal?: AbortSignal): Promise<ReadyRelease | null> {
    const { releases, current, platform } = this.installation
    let sha: string | undefined
    try {
      const info = await this.client.packageInfo(platform, signal)
      sha = info.sha256
      // A server from before D-026 does not say which package it serves.
      if (!sha || !SHA256.test(sha)) return null
      this.offered = sha
      if (sha === current) {
        this.ready = null
        return null
      }
      if (this.ready?.sha256 === sha) return this.ready
      const bad = badMark(releases, sha)
      if (bad) {
        this.once(`bad:${sha}`, 'el servidor ofrece una versión que no se usa acá; sigo con la actual', {
          package: sha.slice(0, 12),
          reason: bad.reason.slice(0, 300),
          until: bad.permanent ? 'otra versión de la app' : new Date(Date.parse(bad.at) + BAD_FOR_MS).toISOString(),
        })
        return null
      }
      const wait = this.retryInMs()
      if (wait > 0) {
        const until = new Date(Date.now() + wait).toISOString()
        this.once(`wait:${sha}:${until.slice(0, 16)}`, 'espero para volver a probar la versión nueva', {
          package: sha.slice(0, 12),
          until,
        })
        return null
      }
      await this.stage(sha, info, signal)
      rmSync(join(releases, `${sha}.attempts`), { force: true })
      this.ready = { ...info, sha256: sha }
      this.log('versión nueva lista: cambio cuando termine lo que estoy jugando', {
        package: sha.slice(0, 12),
        worker: info.workerVersion ?? null,
        engine: info.cliVersion,
      })
      return this.ready
    } catch (error) {
      if (signal?.aborted) return null
      if (sha && SHA256.test(sha)) this.failed(sha, error)
      else this.log('no se pudo preguntar por la versión nueva', { error: String(error).slice(0, 300) })
      return null
    }
  }

  /** Every failed preparation waits longer; a different engine is out for good, a failing check for a day. */
  private failed(sha: string, error: unknown): void {
    const { releases } = this.installation
    const tries = readJson<{ failures: number }>(join(releases, `${sha}.attempts`))?.failures ?? 0
    const failures = bump(releases, sha, 'attempts', Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** tries))
    const stage = error instanceof StageError ? error : null
    if (stage?.mismatch || (stage?.checkFailed && failures >= CHECK_ATTEMPTS)) {
      markBad(releases, sha, stage.message.slice(0, 500), stage.mismatch)
      rmSync(join(releases, `${sha}.attempts`), { force: true })
    }
    this.log('no se pudo preparar la versión nueva; reintento más tarde', {
      package: sha.slice(0, 12),
      attempt: failures,
      minutes: Math.round(this.retryInMs() / 60_000),
      error: String(error).slice(0, 500),
    })
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
        throw new StageError('la descarga no coincide con la suma anunciada')
      }
      await rm(unpack, { recursive: true, force: true })
      mkdirSync(unpack, { recursive: true })
      const tar = await runProcess(tarCommand(), ['-xzf', partial, '-C', unpack], {
        timeoutMs: CHECK_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      })
      if (tar.code !== 0) throw new StageError(`no se pudo desempaquetar (${tar.code}): ${tar.output}`)
      if (!existsSync(join(unpack, 'tcg-worker'))) throw new StageError('el paquete no trae la carpeta tcg-worker')
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
      throw new StageError(
        `la prueba del motor falló (${check.code}): ${check.output.slice(-400)}`,
        check.code === DETERMINISM_MISMATCH,
        true,
      )
    }
    syncTree(dir)
    writeDurable(join(dir, 'verified'), `${new Date().toISOString()}\n`)
  }

  /** The next start runs the ready release; the one running now stays as the way back. */
  activate(): ReadyRelease {
    const ready = this.ready
    if (!ready) throw new Error('No hay una versión nueva lista.')
    this.installation.activate(ready.sha256, this.installation.current)
    return ready
  }

  /** Whether the release that runs already got to «worker listo» (the built-in code always counts as such). */
  currentIsHealthy(): boolean {
    const { releases, current } = this.installation
    return !current || isHealthy(releases, current)
  }

  /** «worker listo» on this release: from now on an error exit does not roll it back. */
  markHealthy(): void {
    const { releases, current } = this.installation
    if (current && !isHealthy(releases, current)) {
      writeDurable(join(releases, current, 'healthy'), `${new Date().toISOString()}\n`)
      rmSync(join(releases, `${current}.starts`), { force: true })
    }
  }

  /** Leftovers of cut downloads and releases nobody points at any more (the current one and the way back stay). */
  cleanup(): void {
    const { releases, current } = this.installation
    if (!existsSync(releases)) return
    const pointer = readPointer(releases)
    const keep = new Set([current, pointer?.sha, pointer?.previous, this.ready?.sha256])
    for (const entry of readdirSync(releases)) {
      const sha = entry.replace(/\.(partial|tmp)$/, '')
      if (!SHA256.test(sha)) continue
      if (entry !== sha || (!keep.has(sha) && statSync(join(releases, entry)).isDirectory())) {
        try {
          rmSync(join(releases, entry), { recursive: true, force: true })
        } catch {
          // In use (Windows keeps a running engine's folder): next time.
        }
      }
    }
  }
}
