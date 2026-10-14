import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { run } from '../src/run.js'

describe('worker configuration', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tcg-priority-config-'))
    vi.stubEnv('TCG_WORKER_DIR', dir)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    rmSync(dir, { recursive: true, force: true })
  })

  it('defaults to below_normal and all available threads; mobile still defaults to half', () => {
    expect(loadConfig({ TCG_WORKER_TOKEN: 'tcg_wk_test' })).toMatchObject({
      priority: 'below_normal',
      cores: availableParallelism(),
    })
    expect(loadConfig({ TCG_WORKER_TOKEN: 'tcg_wk_test' }, { capThreads: true }).cores).toBe(
      Math.max(1, Math.floor(availableParallelism() / 2)),
    )
  })

  it.each(['below_normal', 'normal', 'idle'] as const)(
    'reads %s from file and lets the environment override it',
    (priority) => {
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'tcg_wk_test', priority }))
      expect(loadConfig({}).priority).toBe(priority)
      expect(loadConfig({ TCG_WORKER_PRIORITY: 'normal' }).priority).toBe('normal')
    },
  )

  it('turns the CPU regulator on by default on Windows only; the file and the environment change it', () => {
    expect(loadConfig({ TCG_WORKER_TOKEN: 'tcg_wk_test' }).cpuRegulator).toBe(process.platform === 'win32')
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'tcg_wk_test', cpuRegulator: false }))
    expect(loadConfig({}).cpuRegulator).toBe(false)
    expect(loadConfig({ TCG_WORKER_CPU_REGULATOR: 'true' }).cpuRegulator).toBe(true)
    expect(() => loadConfig({ TCG_WORKER_CPU_REGULATOR: 'yes' })).toThrow(/TCG_WORKER_CPU_REGULATOR/)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'tcg_wk_test', cpuRegulator: 'on' }))
    expect(() => loadConfig({})).toThrow(/cpuRegulator/)
  })

  it('rejects invalid file and environment priorities with an actionable error', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'tcg_wk_test', priority: 'high' }))
    expect(() => loadConfig({})).toThrow('Prioridad inválida')
    expect(() => loadConfig({ TCG_WORKER_PRIORITY: '' })).toThrow('TCG_WORKER_PRIORITY')
  })

  it('allows slow bots on PC and disables them with Android defaults, including old config files', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'tcg_wk_test' }))
    expect(loadConfig({}).allowSlowBots).toBe(true)
    expect(loadConfig({}, { allowSlowBots: false }).allowSlowBots).toBe(false)
  })

  it.each([false, true])('reads allowSlowBots=%s from config; environment overrides config and defaults', (value) => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'tcg_wk_test', allowSlowBots: value }))
    expect(loadConfig({}, { allowSlowBots: !value }).allowSlowBots).toBe(value)
    expect(loadConfig({ TCG_WORKER_ALLOW_SLOW_BOTS: String(!value) }, { allowSlowBots: value }).allowSlowBots).toBe(
      !value,
    )
  })

  it('rejects non-boolean slow bot preferences instead of silently opting in', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'tcg_wk_test', allowSlowBots: 'false' }))
    expect(() => loadConfig({})).toThrow('allowSlowBots')
    expect(() => loadConfig({ TCG_WORKER_ALLOW_SLOW_BOTS: 'no' })).toThrow('TCG_WORKER_ALLOW_SLOW_BOTS')
    expect(() => loadConfig({ TCG_WORKER_ALLOW_SLOW_BOTS: '' })).toThrow('TCG_WORKER_ALLOW_SLOW_BOTS')
  })

  it('--check includes the configured priority without claiming work', async () => {
    vi.stubEnv('TCG_WORKER_TOKEN', 'tcg_wk_test')
    vi.stubEnv('TCG_SERVER', 'http://test')
    vi.stubEnv('TCG_ENGINE_PATH', join(import.meta.dirname, 'fake-engine.mjs'))
    vi.stubEnv('TCG_WORKER_PRIORITY', 'idle')
    vi.stubEnv('TCG_WORKER_ALLOW_SLOW_BOTS', 'false')
    const fetch = vi.fn(async (_url: string | URL | Request) => Response.json({ ok: true, token: { name: 'test' } }))
    vi.stubGlobal('fetch', fetch)
    await run(['--check'])
    expect(readFileSync(join(dir, 'worker.log'), 'utf8')).toContain('"priority":"idle"')
    expect(readFileSync(join(dir, 'worker.log'), 'utf8')).toContain('"allowSlowBots":false')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toBe('http://test/api/worker/ping')
  })
})
