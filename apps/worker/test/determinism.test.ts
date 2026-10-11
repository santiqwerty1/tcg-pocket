import { describe, expect, it } from 'vitest'
import { deterministicResult } from '../src/determinism.js'

describe('deterministicResult', () => {
  it('leaves out what depends on the machine, the build fingerprint included (phase 42)', () => {
    const result = {
      winsA: 3,
      winsB: 7,
      durationMs: 912,
      replays: [{ file: 'a.json' }],
      cliVersion: '0.3.4',
      build: 'e75c2df7116106aa',
    }
    expect(deterministicResult(result)).toEqual({ winsA: 3, winsB: 7, cliVersion: '0.3.4' })
  })
})
