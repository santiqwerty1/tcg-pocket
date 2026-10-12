/**
 * What /proc says about a running engine and the machine's memory, on Linux and Android (Termux) only; nothing
 * elsewhere. For the S25 of 12/10/2026: its engine stopped at 699–954 of 1000 games and exited 0 without a result,
 * so the worker notes how the process was treated (its OOM score at the start, its memory and the phone's while it
 * plays) to tell an Android kill from the engine's own doing.
 */
import { readFileSync } from 'node:fs'

export const PROBE_EVERY_MS = 5 * 60_000

export function procAvailable(): boolean {
  return process.platform === 'linux' || process.platform === 'android'
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** `MemAvailable` of /proc/meminfo, in MB. */
export function parseMemAvailableMb(meminfo: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo)
  return match ? Math.round(Number(match[1]) / 1024) : null
}

export interface ProcessSample {
  state: string | null
  rssMb: number | null
  hwmMb: number | null
  threads: number | null
}

/** The fields of /proc/<pid>/status that say how a process is doing. */
export function parseStatus(status: string): ProcessSample {
  const field = (name: string) => new RegExp(`^${name}:\\s+(.+)$`, 'm').exec(status)?.[1]?.trim() ?? null
  const mb = (value: string | null) => {
    const kb = value ? /^(\d+)\s+kB$/.exec(value)?.[1] : undefined
    return kb === undefined ? null : Math.round(Number(kb) / 1024)
  }
  const threads = field('Threads')
  return {
    state: field('State'),
    rssMb: mb(field('VmRSS')),
    hwmMb: mb(field('VmHWM')),
    threads: threads === null ? null : Number(threads),
  }
}

/** Once, right after the engine starts: how likely the system is to kill it first. */
export function probeStart(pid: number): Record<string, unknown> | null {
  if (!procAvailable()) return null
  const number = (path: string) => {
    const text = read(path)?.trim()
    return text === undefined || text === '' ? null : Number(text)
  }
  return {
    oomScore: number(`/proc/${pid}/oom_score`),
    oomScoreAdj: number(`/proc/${pid}/oom_score_adj`),
    memAvailableMb: parseMemAvailableMb(read('/proc/meminfo') ?? ''),
  }
}

/** Every few minutes while it plays: its memory, its threads and what the machine has left. */
export function probeSample(pid: number): (ProcessSample & { memAvailableMb: number | null }) | null {
  if (!procAvailable()) return null
  const status = read(`/proc/${pid}/status`)
  if (status === null) return null
  return { ...parseStatus(status), memAvailableMb: parseMemAvailableMb(read('/proc/meminfo') ?? '') }
}
