#!/usr/bin/env node
/**
 * tcg-worker: simulation worker for the owner's PC (BRIEF §4, PLAN §3.7). Usage:
 *   node dist/main.js            run until stopped (Ctrl+C); what the logon task starts
 *   node dist/main.js --once     play at most one chunk and exit
 *   node dist/main.js --check    show configuration, engine and server reachability, then exit
 */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { ApiError, WorkerClient } from './client.js'
import { loadConfig } from './config.js'
import { engineVersion } from './engine.js'
import { acquireLock, releaseLock } from './lock.js'
import { Worker } from './worker.js'

function logger(file: string) {
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

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const config = loadConfig()
  const log = logger(join(config.dataDir, 'worker.log'))
  const client = new WorkerClient(config.server, config.token, log)
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
  for (;;) {
    try {
      await worker.loop(controller.signal, { once })
      return
    } catch (error) {
      if (controller.signal.aborted || once) throw error
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error
      log('el worker falló; vuelvo a empezar en 60 s', { error: String(error).slice(0, 500) })
      await sleep(60_000, undefined, { signal: controller.signal }).catch(() => undefined)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
