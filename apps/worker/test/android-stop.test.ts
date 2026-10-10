import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { stopAndroidWorker } from '../src/android-stop.js'

const execute = promisify(execFile)

it.skipIf(process.platform === 'win32')(
  'Android --stop handles missing/stale locks and refuses another process',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tcg-stop-'))
    const entry = join(dir, 'worker.mjs')
    try {
      await build({
        entryPoints: [join(import.meta.dirname, '../src/android.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node24',
        outfile: entry,
      })
      const stop = () => execute(process.execPath, [entry, '--stop'], { env: { ...process.env, TCG_WORKER_DIR: dir } })
      expect((await stop()).stdout).toContain('No hay un worker corriendo')
      await writeFile(join(dir, 'worker.lock'), '2147483647')
      expect((await stop()).stdout).toContain('No hay un worker corriendo')
      await expect(readFile(join(dir, 'worker.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(join(dir, 'worker.lock'), String(process.pid))
      await expect(stop()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('otro proceso') })
      expect(await readFile(join(dir, 'worker.lock'), 'utf8')).toBe(String(process.pid))
      await writeFile(join(dir, 'worker.lock'), 'invalid')
      await expect(stop()).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Lock inválido') })
      await mkdir(join(dir, 'android'))
      await writeFile(join(dir, 'android/worker.lock'), String(process.pid))
      await expect(
        execute(process.execPath, [entry], {
          env: { ...process.env, TCG_WORKER_DIR: dir, TCG_WORKER_TOKEN: 'tcg_wk_test' },
        }),
      ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Ya hay un lanzador Android corriendo') })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'stop waits for both cleanups and validates all holders before signalling',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tcg-stop-pair-'))
    const entry = join(dir, 'worker.mjs')
    await mkdir(join(dir, 'android'))
    const stopper = join(dir, 'download/worker.mjs')
    await build({
      entryPoints: [join(import.meta.dirname, '../src/android.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      outfile: stopper,
    })
    await writeFile(
      entry,
      `
import fs from 'node:fs';
const lock = process.argv[2];
process.on('SIGTERM', () => setTimeout(() => { fs.unlinkSync(lock); process.exit(0); }, 150));
fs.writeFileSync(lock, String(process.pid));
console.log('ready');
setInterval(() => {}, 1000);
`,
    )
    const child = spawn(process.execPath, [entry, join(dir, 'worker.lock')], { stdio: ['ignore', 'pipe', 'pipe'] })
    const supervisor = spawn(process.execPath, [entry, join(dir, 'android/worker.lock')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const exited = once(child, 'exit')
    const supervisorExited = once(supervisor, 'exit')
    try {
      if (!child.stdout || !supervisor.stdout || !child.pid || !supervisor.pid) throw new Error('no child process')
      await Promise.all([once(child.stdout, 'data'), once(supervisor.stdout, 'data')])
      // An unrelated child lock must prevent signalling even the valid supervisor.
      await writeFile(join(dir, 'worker.lock'), String(process.pid))
      await expect(stopAndroidWorker(dir, entry)).rejects.toThrow('otro proceso')
      process.kill(supervisor.pid, 0)
      process.kill(child.pid, 0)
      await writeFile(join(dir, 'worker.lock'), String(child.pid))
      await expect(stopAndroidWorker(dir, entry, 0)).rejects.toThrow('no se detuvo a tiempo')
      expect(await readFile(join(dir, 'worker.lock'), 'utf8')).toBe(String(child.pid))
      const stopped = await execute(process.execPath, [stopper, '--stop'], {
        env: { ...process.env, TCG_WORKER_DIR: dir, TCG_ANDROID_WORKER_ENTRY: entry },
      })
      expect(stopped.stdout).toContain('Worker detenido')
      await Promise.all([exited, supervisorExited])
      expect(await stopAndroidWorker(dir, entry)).toContain('No hay un worker')
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      if (supervisor.exitCode === null) supervisor.kill('SIGKILL')
      await rm(dir, { recursive: true, force: true })
    }
  },
)
