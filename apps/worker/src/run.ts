/**
 * The worker's run modes, shared by `dist/main.js` (this repository) and the portable `tcg-worker.exe` (Fase 21):
 *   (no flag)   run until stopped (Ctrl+C); what the logon task starts
 *   --once      play at most one chunk and exit
 *   --check     show configuration, engine and server reachability, then exit
 * A managed install (D-026) also follows the app's package: `run` resolves with `RESTART_FOR_UPDATE` once it switched
 * to a new release, and the caller's supervisor starts the worker again.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { ApiError, WorkerClient } from './client.js'
import { type ConfigDefaults, loadConfig } from './config.js'
import { checkDeterminism } from './determinism.js'
import { engineVersion } from './engine.js'
import { acquireLock, releaseLock } from './lock.js'
import { badMark, type Installation, RESTART_FOR_UPDATE, Updater, updatesAllowedFrom } from './update.js'
import { WORKER_VERSION } from './version.js'
import { Worker } from './worker.js'

export function logger(file: string) {
  return (message: string, data: Record<string, unknown> = {}) => {
    const line = `${new Date().toISOString()} ${message}${Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : ''}`
    console.log(line)
    try {
      appendFileSync(file, `${line}\n`)
    } catch {
      // A log that cannot be written must not stop the worker.
    }
  }
}

export interface RunOptions {
  /** D-026: where this process's releases live; without it (the repository's dist/main.js) nothing is updated. */
  installation?: Installation | null
}

/** What the running worker's CPU regulator allowed last (regulator.json), or null. */
function lastRegulatorState(dir: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, 'regulator.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Resolves with the process's exit code: 0, or `RESTART_FOR_UPDATE` after switching to a new release. */
export async function run(
  argv: readonly string[],
  defaults: ConfigDefaults = {},
  options: RunOptions = {},
): Promise<number> {
  const args = new Set(argv)
  const config = loadConfig(process.env, defaults)
  const log = logger(join(config.dataDir, 'worker.log'))
  const client = new WorkerClient(config.server, config.token, log)
  const controller = new AbortController()
  const installation = options.installation ?? null
  // D-026 trusts the server over HTTPS: code is never taken over plain HTTP, except from this same machine (tests).
  const secure = updatesAllowedFrom(config.server)
  if (installation && config.autoUpdate && !secure) {
    log('actualizaciones apagadas: el servidor no es HTTPS', { server: config.server })
  }
  const updater =
    installation && config.autoUpdate && secure && !args.has('--check') && !args.has('--once')
      ? new Updater(installation, client, log)
      : null
  let locked = false
  const stop = () => {
    log('deteniendo el worker')
    controller.abort(new Error('detenido'))
  }
  const onExit = () => {
    if (locked) releaseLock(config.dataDir)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('exit', onExit)
  let staleEngine = false
  try {
    if (defaults.determinismPath) {
      await checkDeterminism(
        config.enginePath,
        defaults.determinismPath,
        config.dataDir,
        controller.signal,
        defaults.determinismCheck,
      )
      const reference = JSON.parse(readFileSync(defaults.determinismPath, 'utf8')) as {
        version: { engineRev: string; cliVersion: string }
      }
      client.requiredEngine = reference.version
      const required = await client.request<{ engineRev: string; cliVersion: string }>(
        'GET',
        '/api/worker/packages/android-arm64/version',
        undefined,
        { once: args.has('--check'), timeoutMs: 15_000, signal: controller.signal },
      )
      if (required.engineRev !== reference.version.engineRev || required.cliVersion !== reference.version.cliVersion) {
        // With updates on, the app's package brings its engine (below, once this is the only worker here).
        if (!updater) {
          throw new Error('Cambió el motor del servidor. Volvé a correr el instalador Android antes de tomar trabajo.')
        }
        staleEngine = true
      } else log('determinismo verificado contra la PC')
    }
    if (args.has('--check')) {
      const version = await engineVersion(config.enginePath, controller.signal)
      log('configuración', {
        server: config.server,
        cores: config.cores,
        priority: config.priority,
        allowSlowBots: config.allowSlowBots,
        name: config.name,
        enginePath: config.enginePath,
        engineRev: version.engineRev,
        cards: version.cards,
        dataDir: config.dataDir,
      })
      // The CPU regulator: whether it runs here, and what it allowed last (regulator.json, from the running worker).
      const regulates =
        config.cpuRegulator && process.platform === 'win32' && (version.features ?? []).includes('regulate')
      log('regulador de CPU', {
        on: regulates,
        ...(config.cpuRegulator ? {} : { off: 'cpuRegulator: false' }),
        ...(regulates ? { max: config.cores, floor: 2, last: lastRegulatorState(config.dataDir) } : {}),
      })
      const ping = await client.request<{ ok: boolean; token: { name: string } }>(
        'GET',
        '/api/worker/ping',
        undefined,
        { once: true, timeoutMs: 15_000, signal: controller.signal },
      )
      log('servidor alcanzable', { token: ping.token.name })
      if (installation) {
        const offered = await client.packageInfo(installation.platform, controller.signal).catch(() => null)
        const bad = offered?.sha256 ? badMark(installation.releases, offered.sha256) : null
        log('actualizaciones', {
          autoUpdate: config.autoUpdate,
          worker: WORKER_VERSION,
          package: installation.current?.slice(0, 12) ?? 'el del ejecutable',
          server: offered?.sha256?.slice(0, 12) ?? null,
          serverWorker: offered?.workerVersion ?? null,
          upToDate: offered?.sha256 ? offered.sha256 === installation.current : null,
          // A package of the app that is not used here, and why (it expires after a day unless it played differently).
          ...(bad ? { notUsed: bad.reason, since: bad.at, forGood: bad.permanent === true } : {}),
        })
      }
      return controller.signal.aborted ? 130 : 0
    }
    const running = acquireLock(config.dataDir)
    if (running !== null) {
      log('ya hay un worker corriendo en esta carpeta; no arranco otro', { pid: running })
      return 0
    }
    locked = true
    if (updater) {
      updater.cleanup()
      // Before any work: a start on an old release switches right away. An Android whose engine the server no
      // longer has waits here for the new package instead of stopping (no network, a cut download).
      for (;;) {
        if (await updater.check(controller.signal)) return switchRelease(updater, log)
        if (!staleEngine || controller.signal.aborted) break
        const wait = Math.max(300_000, updater.retryInMs())
        log('el servidor tiene otro motor y su paquete todavía no está listo; espero', {
          minutes: Math.round(wait / 60_000),
        })
        await sleep(wait, undefined, { signal: controller.signal }).catch(() => undefined)
      }
    }
    const worker = new Worker(config, client, log)
    await worker.cleanWorkDir()
    const once = args.has('--once')
    // Supervisor: an unexpected error restarts the loop a minute later (the logon task does not restart the process);
    // a token the app rejects stops it for good.
    for (;;) {
      try {
        const outcome = await worker.loop(controller.signal, {
          once,
          updater,
          onReady: () => updater?.markHealthy(),
        })
        if (outcome === 'update' && updater) return switchRelease(updater, log)
        return 0
      } catch (error) {
        if (controller.signal.aborted) return 0
        if (once) throw error
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error
        if (defaults.determinismPath && error instanceof ApiError && error.status === 409) throw error
        // A new release that fails before it is ready (its engine, its code): out, so the supervisor counts it and,
        // after three, goes back to the previous one (D-026). Retrying here forever would never get there.
        if (updater && !updater.currentIsHealthy()) throw error
        log('el worker falló; vuelvo a empezar en 60 s', { error: String(error).slice(0, 500) })
        await sleep(60_000, undefined, { signal: controller.signal }).catch(() => undefined)
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error
    // An interrupted --check proved nothing: setup must not read it as a pass (revisión del #63).
    return args.has('--check') ? 130 : 0
  } finally {
    controller.abort()
    if (locked)
      await client.release(config.workerId).catch(() => log('sin conexión al liberar leases; vencen en 3 minutos'))
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    process.removeListener('exit', onExit)
    onExit()
  }
}

/** Points the next start at the ready release; the finally of `run` then hands the leases back. */
function switchRelease(updater: Updater, log: ReturnType<typeof logger>): number {
  const ready = updater.activate()
  log('reinicio con la versión nueva', {
    package: ready.sha256.slice(0, 12),
    worker: ready.workerVersion ?? null,
    engine: ready.cliVersion,
  })
  return RESTART_FOR_UPDATE
}
