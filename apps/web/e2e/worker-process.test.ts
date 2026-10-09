import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stopWorker } from './worker-process.ts'

test('waits for the worker final write before removing its directory', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tcg-screens-shutdown-'))
  // stdin EOF stands in for SIGTERM so the delayed shutdown is reproducible on Windows too.
  const worker = spawn(
    process.execPath,
    [
      '-e',
      `
    const fs = require('node:fs')
    process.stdin.resume()
    process.stdin.on('end', () => setTimeout(() => {
      fs.writeFileSync(process.argv[1] + '/last-write', 'done')
      process.stdout.write('final write done')
    }, 100))
    process.stdout.write('ready')
  `,
      dir,
    ],
    { windowsHide: true },
  )
  const kill = worker.kill.bind(worker)
  t.after(async () => {
    if (worker.exitCode === null && worker.signalCode === null) kill('SIGKILL')
    await rm(dir, { recursive: true, force: true, maxRetries: 5 })
  })
  await once(worker.stdout, 'data')
  worker.kill = () => {
    worker.stdin.end()
    return true
  }
  let output = ''
  worker.stdout.on('data', (data) => {
    output += String(data)
  })
  await stopWorker(worker, dir)
  assert.equal(worker.exitCode, 0)
  assert.equal(output, 'final write done')
  assert.equal(existsSync(dir), false)
})

test('cleans up when the worker has already exited and tolerates a missing directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tcg-screens-shutdown-'))
  await writeFile(join(dir, 'state.json'), '{}')
  const worker = spawn(process.execPath, ['-e', ''], { windowsHide: true })
  await once(worker, 'close')
  await stopWorker(worker, dir)
  await stopWorker(null, dir)
  assert.equal(existsSync(dir), false)
})
