import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

const lockFiles = ['android/worker.lock', 'worker.lock']
const missing = (error: unknown) => ['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')

/** Check every lock before signalling either process. Never force-kill: cleanup may still be releasing leases. */
export async function stopAndroidWorker(dir: string, entry: string, timeoutMs = 35_000): Promise<string> {
  if (!entry) throw new Error('Falta la ruta de worker.mjs; no detengo ningún proceso.')
  const holders: { lock: string; pid: number }[] = []
  for (const file of lockFiles) {
    const lock = join(dir, file)
    try {
      const pid = Number(readFileSync(lock, 'utf8').trim())
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Lock inválido; no detengo ningún proceso.')
      let command: string[]
      try {
        command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
      } catch (error) {
        if (!missing(error)) throw error
        // Remove only the stale lock we inspected, not a replacement written during the check.
        if (Number(readFileSync(lock, 'utf8').trim()) === pid) unlinkSync(lock)
        continue
      }
      if (!command.includes(entry)) throw new Error('El PID del lock corresponde a otro proceso; no lo detengo.')
      holders.push({ lock, pid })
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  if (!holders.length) return 'No hay un worker corriendo.'
  for (const { lock, pid } of holders) {
    try {
      // Recheck identity immediately before SIGTERM (a PID or lock may have been reused).
      if (Number(readFileSync(lock, 'utf8').trim()) !== pid)
        throw new Error('Cambió el lock; volvé a detener el worker.')
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(entry))
        throw new Error('El PID del lock corresponde a otro proceso; no lo detengo.')
      process.kill(pid, 'SIGTERM')
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  const deadline = Date.now() + timeoutMs
  while (true) {
    const pending = lockFiles.some((file) => {
      try {
        readFileSync(join(dir, file), 'utf8')
        return true
      } catch (error) {
        if (!missing(error)) throw error
        return false
      }
    })
    if (!pending) return 'Worker detenido. Si la devolución de leases falló, vencen en hasta 3 minutos.'
    if (Date.now() >= deadline)
      throw new Error('El worker no se detuvo a tiempo; no fuerzo el apagado. Revisá worker.log.')
    await wait(100)
  }
}
