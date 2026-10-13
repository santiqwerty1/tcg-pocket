import type { CalibrationRow, WinRate } from '@tcg/domain'
import { describe, expect, it } from 'vitest'
import type { CalibrationView } from '../simulation/calibration.service.js'
import { calibrationReportJson } from './mcp-calibration-json.js'

const rate = <S extends 'simulation' | 'tournament'>(source: S, value: number): WinRate<S> => ({
  source,
  value,
  games: 40,
  samples: 40,
  sampleKind: source === 'simulation' ? 'simulations' : 'matches',
  ci95: [value - 10, value + 10],
  orientative: false,
})

const row = (i: number): CalibrationRow => ({
  a: `a${i}`,
  b: `b${i}`,
  labelA: `A${i}`,
  labelB: `B${i}`,
  simulated: rate('simulation', 50 + i),
  ties: 0,
  tournament: rate('tournament', 50),
  difference: i,
  differenceCi95: [i - 5, i + 5],
  compatible: true,
})

function view(status: 'running' | 'done'): CalibrationView {
  return {
    job: {
      id: 1,
      status,
      label: 'Calibración',
      bot: 'e2',
      botEs: 'expectiminimax, profundidad 2',
      era: 'B4a',
      format: 'STANDARD',
      engineRev: 'a'.repeat(40),
      gamesPerPair: 10,
      createdAt: new Date('2026-10-13T00:00:00Z'),
      finishedAt: null,
      progress: {
        totalGames: 50,
        gamesDone: 30,
        chunks: { total: 5, done: 3, running: 1, failed: 0 },
        etaSeconds: null,
      },
      lists: 4,
    },
    report: {
      rows: [0, 1, 2, 3, 4].map(row),
      compared: 5,
      compatible: 5,
      meanAbsDifference: 2,
      rankCorrelation: null,
      archetypes: [],
      archetypeCorrelation: null,
      minTournamentGames: 20,
    },
    tournaments: { era: 'B4a', format: 'STANDARD', matches: 100, tournamentsWithPairings: 2 },
    pending: 0,
    failed: 0,
    cancelled: 0,
    mirrors: 0,
    incompletePairs: 0,
  }
}

describe('simulations_calibration, full by pages', () => {
  it('a page of a calibration still playing says a pair may come in between two pages (review of #85)', () => {
    const playing = calibrationReportJson(view('running'), { full: true, offset: 0, limit: 2 })
    expect(playing.pairsShown).toMatch(/^los pares 1 a 2 de 5; offset 2 para seguir\. La calibración sigue corriendo/)
    expect(playing.page).toEqual({ offset: 0, limit: 2, total: 5, next: 2 })
    const ended = calibrationReportJson(view('done'), { full: true, offset: 2, limit: 2 })
    expect(ended.pairsShown).toBe('los pares 3 a 4 de 5; offset 4 para seguir')
    expect((ended.pairs as { pair: string }[]).map((pair) => pair.pair)).toEqual(['A2 vs B2', 'A3 vs B3'])
    // Compact keeps the pairs that differ most, and says nothing of pages.
    const compact = calibrationReportJson(view('running'), { full: false, offset: 0, limit: 2 })
    expect((compact.pairs as { pair: string }[]).map((pair) => pair.pair)).toEqual(['A4 vs B4', 'A3 vs B3'])
    expect(compact.page).toBeUndefined()
  })
})
