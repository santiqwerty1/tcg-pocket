import { describe, expect, it } from 'vitest'
import { workerTiming } from '../../src/simulation/index.js'

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 12, 12, 0, 0) + seconds * 1000)

describe('workerTiming (phase 42: «medir primero»)', () => {
  it('per claim: the engine, the wall time, what the engine did not account for, and the gap to the next claim', () => {
    const timing = workerTiming([
      // A batch of two chunks taken together: one claim, 50 s of engine in 60 s of wall time.
      { workerId: 'pc', takenAt: at(0), finishedAt: at(55), durationMs: 25_000, games: 100 },
      // `claimMore` landed a second later: still the same claim.
      { workerId: 'pc', takenAt: at(1), finishedAt: at(60), durationMs: 25_000, games: 100 },
      // Next claim 2 s after the last result: 30 s of engine in 32 s.
      { workerId: 'pc', takenAt: at(62), finishedAt: at(94), durationMs: 30_000, games: 100 },
      // Two hours later: the worker was idle, not a gap.
      { workerId: 'pc', takenAt: at(7300), finishedAt: at(7340), durationMs: 38_000, games: 100 },
      { workerId: 'phone', takenAt: at(0), finishedAt: at(600), durationMs: 590_000, games: 100 },
    ])
    expect(timing.map((row) => [row.workerId, row.chunks, row.games, row.claims])).toEqual([
      ['pc', 4, 400, 3],
      ['phone', 1, 100, 1],
    ])
    const pc = timing[0]
    expect(pc?.engineMs).toEqual({ median: 38_000, p90: 50_000 })
    expect(pc?.wallMs).toEqual({ median: 40_000, p90: 60_000 })
    expect(pc?.overheadMs).toEqual({ median: 2_000, p90: 10_000 })
    expect(pc?.gapMs).toEqual({ median: 2_000, p90: 2_000 })
    expect(timing[1]?.gapMs).toBeNull()
  })
})
