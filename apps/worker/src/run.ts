/**
 * The worker's run modes, shared by `dist/main.js` (this repository) and the portable `tcg-worker.exe` (Fase 21):
 *   (no flag)   run until stopped (Ctrl+C); what the logon task starts
 *   --once      play at most one chunk and exit
 *   --check     show configuration, engine and server reachability, then exit
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { ApiError, WorkerClient } from './client.js'
import { type ConfigDefaults, loadConfig } from './config.js'
import { checkDeterminism } from './determinism.js'
import { engineVersion } from './engine.js'
import { acquireLock, releaseLock } from './lock.js'
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

export async function run(argv: readonly string[], defaults: ConfigDefaults = {}): Promise<void> {
  const args = new Set(argv)
  const config = loadConfig(process.env, defaults)
  const log = logger(join(config.dataDir, 'worker.log'))
  const client = new WorkerClient(config.server, config.token, log)
  if (defaults.determinismPath) {
    await checkDeterminism(config.enginePath, defaults.determinismPath, config.dataDir)
    const reference = JSON.parse(readFileSync(defaults.determinismPath, 'utf8')) as {
      version: { engineRev: string; cliVersion: string }
    }
    client.requiredEngine = reference.version
    const required = await client.request<{ engineRev: string; cliVersion: string }>(
      'GET',
      '/api/worker/packages/android-arm64/version',
      undefined,
      { once: true, timeoutMs: 15_000 },
    )
    if (required.engineRev !== reference.version.engineRev || required.cliVersion !== reference.version.cliVersion) {
      throw new Error('Cambió el motor del servidor. Volvé a correr el instalador Android antes de tomar trabajo.')
    }
    log('determinismo verificado contra la PC')
  }
  if (args.has('--check')) {
    const version = await engineVersion(config.enginePath)
    log('configuración', {
      server: config.server,
      cores: config.cores,
      name: config.name,
      enginePath: config.enginePath,
      engineRev: version.engineRev,
      cards: version.cards,
      dataDir: config.dataDir,
    })
    const ping = await client.request<{ ok: boolean; token: { name: string } }>('GET', '/api/worker/ping')
    log('servidor alcanzable', { token: ping.token.name })
    return
  }
  const running = acquireLock(config.dataDir)
  if (running !== null) {
    log('ya hay un worker corriendo en esta carpeta; no arranco otro', { pid: running })
    return
  }
  process.on('exit', () => releaseLock(config.dataDir))
  const worker = new Worker(config, client, log)
  await worker.cleanWorkDir()
  const controller = new AbortController()
  const stop = () => {
    log('deteniendo el worker')
    controller.abort(new Error('detenido'))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  const once = args.has('--once')
  // Supervisor: an unexpected error restarts the loop a minute later (the logon task does not restart the process);
  // a token the app rejects stops it for good.
  try {
    for (;;) {
      try {
        await worker.loop(controller.signal, { once })
        return
      } catch (error) {
        if (controller.signal.aborted) return
        if (once) throw error
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error
        if (defaults.determinismPath && error instanceof ApiError && error.status === 409) throw error
        log('el worker falló; vuelvo a empezar en 60 s', { error: String(error).slice(0, 500) })
        await sleep(60_000, undefined, { signal: controller.signal }).catch(() => undefined)
      }
    }
  } finally {
    controller.abort()
    await client.release(config.workerId).catch(() => log('sin conexión al liberar leases; vencen en 3 minutos'))
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    releaseLock(config.dataDir)
  }
}
