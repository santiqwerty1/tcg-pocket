#!/usr/bin/env node
// Fixed CPU work on every logical processor, at normal priority (measurement only).
import { pbkdf2Sync } from 'node:crypto'
import { availableParallelism, constants, getPriority, setPriority } from 'node:os'
import { performance } from 'node:perf_hooks'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

if (!isMainThread) {
  const gate = new Int32Array(workerData)
  parentPort.postMessage('ready')
  Atomics.wait(gate, 0, 0)
  const hash = pbkdf2Sync('priority-measurement', 'D-023', 20_000_000, 32, 'sha256')
  parentPort.postMessage(hash.toString('hex'))
} else {
  setPriority(process.pid, constants.priority.PRIORITY_NORMAL)
  const gate = new SharedArrayBuffer(4)
  const workers = Array.from(
    { length: availableParallelism() },
    () => new Worker(new URL(import.meta.url), { workerData: gate }),
  )
  const done = workers.map(
    (worker) =>
      new Promise((res, rej) => {
        worker.on('error', rej)
        worker.on('exit', (code) => (code === 0 ? res() : rej(new Error(`worker exit ${code}`))))
      }),
  )
  await Promise.all(workers.map((worker) => new Promise((res) => worker.once('message', res))))
  console.log(JSON.stringify({ ready: true, threads: workers.length, priority: getPriority() }))
  const started = performance.now()
  Atomics.store(new Int32Array(gate), 0, 1)
  Atomics.notify(new Int32Array(gate), 0)
  await Promise.all(done)
  console.log(JSON.stringify({ durationMs: Math.round(performance.now() - started), iterationsPerThread: 20_000_000 }))
}
