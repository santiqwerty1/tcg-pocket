/**
 * The CPU regulator's side in the worker (Windows, engine feature `regulate`; pedido de Santi del 14/10/2026). It
 * starts `engine-cli regulate`, which gives the simulation engines every logical processor while nothing else needs
 * them and whole cores back at once when another program does, and tells it the engines that start and end.
 *
 * - What it allows goes to the log when it changes, at most a line every `logEveryMs` (the latest one waits), and to
 *   `regulator.json` in the data folder, which `--check` shows.
 * - If it ends on its own, it starts again (at most `MAX_STARTS_PER_HOUR`), and the engines running are told to it
 *   again; one that cannot run on this machine (exit 2, such as more than 64 logical processors) is not started again.
 *   After the last start, one short run gives the engines running the whole machine back (review of #106).
 * - With an engine that has `regulatePing` (engine-cli 0.3.11), it asks every minute whether the regulator still reads
 *   its lines; one that does not answer is cut and started again (review of #106: a hung one went unnoticed).
 *   When the worker stops, its stdin closes: every engine gets the whole machine back and it ends.
 * - Its mask is sized from the whole machine, not from `cores` (the threads of each engine): with nothing else
 *   running the engines keep every processor, as without it (autorrevisión).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Log } from './client.js'

export type EngineKind = 'managed' | 'own'

interface EngineListener {
  started(pid: number, kind: EngineKind): void
  ended(pid: number): void
}

let listener: EngineListener | null = null

/** Who hears of the engines' processes (the regulator, while it runs). */
export function watchEngines(next: EngineListener | null): void {
  listener = next
}

/** An engine process started: `managed` (a job, regulated) or `own` (a live game, counted as ours only). */
export function engineStarted(pid: number | undefined, kind: EngineKind): void {
  if (pid !== undefined) listener?.started(pid, kind)
}

export function engineEnded(pid: number | undefined): void {
  if (pid !== undefined) listener?.ended(pid)
}

/** What the regulator allows now, as `regulator.json` keeps it. */
export interface RegulatorState {
  allowed: number
  total: number
  foreign: number
  mask: string
  at: string
}

/** A line of the regulator: `permitido <n> de <total> ajena <load> mascara <hex>`. */
export function parseAllowed(line: string, at: Date): RegulatorState | null {
  const match = /^permitido (\d+) de (\d+) ajena ([\d.]+) mascara ([0-9a-f]+)$/.exec(line.trim())
  if (!match) return null
  return {
    allowed: Number(match[1]),
    total: Number(match[2]),
    foreign: Number(match[3]),
    mask: match[4] as string,
    at: at.toISOString(),
  }
}

export const MAX_STARTS_PER_HOUR = 5

export interface RegulatorOptions {
  enginePath: string
  /** The most logical processors the engines get (`--max`); without it, the whole machine. */
  max?: number
  floor?: number
  dataDir: string
  log: Log
  /** A line in the log when what it allows changes, at most this often (the latest one waits). */
  logEveryMs?: number
  /** Before starting again after it ended on its own. */
  restartAfterMs?: number
  /** Its sample, in ms (tests make it short). */
  everyMs?: number
  /** How long `stop()` waits for it to end before killing it. */
  stopTimeoutMs?: number
  /** Its engine answers `ping` (`regulatePing`): check it every `pingEveryMs`, cut it after `pingTimeoutMs` without an answer. */
  ping?: boolean
  pingEveryMs?: number
  pingTimeoutMs?: number
}

export class CpuRegulator implements EngineListener {
  private child: ChildProcess | null = null
  private readonly engines = new Map<number, EngineKind>()
  private starts: number[] = []
  private stopping = false
  private restart: ReturnType<typeof setTimeout> | null = null
  private logTimer: ReturnType<typeof setTimeout> | null = null
  private lastLogAt = 0
  private pending: RegulatorState | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  /** When the unanswered `ping` went (null: none waits). */
  private pingSentAt: number | null = null
  /** What it allows now (null before its first change). */
  state: RegulatorState | null = null

  constructor(private readonly options: RegulatorOptions) {}

  private get stateFile(): string {
    return join(this.options.dataDir, 'regulator.json')
  }

  start(): void {
    if (this.stopping) return
    const now = Date.now()
    this.starts = this.starts.filter((at) => now - at < 3_600_000)
    if (this.starts.length >= MAX_STARTS_PER_HOUR) {
      this.options.log('el regulador de CPU terminó muchas veces: no lo arranco más hasta reiniciar el worker', {
        starts: this.starts.length,
      })
      this.giveMachineBack()
      return
    }
    this.starts.push(now)
    const [command, prefix] = this.command()
    const args = [
      ...prefix,
      'regulate',
      ...(this.options.max !== undefined ? ['--max', String(this.options.max)] : []),
      '--floor',
      String(this.options.floor ?? 2),
      ...(this.options.everyMs ? ['--every-ms', String(this.options.everyMs)] : []),
    ]
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    child.stdin?.on('error', () => undefined)
    // What it said of an error: its JSON on stdout and the end of its stderr (`fin error 2`).
    let said = ''
    let stderr = ''
    let buffer = ''
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (buffer + chunk).split(/\r?\n/)
      buffer = (lines.pop() ?? '').slice(-1000)
      for (const line of lines) {
        if (line.startsWith('{')) said = line.slice(0, 500)
        else this.read(line)
      }
    })
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-500)
    })
    child.on('error', (error) => this.options.log('no pude arrancar el regulador de CPU', { error: error.message }))
    child.on('close', (code) => {
      if (this.child === child) {
        this.child = null
        this.stopPings()
      }
      if (this.stopping) return
      const error = said || stderr.trim() || undefined
      // An input error is this machine's (more than one processor group, its cores unreadable): it would end again.
      if (code === 2) {
        this.options.log('el regulador de CPU no puede correr en esta máquina: sigo sin él', { code, error })
        return
      }
      this.options.log('el regulador de CPU terminó: lo vuelvo a arrancar', { code, error })
      this.restart = setTimeout(() => {
        this.restart = null
        this.start()
      }, this.options.restartAfterMs ?? 10_000)
      this.restart.unref()
    })
    // The engines running now: a regulator started again knows them too.
    for (const [pid, kind] of this.engines) this.send(`add ${pid} ${kind}`)
    if (this.options.ping) this.startPings(child)
  }

  /** `engine-cli regulate`, or the fake engine of the tests run with this Node. */
  private command(): [string, string[]] {
    const { enginePath } = this.options
    return /\.m?js$/.test(enginePath) ? [process.execPath, [enginePath]] : [enginePath, []]
  }

  /** A `ping` every `pingEveryMs`; a regulator that leaves one without `pong` for `pingTimeoutMs` is cut (and started again). */
  private startPings(child: ChildProcess): void {
    this.stopPings()
    const every = this.options.pingEveryMs ?? 60_000
    const timeout = this.options.pingTimeoutMs ?? 15_000
    this.pingTimer = setInterval(
      () => {
        if (this.child !== child) return
        if (this.pingSentAt !== null) {
          if (Date.now() - this.pingSentAt < timeout) return
          this.options.log('el regulador de CPU no contesta: lo corto', {
            seconds: Math.round((Date.now() - this.pingSentAt) / 1000),
          })
          this.pingSentAt = null
          child.kill()
          return
        }
        this.pingSentAt = Date.now()
        this.send('ping')
      },
      Math.min(every, timeout),
    )
    this.pingTimer.unref()
  }

  private stopPings(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    this.pingSentAt = null
  }

  /**
   * After the last start: one short run told the engines running and closed at once, which gives each the whole machine
   * back (a regulator starts them all at its maximum and gives the machine back when its stdin ends). Without it they
   * kept the mask they had until their chunk ended (review of #106).
   */
  private giveMachineBack(): void {
    const managed = [...this.engines].filter(([, kind]) => kind === 'managed').map(([pid]) => pid)
    if (managed.length === 0) return
    const [command, prefix] = this.command()
    const child = spawn(command, [...prefix, 'regulate', '--floor', '1'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    })
    child.on('error', () => undefined)
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(managed.map((pid) => `add ${pid} managed\n`).join(''))
    this.options.log('devuelvo la máquina entera a los motores en marcha', { engines: managed.length })
  }

  private send(line: string): void {
    const stdin = this.child?.stdin
    if (stdin && !stdin.destroyed) stdin.write(`${line}\n`)
  }

  private read(line: string): void {
    if (line === 'pong') {
      this.pingSentAt = null
      return
    }
    if ((line.startsWith('regulador ') && line !== 'regulador terminado') || line.startsWith('aviso ')) {
      this.options.log('regulador de CPU', { said: line })
      return
    }
    const state = parseAllowed(line, new Date())
    if (!state) return
    this.state = state
    try {
      writeFileSync(this.stateFile, `${JSON.stringify(state)}\n`)
    } catch {
      // --check only reads it; nothing depends on it
    }
    this.pending = state
    this.flushLog()
  }

  /** The latest change, at most a line every `logEveryMs`. */
  private flushLog(): void {
    if (!this.pending || this.logTimer) return
    const every = this.options.logEveryMs ?? 60_000
    const wait = this.lastLogAt + every - Date.now()
    if (wait > 0) {
      this.logTimer = setTimeout(() => {
        this.logTimer = null
        this.flushLog()
      }, wait)
      this.logTimer.unref()
      return
    }
    const state = this.pending
    this.pending = null
    this.lastLogAt = Date.now()
    this.options.log('CPU para los motores', {
      allowed: state.allowed,
      total: state.total,
      foreign: state.foreign,
    })
  }

  started(pid: number, kind: EngineKind): void {
    this.engines.set(pid, kind)
    this.send(`add ${pid} ${kind}`)
  }

  ended(pid: number): void {
    if (!this.engines.delete(pid)) return
    this.send(`remove ${pid}`)
  }

  /** Closes its stdin (every engine gets the whole machine back) and waits for it to end. */
  async stop(): Promise<void> {
    this.stopping = true
    this.stopPings()
    if (this.restart) clearTimeout(this.restart)
    if (this.logTimer) clearTimeout(this.logTimer)
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      const done = setTimeout(() => {
        child.kill()
        resolve()
      }, this.options.stopTimeoutMs ?? 5_000)
      child.once('close', () => {
        clearTimeout(done)
        resolve()
      })
      child.stdin?.end()
    })
  }
}
