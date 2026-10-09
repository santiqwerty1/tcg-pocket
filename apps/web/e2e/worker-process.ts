import type { ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'

/** A signal starts shutdown; close means the worker has finished its final writes and closed its pipes. */
export async function stopWorker(worker: ChildProcess | null): Promise<void> {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => worker.kill('SIGKILL'), 5_000)
      worker.once('close', () => {
        clearTimeout(force)
        resolve()
      })
      worker.kill()
    })
  }
}

/** Called after shutdown and after attaching any diagnostics from the worker's folder. */
export async function removeWorkerDir(dir: string): Promise<void> {
  if (dir) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((error: unknown) => {
      // A leftover test folder should not turn a passing screen flow into a failure (or hide the original error).
      console.warn(`No se pudo limpiar el worker de pantallas (${dir}): ${String(error)}`)
    })
  }
}
