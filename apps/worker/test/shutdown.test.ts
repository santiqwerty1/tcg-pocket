import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { stopAndroidWorker } from '../src/android-stop.js'

// Windows does not deliver POSIX SIGTERM to Node. Run this test on Linux (CI's Android Docker stage).
it.skipIf(process.platform === 'win32').each([false, true])(
  'SIGTERM releases leases without reporting failure (startup offline: %s)',
  async (offline) => {
    const dir = await mkdtemp(join(tmpdir(), 'tcg-shutdown-'))
    const entry = join(dir, 'worker.mjs')
    await build({
      entryPoints: [join(import.meta.dirname, '../src/main.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: entry,
      target: 'node24',
    })
    let released = false,
      failed = false,
      output = ''
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/api/worker/engine-status') {
        if (offline) {
          response.statusCode = 503
          response.end('{}')
        } else response.end('{"cards":2}')
      } else if (request.url === '/api/worker/release') {
        released = true
        response.end('{"chunks":1,"games":0}')
      } else if (request.url?.endsWith('/failure')) {
        failed = true
        response.end('{}')
      } else if (request.url === '/api/worker/live/claim') {
        const timeout = setTimeout(() => response.end('{"game":null}'), 1000)
        response.once('close', () => clearTimeout(timeout))
      } else if (request.url === '/api/worker/claim')
        response.end(
          JSON.stringify({
            chunk: {
              chunkId: 1,
              jobId: 1,
              kind: 'matrix',
              idx: 0,
              games: 99,
              firstGame: 0,
              seed: '1',
              players: ['r', 'r'],
              threads: null,
              replaySample: 0,
              deckA: 'x',
              deckB: 'y',
              optimize: null,
            },
            retryAfterSeconds: 0,
          }),
        )
      else response.end('{}')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no port')
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        TCG_WORKER_DIR: dir,
        TCG_WORKER_TOKEN: 'tcg_wk_test',
        TCG_SERVER: `http://127.0.0.1:${address.port}`,
        TCG_ENGINE_PATH: join(import.meta.dirname, 'fake-engine.mjs'),
        TCG_WORKER_CORES: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })
    child.stderr.on('data', (data: Buffer) => {
      output += data.toString()
    })
    try {
      await expect
        .poll(() => output.includes(offline ? 'servidor no disponible' : 'chunk reclamado'), { timeout: 10_000 })
        .toBe(true)
      // Wait until the fake engine has actually spawned (it will play forever).
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(await stopAndroidWorker(dir, entry)).toContain('Worker detenido')
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`shutdown hung: ${output}`)), 12_000)
          timer.unref()
        }),
      ])
      expect(released).toBe(true)
      expect(failed).toBe(false)
      expect(existsSync(join(dir, 'worker.lock'))).toBe(false)
      expect(output).not.toContain('tcg_wk_test')
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      server.closeAllConnections()
      server.close()
      await rm(dir, { recursive: true, force: true })
    }
  },
  30_000,
)
