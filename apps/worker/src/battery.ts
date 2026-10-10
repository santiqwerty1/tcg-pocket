import { setTimeout as sleep } from 'node:timers/promises'

/** FULL and plugged-but-NOT_CHARGING count too. Unknown status fails closed. */
export function isPluggedIn(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const plugged = (value as { plugged?: unknown }).plugged
  return (
    typeof plugged === 'string' && ['PLUGGED_AC', 'PLUGGED_USB', 'PLUGGED_WIRELESS', 'PLUGGED_DOCK'].includes(plugged)
  )
}

export interface ChargingControls {
  charging: () => Promise<boolean>
  start: () => Promise<void>
  stop: () => Promise<void>
  wait?: (signal: AbortSignal) => Promise<unknown>
}

/** Stops gracefully on unplug; a new process resumes pending results when power returns. */
export async function whileCharging(controls: ChargingControls, signal: AbortSignal): Promise<void> {
  let running = false
  try {
    while (!signal.aborted) {
      const charging = await controls.charging().catch(() => false)
      if (signal.aborted) break
      if (charging && !running) {
        await controls.start()
        running = true
      } else if (!charging && running) {
        await controls.stop()
        running = false
      }
      await (controls.wait?.(signal) ?? sleep(15_000, undefined, { signal })).catch(() => undefined)
    }
  } finally {
    if (running) await controls.stop()
  }
}
