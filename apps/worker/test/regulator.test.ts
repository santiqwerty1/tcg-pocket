import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runJob } from '../src/engine.js'
import { CpuRegulator, MAX_STARTS_PER_HOUR, parseAllowed, watchEngines } from '../src/regulator.js'

const FAKE_ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'fake-engine.mjs')

/** Until `check` holds, or fails after `ms`. */
async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('no pasó a tiempo')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('the CPU regulator, on the worker side (pedido de Santi del 14/10/2026)', () => {
  let dir: string
  let heard: string
  const lines = () => {
    try {
      return readFileSync(heard, 'utf8').trim().split('\n')
    } catch {
      return []
    }
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tcg-regulator-'))
    heard = join(dir, 'heard.txt')
    vi.stubEnv('FAKE_REGULATE_LOG', heard)
  })
  afterEach(() => {
    watchEngines(null)
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads what the regulator allows', () => {
    const at = new Date('2026-10-14T19:00:00Z')
    expect(parseAllowed('permitido 12 de 20 ajena 8.2 mascara ffc00', at)).toEqual({
      allowed: 12,
      total: 20,
      foreign: 8.2,
      mask: 'ffc00',
      at: at.toISOString(),
    })
    expect(parseAllowed('regulador 20 logicos', at)).toBeNull()
    expect(parseAllowed('permitido x de 20 ajena 1 mascara f', at)).toBeNull()
  })

  it('tells it the engines that start and end, keeps what it allows, and its log has a cap', async () => {
    const log = vi.fn()
    const regulator = new CpuRegulator({ enginePath: FAKE_ENGINE, max: 16, dataDir: dir, log, logEveryMs: 60_000 })
    regulator.start()
    regulator.started(101, 'managed')
    regulator.started(102, 'own')
    regulator.ended(101)
    regulator.ended(999)
    await until(() => lines().includes('remove 101'))
    expect(lines()).toEqual(['start --max 16 --floor 2', 'add 101 managed', 'add 102 own', 'remove 101'])
    await until(() => regulator.state?.allowed === 20)
    // regulator.json for --check: the last thing it allowed.
    expect(JSON.parse(readFileSync(join(dir, 'regulator.json'), 'utf8'))).toMatchObject({ allowed: 20, total: 20 })
    // Three changes in a moment, one line in the log (the others wait for the next minute).
    const changes = log.mock.calls.filter(([message]) => message === 'CPU para los motores')
    expect(changes).toHaveLength(1)
    expect(log).toHaveBeenCalledWith(
      'regulador de CPU',
      expect.objectContaining({ said: expect.stringContaining('20 logicos') }),
    )
    // Stopping closes its stdin: it gives the machine back and ends.
    await regulator.stop()
    expect(lines().at(-1)).toBe('end')
  })

  it('starts again if it ends on its own, telling it the engines running, at most a few times an hour', async () => {
    vi.stubEnv('FAKE_REGULATE_CRASH', '1')
    const log = vi.fn()
    const regulator = new CpuRegulator({ enginePath: FAKE_ENGINE, max: 8, dataDir: dir, log, restartAfterMs: 300 })
    regulator.started(201, 'managed')
    regulator.start()
    // Each start hears the engine again and ends on it; after the cap it is not started again, but one last short run
    // tells it the engines running and closes, which gives them the whole machine back (review of #106). That last
    // run does not crash, so all of it can be heard.
    await until(() => lines().filter((line) => line === 'add 201 managed').length === MAX_STARTS_PER_HOUR, 8_000)
    vi.stubEnv('FAKE_REGULATE_CRASH', '')
    await until(() => log.mock.calls.some(([message]) => String(message).includes('devuelvo la máquina entera')))
    await until(() => lines().filter((line) => line === 'add 201 managed').length === MAX_STARTS_PER_HOUR + 1)
    const starts = lines().filter((line) => line.startsWith('start'))
    expect(starts).toEqual([...Array(MAX_STARTS_PER_HOUR).fill('start --max 8 --floor 2'), 'start --floor 1'])
    // It closes its stdin, which is what gives the engines the machine back (autorrevisión).
    await until(() => lines().at(-1) === 'end')
    expect(lines().slice(-3)).toEqual(['start --floor 1', 'add 201 managed', 'end'])
    expect(log).toHaveBeenCalledWith(
      'el regulador de CPU terminó muchas veces: no lo arranco más hasta reiniciar el worker',
      {
        starts: MAX_STARTS_PER_HOUR,
      },
    )
    await regulator.stop()
  })

  it('asks a regulator that answers ping, and cuts and starts again one that does not (review of #106)', async () => {
    const log = vi.fn()
    const alive = new CpuRegulator({
      enginePath: FAKE_ENGINE,
      dataDir: dir,
      log,
      ping: true,
      pingEveryMs: 30,
      pingTimeoutMs: 120,
    })
    try {
      alive.start()
      await until(() => lines().filter((line) => line === 'ping').length >= 4)
      expect(lines().filter((line) => line.startsWith('start'))).toHaveLength(1)
      expect(log.mock.calls.some(([message]) => String(message).includes('no contesta'))).toBe(false)
    } finally {
      await alive.stop()
    }
    // A ping every pingEveryMs, also with a shorter timeout (autorrevisión: it went every timeout).
    rmSync(heard, { force: true })
    const spaced = new CpuRegulator({
      enginePath: FAKE_ENGINE,
      dataDir: dir,
      log,
      ping: true,
      pingEveryMs: 400,
      pingTimeoutMs: 100,
    })
    try {
      spaced.start()
      await new Promise((resolve) => setTimeout(resolve, 1_300))
      const pings = lines().filter((line) => line === 'ping').length
      expect(pings).toBeGreaterThanOrEqual(2)
      expect(pings).toBeLessThanOrEqual(4)
    } finally {
      await spaced.stop()
    }
    // Hung: it reads the lines and answers nothing.
    rmSync(heard, { force: true })
    vi.stubEnv('FAKE_REGULATE_DEAF', '1')
    const hung = new CpuRegulator({
      enginePath: FAKE_ENGINE,
      dataDir: dir,
      log,
      ping: true,
      pingEveryMs: 30,
      pingTimeoutMs: 120,
      restartAfterMs: 20,
    })
    try {
      hung.start()
      await until(() => lines().filter((line) => line.startsWith('start')).length >= 2)
      expect(log).toHaveBeenCalledWith(
        'el regulador de CPU no contesta: lo corto',
        expect.objectContaining({ seconds: 0 }),
      )
    } finally {
      await hung.stop()
    }
    // An engine without regulatePing is never asked (an old regulator would not answer).
    rmSync(heard, { force: true })
    const old = new CpuRegulator({
      enginePath: FAKE_ENGINE,
      dataDir: dir,
      log: vi.fn(),
      pingEveryMs: 30,
      pingTimeoutMs: 120,
    })
    old.start()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(lines()).not.toContain('ping')
    await old.stop()
  })

  it('is sized from the whole machine unless told a max, and logs what it could not do (autorrevisión)', async () => {
    const log = vi.fn()
    const regulator = new CpuRegulator({ enginePath: FAKE_ENGINE, dataDir: dir, log })
    regulator.start()
    regulator.started(1, 'managed')
    await until(() => log.mock.calls.some(([, data]) => String(data?.said).startsWith('aviso ')))
    expect(lines()[0]).toBe('start --floor 2')
    expect(log).toHaveBeenCalledWith('regulador de CPU', { said: 'aviso 1 no es un motor: no lo toco' })
    await regulator.stop()
  })

  it('one that cannot run on this machine is not started again, and the log says why (autorrevisión)', async () => {
    vi.stubEnv('FAKE_REGULATE_FAIL', '1')
    const log = vi.fn()
    const regulator = new CpuRegulator({ enginePath: FAKE_ENGINE, dataDir: dir, log, restartAfterMs: 20 })
    regulator.start()
    await until(() => log.mock.calls.some(([message]) => String(message).includes('no puede correr')))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(lines().filter((line) => line.startsWith('start'))).toHaveLength(1)
    expect(log).toHaveBeenCalledWith('el regulador de CPU no puede correr en esta máquina: sigo sin él', {
      code: 2,
      error: expect.stringContaining('más de un grupo de procesadores'),
    })
    await regulator.stop()
  })

  it('stopping one that does not end kills it after a while (autorrevisión)', async () => {
    const pidFile = join(dir, 'pid.txt')
    vi.stubEnv('FAKE_REGULATE_HANG', '1')
    vi.stubEnv('FAKE_REGULATE_PID', pidFile)
    const regulator = new CpuRegulator({ enginePath: FAKE_ENGINE, dataDir: dir, log: vi.fn(), stopTimeoutMs: 300 })
    regulator.start()
    await until(() => existsSync(pidFile) && lines().length > 0)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const startedAt = Date.now()
    await regulator.stop()
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250)
    expect(lines().at(-1)).toBe('end')
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    await until(() => !alive())
  })

  it('an engine ends for the regulator when its process ends, not when its pipes close (review of #106, M6)', async () => {
    vi.stubEnv('FAKE_ENGINE_HOLD_PIPES', '1500')
    let endedAt = 0
    watchEngines({ started: () => undefined, ended: () => (endedAt = Date.now()) })
    await runJob(FAKE_ENGINE, 'simulate', { games: 3 }, dir, {})
    const resolvedAt = Date.now()
    expect(endedAt).toBeGreaterThan(0)
    // Its pipes closed 1,5 s after it ended; its PID was let go at once, and that is when the regulator hears it.
    expect(resolvedAt - endedAt, `ended at ${endedAt}, resolved at ${resolvedAt}`).toBeGreaterThanOrEqual(600)
  })

  it('a job tells the regulator its engine, and when it ends', async () => {
    const seen: string[] = []
    watchEngines({
      started: (pid, kind) => seen.push(`start ${kind} ${pid > 0}`),
      ended: (pid) => seen.push(`end ${pid > 0}`),
    })
    await runJob(FAKE_ENGINE, 'simulate', { games: 3 }, dir, {})
    expect(seen).toEqual(['start managed true', 'end true'])
  })
})
