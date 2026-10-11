import { describe, expect, it } from 'vitest'
import {
  type AnalysisMatrixInput,
  analysisFindings,
  analysisMatrix,
  analyzeGames,
  bootstrapRankCorrelation,
  compareAnalysisBots,
  type GameMoments,
  matchupPatterns,
} from '../../src/index.js'

const input = (): AnalysisMatrixInput => ({
  id: 1,
  label: 'Matriz e2',
  bot: 'e2/e2',
  era: 'B4a',
  engineRev: 'a',
  decks: [
    { id: 1, key: 'a', label: 'Mazo A' },
    { id: 2, key: 'b', label: 'Mazo B' },
    { id: 3, key: 'c', label: 'Mazo C' },
  ],
  sideA: [1, 2, 3],
  sideB: [1, 2, 3],
  outcomes: [
    { a: 1, b: 2, winsA: 900, winsB: 100, ties: 0 },
    { a: 2, b: 3, winsA: 700, winsB: 300, ties: 0 },
    { a: 3, b: 1, winsA: 600, winsB: 400, ties: 0 },
  ],
})
const empty = (): GameMoments => ({
  games: 0,
  firstWins: 0,
  secondWins: 0,
  ties: 0,
  turnSum: 0,
  turnSquares: 0,
  histogram: [],
})

describe('simulation analysis', () => {
  it('reuses matrix ranking and Wilson, including ties and chunks in both orientations', () => {
    const data = input()
    data.outcomes.push({ a: 2, b: 1, winsA: 10, winsB: 0, ties: 10 })
    const matrix = analysisMatrix(data)
    expect(matrix.rows[0]?.key).toBe('a')
    const ab = matrix.rows[0]?.cells.find((c) => c.rival === 'b')
    expect(ab?.record).toEqual({ wins: 900, losses: 110, ties: 10 })
    expect(ab?.rate).toMatchObject({ source: 'simulation', games: 1020, value: (900 / 1020) * 100 })
    expect(ab?.rate?.ci95[0]).toBeLessThan(ab?.rate?.value as number)
  })
  it('matches exact list hashes across snapshot ids, deduplicates repeated snapshots and removes mirrors', () => {
    const data = input()
    data.decks.push({ id: 4, key: 'a', label: 'Mismo A' })
    data.sideA.push(4)
    data.outcomes.push({ a: 4, b: 2, winsA: 1, winsB: 0, ties: 0 }, { a: 1, b: 4, winsA: 2, winsB: 8, ties: 0 })
    const rows = analysisMatrix(data).rows
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.key === 'a')?.record).toEqual({ wins: 1301, losses: 700, ties: 0 })
    expect(() => analysisMatrix({ ...data, sideA: [99] })).toThrow('Missing snapshot')
  })
  it('shows unplayed cells as null and not zero percent', () => {
    const rows = analysisMatrix({ ...input(), outcomes: [] }).rows
    expect(rows.every((row) => row.rate === null && row.cells.every((c) => c.rate === null))).toBe(true)
  })
  it('bootstrap is deterministic, handles ties and perfect/reversed ranks', () => {
    const xs = [1, 2, 2, 4, 5]
    const same = bootstrapRankCorrelation(xs, xs)
    expect(same).toEqual(bootstrapRankCorrelation(xs, xs))
    expect(same).toMatchObject({ rho: 1, n: 5, ci95: [1, 1], method: 'bootstrap' })
    expect(bootstrapRankCorrelation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])?.rho).toBe(-1)
    expect(bootstrapRankCorrelation([1, 1, 1], [2, 2, 2])).toBeNull()
    expect(bootstrapRankCorrelation([1, 2], [2, 1])).toBeNull()
    expect(() => bootstrapRankCorrelation([1, 2, 3], [1, 2])).toThrow()
  })
  it('detects changes between bots with uncertainty from both sides and same rivals', () => {
    const left = analysisMatrix(input())
    const data = input()
    data.id = 2
    data.bot = 'f2/f2'
    data.outcomes = data.outcomes.map((c) => ({ ...c, winsA: c.winsB, winsB: c.winsA }))
    const comparison = compareAnalysisBots(left, analysisMatrix(data))
    expect(comparison?.correlation?.rho).toBe(-1)
    expect(comparison?.changes.find((c) => c.key === 'a')).toMatchObject({
      before: { games: 2000 },
      after: { games: 2000 },
      rivals: 2,
      rankBefore: 1,
      rankAfter: 3,
    })
    const a = comparison?.changes.find((c) => c.key === 'a')
    expect(a?.difference.ci95[1]).toBeLessThan(0)
    expect(compareAnalysisBots(left, left)).toBeNull()
    expect(compareAnalysisBots(left, { ...analysisMatrix(data), era: 'B3' })).toBeNull()
  })
  it('does not compare revised lists or unseen rivals; equal rival weighting prevents sample-size confounding', () => {
    const l = input(),
      r = input()
    r.bot = 'f2/f2'
    r.id = 2
    r.decks = r.decks.map((d) => ({ ...d, id: d.id + 10 }))
    r.sideA = r.sideA.map((n) => n + 10)
    r.sideB = r.sideB.map((n) => n + 10)
    r.outcomes = r.outcomes.map((c, i) => ({
      a: c.a + 10,
      b: c.b + 10,
      winsA: c.winsA * (i + 1),
      winsB: c.winsB * (i + 1),
      ties: 0,
    }))
    const comparison = compareAnalysisBots(analysisMatrix(l), analysisMatrix(r))
    expect(comparison?.changes).toHaveLength(3)
    expect(comparison?.changes.every((c) => c.difference.value === 0)).toBe(true)
    r.decks[0] = { ...(r.decks[0] as AnalysisMatrixInput['decks'][number]), key: 'revised-a' }
    expect(compareAnalysisBots(analysisMatrix(l), analysisMatrix(r))?.changes.map((c) => c.key)).not.toContain('a')
    expect(compareAnalysisBots(analysisMatrix({ ...l, outcomes: [] }), analysisMatrix(r))?.changes).toEqual([])
  })
  it('sustains directed cycles only with all three pointwise intervals and counts each once', () => {
    const matrix = analysisMatrix(input())
    const patterns = matchupPatterns(matrix)
    expect(patterns.dominant).toHaveLength(3)
    expect(patterns.cyclesTotal).toBe(1)
    expect(patterns.cycles[0]?.map((c) => `${c.a}>${c.b}`)).toEqual(['a>b', 'b>c', 'c>a'])
    expect(patterns.cycles[0]?.every((edge) => edge.rate.ci95[0] > 50)).toBe(true)
    const data = input()
    data.outcomes[2] = { a: 3, b: 1, winsA: 6, winsB: 4, ties: 0 }
    expect(matchupPatterns(analysisMatrix(data)).cyclesTotal).toBe(0)
    expect(matchupPatterns(analysisMatrix({ ...input(), outcomes: [] }))).toEqual({
      dominant: [],
      dominantTotal: 0,
      cycles: [],
      cyclesTotal: 0,
    })
  })
  it('counts starter wins once, uses dependent difference variance and includes ties in denominator', () => {
    const moments = {
      games: 10,
      firstWins: 6,
      secondWins: 2,
      ties: 2,
      turnSum: 100,
      turnSquares: 1040,
      histogram: [
        { turns: 8, games: 5 },
        { turns: 12, games: 5 },
      ],
    }
    const games = analyzeGames({ wins: 5, losses: 3, ties: 2 }, moments)
    expect(games.first).toMatchObject({ value: 60, games: 10, orientative: true })
    expect(games.second?.value).toBe(20)
    expect(games.firstAdvantage).toMatchObject({ value: 40, n: 10, orientative: true })
    expect(games.firstAdvantage?.ci95[0]).toBeLessThan(0)
    expect(games.duration?.mean).toBe(10)
    expect(games.duration?.ci95?.[0]).toBeLessThan(10)
    expect(games.ties).toMatchObject({ value: 20, games: 10 })
    expect(() => analyzeGames({ wins: 1, losses: 0, ties: 0 }, { ...moments, games: 9 })).toThrow()
  })
  it('separates coverage from all games, keeps sparse/boundary intervals and no fabricated legacy durations', () => {
    expect(analyzeGames({ wins: 90, losses: 0, ties: 10 }, empty())).toMatchObject({
      coverage: 0,
      first: null,
      duration: null,
      ties: { games: 100, value: 10 },
    })
    const one = analyzeGames(
      { wins: 1, losses: 0, ties: 0 },
      {
        games: 1,
        firstWins: 1,
        secondWins: 0,
        ties: 0,
        turnSum: 5,
        turnSquares: 25,
        histogram: [{ turns: 5, games: 1 }],
      },
    )
    expect(one.duration).toMatchObject({ mean: 5, ci95: null, orientative: true })
    expect(one.firstAdvantage?.ci95[0]).toBeLessThan(100)
    expect(analyzeGames({ wins: 0, losses: 0, ties: 0 }, empty()).ties).toBeNull()
  })
  it('generates findings from current evidence, never frozen conclusions', () => {
    const games = analyzeGames({ wins: 0, losses: 0, ties: 0 }, empty())
    const patterns = matchupPatterns(analysisMatrix(input()))
    const findings = analysisFindings(patterns, games, null)
    expect(findings.some((f) => f.kind === 'cycle')).toBe(true)
    expect(findings.every((f) => f.text.includes('n =') && f.text.includes('IC 95 %'))).toBe(true)
    expect(analysisFindings({ dominant: [], dominantTotal: 0, cycles: [], cyclesTotal: 0 }, games, null)).toEqual([])
  })
  it('uses legacy aggregate turns for a duration mean without inventing an interval or first-player evidence', () => {
    const games = analyzeGames({ wins: 90, losses: 10, ties: 0 }, empty(), { games: 100, turns: 800 })
    expect(games.duration).toEqual({ mean: 8, ci95: null, n: 100, orientative: false })
    expect(games.coverage).toBe(0)
    expect(games.first).toBeNull()
  })
  it('does not bootstrap fewer than five lists, and exposes engines and partial states', () => {
    expect(bootstrapRankCorrelation([1, 2, 3], [3, 2, 1])).toMatchObject({ rho: -1, ci95: null })
    const left = analysisMatrix({ ...input(), era: null })
    const right = analysisMatrix({ ...input(), id: 2, bot: 'f2/f2', engineRev: 'b', status: 'running' })
    expect(compareAnalysisBots(left, right)).toMatchObject({
      sameEngine: false,
      leftStatus: 'done',
      rightStatus: 'running',
      orientative: true,
    })
  })
  it('uses decided-game Wilson with ties separate, requires an effect and corrects all matchups', () => {
    const tied = analysisMatrix({ ...input(), outcomes: [{ a: 1, b: 2, winsA: 700, winsB: 300, ties: 1000 }] })
    expect(matchupPatterns(tied).dominant[0]).toMatchObject({ rate: { value: 70, games: 1000 }, ties: 1000 })
    expect(
      matchupPatterns(analysisMatrix({ ...input(), outcomes: [{ a: 1, b: 2, winsA: 54000, winsB: 46000, ties: 0 }] }))
        .dominantTotal,
    ).toBe(0)
    const data = input()
    data.decks = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, key: `deck-${i}`, label: `Deck ${i}` }))
    data.sideA = data.sideB = data.decks.map((d) => d.id)
    data.outcomes = []
    for (let a = 1; a <= 30; a++)
      for (let b = a + 1; b <= 30; b++)
        data.outcomes.push({
          a,
          b,
          winsA: a === 1 && b === 2 ? 222 : 200,
          winsB: a === 1 && b === 2 ? 178 : 200,
          ties: 0,
        })
    // 55.5% / Wilson >50% is a pointwise finding; across 435 tests it does not survive BH.
    expect(matchupPatterns(analysisMatrix(data)).dominantTotal).toBe(0)
  })
  it('names both bots, signed changes and engines in findings after BH', () => {
    const left = analysisMatrix(input())
    const right = analysisMatrix({
      ...input(),
      id: 2,
      bot: 'f2/f2',
      engineRev: 'different',
      outcomes: input().outcomes.map((c) => ({ ...c, winsA: c.winsB, winsB: c.winsA })),
    })
    const agreement = compareAnalysisBots(left, right)
    const findings = analysisFindings(
      { dominant: [], dominantTotal: 0, cycles: [], cyclesTotal: 0 },
      analyzeGames({ wins: 0, losses: 0, ties: 0 }, empty()),
      agreement,
    )
    const text = findings
      .filter((f) => f.kind === 'bot_change')
      .map((f) => f.text)
      .join(' ')
    expect(text).toContain('f2/f2 menos e2/e2')
    expect(text).toContain('motores distintos')
    expect(text).toContain('+')
    expect(text).toContain('-')
  })
  it('corrects bot changes over all common lists, including those with no effect', () => {
    const data = input()
    data.decks = Array.from({ length: 31 }, (_, i) => ({ id: i + 1, key: `d-${i}`, label: `D ${i}` }))
    data.sideA = data.decks.slice(0, 30).map((d) => d.id)
    data.sideB = [31]
    data.outcomes = data.sideA.map((a) => ({ a, b: 31, winsA: 500, winsB: 500, ties: 0 }))
    const other = {
      ...data,
      id: 2,
      bot: 'f2/f2',
      outcomes: data.outcomes.map((c) => (c.a === 1 ? { ...c, winsA: 565, winsB: 435 } : c)),
    }
    const change = compareAnalysisBots(analysisMatrix(data), analysisMatrix(other))?.changes.find(
      (c) => c.key === 'd-0',
    )
    expect(change?.difference.ci95[0]).toBeGreaterThan(0)
    expect(change?.significant).toBe(false)
  })
  it('orders cycles by their weakest edge rather than whichever cycle was enumerated first', () => {
    const data = input()
    data.decks = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, key: `d${i}`, label: `Deck ${i}` }))
    data.sideA = data.sideB = data.decks.map((d) => d.id)
    data.outcomes = [
      { a: 1, b: 2, winsA: 900, winsB: 100, ties: 0 },
      { a: 2, b: 3, winsA: 800, winsB: 200, ties: 0 },
      { a: 3, b: 1, winsA: 600, winsB: 400, ties: 0 },
      { a: 4, b: 5, winsA: 850, winsB: 150, ties: 0 },
      { a: 5, b: 6, winsA: 700, winsB: 300, ties: 0 },
      { a: 6, b: 4, winsA: 650, winsB: 350, ties: 0 },
    ]
    const patterns = matchupPatterns(analysisMatrix(data))
    expect(patterns.cyclesTotal).toBe(2)
    expect(patterns.cycles[0]?.every((e) => ['d3', 'd4', 'd5'].includes(e.a))).toBe(true)
  })
})
