import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { launcherScript } from '../src/autostart.js'
import { installs, olderVersion } from '../src/bootstrap.js'
import type { FileConfig } from '../src/config.js'
import { prompter } from '../src/portable.js'
import { executableOf, type RunningWorker, runSetup, type SetupDeps, SetupInterrupted } from '../src/setup.js'

describe('worker setup (D-026, after the 11/10 migration)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reads every answer of a redirected stdin in order, and Enter for the ones that are missing', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    // All the answers arrive at once, before the first question (a file redirected to stdin).
    input.end('tcg_wk_test\n8\nRyzen\n')
    const prompt = prompter(input, output)
    expect(await prompt.ask('token: ')).toBe('tcg_wk_test')
    expect(await prompt.ask('hilos: ')).toBe('8')
    expect(await prompt.ask('nombre: ')).toBe('Ryzen')
    // EOF: Enter, never a hang or a crash.
    expect(await prompt.ask('¿Lo detengo? ')).toBe('')
    expect(await prompt.ask('Enter para cerrar.')).toBe('')
    prompt.close()
  })

  it('the launcher carries a data folder chosen with TCG_WORKER_DIR (a worker started at logon has no other way)', () => {
    vi.stubEnv('TCG_WORKER_DIR', '')
    const plain = launcherScript(['C:\\w\\tcg-worker.exe', '--run'])
    expect(plain).toBe(
      'Set shell = CreateObject("WScript.Shell")\r\nshell.Run """C:\\w\\tcg-worker.exe"" ""--run""", 0, False\r\n',
    )
    vi.stubEnv('TCG_WORKER_DIR', 'C:\\data "x"')
    const custom = launcherScript(['C:\\w\\tcg-worker.exe', '--run'])
    expect(custom).toContain('shell.Environment("Process")("TCG_WORKER_DIR") = "C:\\data ""x"""\r\n')
    expect(custom.indexOf('Environment')).toBeLessThan(custom.indexOf('shell.Run'))
  })

  it('setup and --uninstall never run with code older than the executable', () => {
    expect(installs([])).toBe(true)
    expect(installs(['--setup', '--keep'])).toBe(true)
    expect(installs(['--uninstall'])).toBe(true)
    expect(installs(['--child'])).toBe(false)
    expect(installs(['--check'])).toBe(false)
    expect(olderVersion('0.3.0', '0.3.2')).toBe(true)
    expect(olderVersion('0.3.2', '0.3.2')).toBe(false)
    expect(olderVersion('0.3.10', '0.3.2')).toBe(false)
    expect(olderVersion('0.4.0', '0.3.9')).toBe(false)
    expect(olderVersion(undefined, '0.3.2')).toBe(true)
  })

  it('Ctrl+C is not Enter: a waiting question throws, and so does every later one', async () => {
    const input = new PassThrough()
    const prompt = prompter(input, new PassThrough())
    const waiting = prompt.ask('token: ')
    prompt.interrupt()
    await expect(waiting).rejects.toBeInstanceOf(SetupInterrupted)
    await expect(prompt.ask('hilos: ')).rejects.toBeInstanceOf(SetupInterrupted)
  })
})

/** The PC as setup sees it, recording what it does (`events`, in order). */
function fakePc(options: {
  config?: FileConfig
  check?: boolean
  installFails?: boolean
  starts?: boolean
  oldComesBack?: boolean
  answers?: string[]
  interruptDuringCheck?: boolean
  /** Putting the launchers and the configuration back throws (an antivirus holding a .vbs). */
  putBackThrows?: boolean
  /** The new worker takes the lock after the wait gave up on it. */
  lateWorker?: boolean
}) {
  const events: string[] = []
  let configText: string | null = options.config ? JSON.stringify(options.config) : null
  let interrupted = false
  const answers = [...(options.answers ?? [])]
  let waits = 0
  let stopped = false
  const accepted: boolean[] = []
  const deps: SetupDeps = {
    log: () => undefined,
    ask: options.answers ? async () => answers.shift() ?? '' : null,
    interrupted: () => interrupted,
    holdInterrupts: (hold) => events.push(hold ? 'hold' : 'release'),
    readConfig: () => (configText ? (JSON.parse(configText) as FileConfig) : {}),
    configText: () => configText,
    writeConfigText: (text) => {
      events.push(text === null ? 'config:delete' : `config:${JSON.parse(text).token ?? '?'}`)
      if (options.putBackThrows && events.includes('start:launch.vbs')) throw new Error('EBUSY')
      configText = text
    },
    configPath: 'config.json',
    check: async (config) => {
      events.push(`check:${config.token}`)
      if (options.interruptDuringCheck) interrupted = true
      return options.check ?? true
    },
    owners: () => ({
      workers:
        stopped && options.lateWorker
          ? [{ pid: 99, line: '"C:\\new\\tcg-worker.exe" --run' }]
          : stopped
            ? []
            : [
                { pid: 10, line: '"C:\\old\\tcg-worker.exe" --run' },
                { pid: 11, line: 'C:\\old\\tcg-worker.exe --child' },
              ],
      stale: [],
    }),
    releaseLock: (lock) => events.push(`release-lock:${lock}`),
    stop: async (pid) => {
      events.push(`stop:${pid}`)
      if (pid === 11) stopped = true
    },
    install: () => {
      events.push('install')
      if (options.installFails) throw new Error('schtasks y la carpeta Inicio fallaron')
      return {
        launcher: 'launch.vbs',
        restore: () => {
          events.push('restore-launchers')
          if (options.putBackThrows) throw new Error('EBUSY: launch.vbs')
        },
      }
    },
    start: (launcher) => events.push(`start:${launcher}`),
    restart: (line) => events.push(`restart:${line}`),
    waitForWorker: async (accept) => {
      waits++
      // What the setup would accept as «the old one is back»: the old supervisor, not the late new one.
      if (waits > 1) {
        const candidates: RunningWorker[] = [
          { pid: 99, line: '"C:\\new\\tcg-worker.exe" --run' },
          { pid: 12, line: '"C:\\old\\tcg-worker.exe" --run' },
        ]
        accepted.push(...candidates.map(accept))
      }
      return waits === 1 ? (options.starts ?? true) : (options.oldComesBack ?? true)
    },
    maxThreads: 20,
    hostname: 'pc',
    defaultServer: 'https://app.test',
  }
  return { deps, events, config: () => configText, accepted }
}

describe('setup order (revisión del #63): never a PC without a worker', () => {
  const saved = { token: 'tcg_wk_old', cores: 18, name: 'PC', enginePath: 'C:/repo/engine-cli.exe' }

  it('checks the candidate before touching anything, then switches: stop, start, see it hold the lock', async () => {
    const pc = fakePc({ config: saved })
    expect(await runSetup(pc.deps, { keep: true })).toBe(0)
    expect(pc.events).toEqual([
      'check:tcg_wk_old',
      'config:tcg_wk_old',
      'install',
      'hold',
      'stop:10',
      'stop:11',
      'start:launch.vbs',
      'release',
    ])
    // The old enginePath is gone; token, threads and name stay.
    expect(JSON.parse(pc.config() ?? '{}')).toMatchObject({ token: 'tcg_wk_old', cores: 18, name: 'PC' })
    expect(JSON.parse(pc.config() ?? '{}').enginePath).toBeUndefined()
  })

  it('a failed check (a wrong token) changes nothing: no config saved, nothing stopped', async () => {
    const pc = fakePc({ config: saved, answers: ['tcg_wk_wrong', '', ''], check: false })
    expect(await runSetup(pc.deps, { keep: false })).toBe(1)
    expect(pc.events).toEqual(['check:tcg_wk_wrong'])
    expect(JSON.parse(pc.config() ?? '{}').token).toBe('tcg_wk_old')
  })

  it('Ctrl+C during the check (it returns as if it passed) changes nothing', async () => {
    const pc = fakePc({ config: saved, interruptDuringCheck: true })
    expect(await runSetup(pc.deps, { keep: true })).toBe(1)
    expect(pc.events).toEqual(['check:tcg_wk_old'])
  })

  it('a failure after the old worker stopped puts everything back and starts the old supervisor (only it) again', async () => {
    const pc = fakePc({ config: saved, starts: false })
    expect(await runSetup(pc.deps, { keep: true })).toBe(1)
    expect(pc.events).toEqual([
      'check:tcg_wk_old',
      'config:tcg_wk_old',
      'install',
      'hold',
      'stop:10',
      'stop:11',
      'start:launch.vbs',
      'restore-launchers',
      `config:tcg_wk_old`,
      'restart:"C:\\old\\tcg-worker.exe" --run',
      'release',
    ])
    // The configuration file is the one from before, byte for byte (with its enginePath).
    expect(JSON.parse(pc.config() ?? '{}').enginePath).toBe('C:/repo/engine-cli.exe')
  })

  it('the launchers failing to install puts the configuration back and stops nothing', async () => {
    const pc = fakePc({ config: saved, installFails: true })
    expect(await runSetup(pc.deps, { keep: true })).toBe(1)
    expect(pc.events).toEqual(['check:tcg_wk_old', 'config:tcg_wk_old', 'install', 'config:tcg_wk_old'])
    expect(pc.events.some((event) => event.startsWith('stop'))).toBe(false)
  })

  it('--keep without a saved token does nothing at all', async () => {
    const pc = fakePc({ config: { cores: 4 } })
    expect(await runSetup(pc.deps, { keep: true })).toBe(1)
    expect(pc.events).toEqual([])
  })

  it('answering «n» to stopping the old worker changes nothing', async () => {
    const pc = fakePc({ config: saved, answers: ['', '', '', 'n'] })
    expect(await runSetup(pc.deps, { keep: false })).toBe(1)
    expect(pc.events).toEqual([])
  })

  it('a candidate prepared inside a packaged app (--from) is checked and saved like typed answers', async () => {
    const pc = fakePc({ config: saved })
    expect(await runSetup(pc.deps, { keep: true, from: { token: 'tcg_wk_new', cores: 6 } })).toBe(0)
    expect(pc.events.slice(0, 2)).toEqual(['check:tcg_wk_new', 'config:tcg_wk_new'])
    expect(JSON.parse(pc.config() ?? '{}')).toMatchObject({ token: 'tcg_wk_new', cores: 6, name: 'PC' })
  })

  it('putting things back can fail (a .vbs held by an antivirus): the old worker still comes back', async () => {
    const pc = fakePc({ config: saved, starts: false, putBackThrows: true })
    expect(await runSetup(pc.deps, { keep: true })).toBe(1)
    expect(pc.events.slice(-3)).toEqual(['config:tcg_wk_old', 'restart:"C:\\old\\tcg-worker.exe" --run', 'release'])
  })

  it('a new worker that took the lock late is stopped before the old one comes back, and is not taken for it', async () => {
    const pc = fakePc({ config: saved, starts: false, lateWorker: true })
    expect(await runSetup(pc.deps, { keep: true })).toBe(1)
    const restart = pc.events.indexOf('restart:"C:\\old\\tcg-worker.exe" --run')
    expect(pc.events.indexOf('stop:99')).toBeGreaterThan(-1)
    expect(pc.events.indexOf('stop:99')).toBeLessThan(restart)
    // The late new one (99) is not «the old one back»; the old supervisor's executable is.
    expect(pc.accepted).toEqual([false, true])
  })

  it('tells executables apart by the first token of a command line, quoted or not', () => {
    expect(executableOf('"C:\\Program Files\\w\\tcg-worker.exe"  "--run"')).toBe('c:\\program files\\w\\tcg-worker.exe')
    expect(executableOf('C:\\w\\tcg-worker.exe --child')).toBe('c:\\w\\tcg-worker.exe')
  })
})
