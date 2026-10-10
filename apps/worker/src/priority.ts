import { constants, setPriority } from 'node:os'
import type { Log } from './client.js'

export type EnginePriority = 'below_normal' | 'normal' | 'idle'

const levels: Record<EnginePriority, number> = {
  below_normal: constants.priority.PRIORITY_BELOW_NORMAL,
  normal: constants.priority.PRIORITY_NORMAL,
  idle: constants.priority.PRIORITY_LOW,
}

/** Apply immediately after spawn, before the engine builds its thread pool. Never changes the worker's priority. */
export function setEnginePriority(pid: number | undefined, priority: EnginePriority, log: Log): void {
  // A failed spawn has no PID; its own error handler reports the failure.
  if (pid === undefined) return
  try {
    setPriority(pid, levels[priority])
  } catch (error) {
    log('no se pudo cambiar la prioridad del motor; sigo con la heredada', {
      pid,
      priority,
      error: String(error).slice(0, 500),
    })
  }
}
