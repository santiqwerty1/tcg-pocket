import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPluggedIn, whileCharging } from '../src/battery.js'
import { WorkerClient } from '../src/client.js'
import { checkDeterminism, deterministicResult } from '../src/determinism.js'
import { engineVersion, runJob } from '../src/engine.js'

const dir = mkdtempSync(join(tmpdir(), 'tcg-android-test-'))
const engine = join(import.meta.dirname, 'fake-engine.mjs')
afterEach(() => vi.restoreAllMocks())

describe('Termux charging supervisor', () => {
  it('accepts plugged FULL/NOT_CHARGING; unknown responses pause', () => {
    expect(isPluggedIn({ plugged: 'PLUGGED_AC', status: 'FULL' })).toBe(true)
    expect(isPluggedIn({ plugged: 'PLUGGED_USB', status: 'NOT_CHARGING' })).toBe(true)
    for (const battery of [null, {}, { plugged: 'UNPLUGGED' }, { plugged: 1 }]) expect(isPluggedIn(battery)).toBe(false)
  })
  it('starts once, stops on unplug/API failure, resumes and stops on SIGTERM', async () => {
    const controller = new AbortController()
    const events: string[] = []
    const readings = [true, true, false, true, new Error('API unavailable'), true]
    await whileCharging(
      {
        charging: async () => {
          const next = readings.shift()
          if (next instanceof Error) throw next
          return next === true
        },
        start: async () => {
          events.push('start')
        },
        stop: async () => {
          events.push('stop')
        },
        wait: async () => {
          if (!readings.length) controller.abort()
        },
      },
      controller.signal,
    )
    expect(events).toEqual(['start', 'stop', 'start', 'stop', 'start', 'stop'])
  })
})

describe('determinism gate', () => {
  it('refuses both claims after a server engine update, without leaking a bearer into the URL', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      expect(url).not.toContain('tcg_wk_test')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tcg_wk_test')
      return new Response(JSON.stringify({ engineRev: 'same', cliVersion: '0.3.4' }), { status: 200 })
    }) as typeof fetch
    const client = new WorkerClient('https://test.example', 'tcg_wk_test', () => undefined, fetchImpl)
    client.requiredEngine = { engineRev: 'same', cliVersion: '0.3.3' }
    for (const path of ['/api/worker/claim', '/api/worker/live/claim']) {
      await expect(client.request('POST', path, {})).rejects.toThrow('Cambió el motor')
    }
    expect(calls).toEqual(Array(2).fill('https://test.example/api/worker/packages/android-arm64/version'))
  })
  // Several real child processes: allow startup under concurrent CI/engine builds (D-023).
  it('checks per-game reference; differences and stale engine versions stop startup', async () => {
    const job = { deckA: 'x', deckB: 'y', players: ['r', 'r'], games: 4, seed: 1, threads: 1, replaySample: 0 }
    const version = await engineVersion(engine)
    const { result, dir: resultDir } = await runJob<Record<string, unknown>>(engine, 'simulate', job, dir)
    const reference = { version, cases: [{ job, expected: deterministicResult(result) }] }
    const file = join(dir, 'reference.json')
    writeFileSync(file, JSON.stringify(reference))
    await expect(checkDeterminism(engine, file, dir)).resolves.toBeUndefined()
    const first = reference.cases[0]
    if (!first) throw new Error('missing test case')
    first.expected.winsA = 42
    writeFileSync(file, JSON.stringify(reference))
    await expect(checkDeterminism(engine, file, dir)).rejects.toThrow('No tomo trabajo')
    reference.version.cliVersion = 'wrong'
    writeFileSync(file, JSON.stringify(reference))
    await expect(checkDeterminism(engine, file, dir)).rejects.toThrow('no corresponde')
    rmSync(resultDir, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})
