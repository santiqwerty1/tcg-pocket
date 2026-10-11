import { QueryClient } from '@tanstack/react-query'
import {
  type AnalysisMatrixInput,
  analysisFindings,
  analysisMatrix,
  analyzeGames,
  compareAnalysisBots,
  matchupPatterns,
} from '@tcg/domain'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { type SimulationAnalysis, simulationAnalysisSchema } from '@/api/simulationAnalysis'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { SimulationAnalysisPage } from './SimulationAnalysisPage'

// Canvas is verified in the real browser; screen tests exercise fetching, filters and accessible statistics.
vi.mock('./AnalysisChart', () => ({
  AnalysisChart: ({ title }: { title: string }) => <div role="img" aria-label={title} />,
}))
afterEach(() => vi.unstubAllGlobals())

function fixture(): SimulationAnalysis {
  const data: AnalysisMatrixInput = {
    id: 1,
    label: 'Matriz e2',
    bot: 'e2/e2',
    engineRev: 'a'.repeat(40),
    era: 'B4a',
    decks: [
      { id: 1, key: 'a', label: 'Charizard ex' },
      { id: 2, key: 'b', label: 'Blastoise ex' },
      { id: 3, key: 'c', label: 'Venusaur ex' },
    ],
    sideA: [1, 2, 3],
    sideB: [1, 2, 3],
    outcomes: [
      { a: 1, b: 2, winsA: 9, winsB: 1, ties: 0 },
      { a: 2, b: 3, winsA: 7, winsB: 3, ties: 0 },
      { a: 3, b: 1, winsA: 6, winsB: 4, ties: 0 },
    ],
  }
  const matrix = analysisMatrix(data)
  const other = analysisMatrix({
    ...data,
    id: 2,
    label: 'Matriz f2',
    bot: 'f2/f2',
    outcomes: data.outcomes.map((c) => ({ ...c, winsA: c.winsB, winsB: c.winsA })),
  })
  const games = analyzeGames(
    { wins: 22, losses: 8, ties: 0 },
    {
      games: 30,
      firstWins: 20,
      secondWins: 10,
      ties: 0,
      turnSum: 240,
      turnSquares: 2040,
      histogram: [
        { turns: 6, games: 15 },
        { turns: 10, games: 15 },
      ],
    },
  )
  const patterns = matchupPatterns(matrix),
    agreement = compareAnalysisBots(matrix, other)
  return simulationAnalysisSchema.parse({
    source: 'simulation',
    options: { bots: ['e2', 'f2'], eras: ['B4a', 'B3'], expansions: ['B4', 'B3'] },
    summary: {
      simulations: 2,
      games: 60,
      unknownEra: 0,
      failedChunks: 0,
      byBot: [
        { bot: 'e2/e2', botEs: 'e2', simulations: 1, games: 30 },
        { bot: 'f2/f2', botEs: 'f2', simulations: 1, games: 30 },
      ],
      byExpansion: [{ expansion: 'B4', simulations: 2, games: 60 }],
    },
    matrix,
    rankings: [matrix, other],
    matrices: [matrix, other].map((m) => ({
      ...m,
      status: 'done',
      games: 30,
      botEs: m.bot,
      symmetric: true,
      archived: false,
      calibration: false,
    })),
    comparison: { left: 1, right: 2 },
    agreement,
    games,
    patterns,
    findings: analysisFindings(patterns, games, agreement),
    calibrationJobId: null,
  })
}
function show(path = '/simulacion/analisis') {
  const router = createMemoryRouter([{ path: '/simulacion/analisis', element: <SimulationAnalysisPage /> }], {
    initialEntries: [path],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

it('renders summary, bot rankings, uncertainty, duration and generated findings in Spanish', async () => {
  const view = fixture()
  fakeApi({ 'GET /api/simulations/analysis': view })
  show()
  expect(await screen.findByText('2 simulaciones · 60 partidas terminadas')).toBeVisible()
  for (const title of [
    'Ranking de mazos por bot',
    'Acuerdo entre bots',
    'Mapa de calor de matchups',
    'Calibración contra torneos',
    'Hallazgos',
  ])
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
  expect(screen.getByRole('img', { name: 'Ranking e2/e2 con intervalos' })).toBeVisible()
  expect(screen.getByText(/Spearman ρ =/)).toHaveTextContent('n = 3 listas')
  expect(screen.getByText(/Spearman ρ =/)).toHaveTextContent('orientativo')
  expect(screen.getByText(/Duración media:/)).toHaveTextContent('IC 95 %')
  expect(screen.getByText(/Duración media:/)).toHaveTextContent('n = 30')
  const findings = screen.getByRole('heading', { name: 'Hallazgos' }).closest('section') as HTMLElement
  expect(within(findings).getByText(view.findings[0]?.text as string)).toBeVisible()
  expect(screen.getByText(/fuente con su n e intervalo/)).toHaveTextContent(
    'partidas propias de Santi permanecen separadas',
  )
})
it('opens a heatmap cell by touch with wins, n and interval visible', async () => {
  fakeApi({ 'GET /api/simulations/analysis': fixture() })
  const user = userEvent.setup()
  show()
  await user.click(await screen.findByRole('button', { name: 'Charizard ex contra Blastoise ex' }))
  const detail = screen.getByText('Charizard ex contra Blastoise ex').parentElement as HTMLElement
  expect(detail).toHaveTextContent('n = 10')
  expect(detail).toHaveTextContent('IC')
  expect(detail).toHaveTextContent('orientativo')
})
it('updates URL filters, resets matrix/comparison choices and sends filters to the API', async () => {
  const api = fakeApi({ 'GET /api/simulations/analysis': fixture() })
  const user = userEvent.setup()
  const router = show('/simulacion/analisis?matrix=1&left=1&right=2')
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Era' }), 'B3')
  expect(router.state.location.search).toBe('?era=B3')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Expansión' }), 'B4')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Bot' }), 'e2')
  expect(api.calls.at(-1)?.query.toString()).toBe('era=B3&expansion=B4&bot=e2')
})
it('shows sparse/legacy data and an empty response without invented percentages', async () => {
  const view = fixture()
  view.summary = { ...view.summary, simulations: 0, games: 0, byBot: [], byExpansion: [] }
  view.matrix = null
  view.rankings = []
  view.matrices = []
  view.agreement = null
  view.findings = []
  view.games = {
    coverage: 0,
    first: null,
    second: null,
    ties: null,
    firstAdvantage: null,
    duration: null,
    histogram: [],
  }
  fakeApi({ 'GET /api/simulations/analysis': view })
  show()
  expect(await screen.findByText('Todavía no hay simulaciones para estos filtros')).toBeVisible()
  expect(screen.getByText('Sin datos por partida para estimar la duración.')).toBeVisible()
  expect(screen.getByText('Sin evidencia suficiente para generar hallazgos.')).toBeVisible()
})
it('shows API errors and allows retry', async () => {
  fakeApi({})
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('sin API')
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeVisible()
})
it('reuses calibration #29 with separate simulation/tournament columns', async () => {
  const view = fixture()
  const first = view.matrices[0]
  if (first) first.calibration = true
  view.calibrationJobId = 1
  const rate = view.matrix?.rows[0]?.rate
  const weighted = { value: 65, ci95: [43, 80], games: 20, orientative: true }
  fakeApi({
    'GET /api/simulations/analysis': view,
    'GET /api/calibration/1': {
      job: {
        id: 1,
        status: 'done',
        label: 'Calibración',
        bot: 'e2',
        botEs: 'e2',
        era: 'B4a',
        format: 'STANDARD',
        engineRev: 'a'.repeat(40),
        gamesPerPair: 10,
        createdAt: '2026-10-10T00:00:00Z',
        finishedAt: null,
        progress: {
          totalGames: 30,
          gamesDone: 30,
          chunks: { total: 3, done: 3, running: 0, failed: 0 },
          etaSeconds: null,
        },
        lists: 3,
      },
      report: {
        rows: [
          {
            a: 'a',
            b: 'b',
            labelA: 'Charizard ex',
            labelB: 'Blastoise ex',
            simulated: rate,
            tournament: { ...rate, source: 'tournament' },
            ties: 0,
            difference: 0,
            differenceCi95: [-20, 20],
            compatible: true,
          },
        ],
        compared: 1,
        compatible: 1,
        meanAbsDifference: 0,
        rankCorrelation: null,
        archetypeCorrelation: null,
        minTournamentGames: 20,
        archetypes: [
          { id: 'a', label: 'Charizard ex', simulated: weighted, tournament: { ...weighted, games: 40 }, rivals: 1 },
        ],
      },
      tournaments: { era: 'B4a', format: 'STANDARD', matches: 40, tournamentsWithPairings: 2 },
      pending: 0,
      failed: 0,
    },
  })
  show()
  expect(await screen.findByRole('heading', { name: 'Arquetipos contra el resto del banco' })).toBeVisible()
  expect(screen.getAllByRole('columnheader', { name: 'Simulado' })).toHaveLength(2)
  expect(screen.getAllByRole('columnheader', { name: 'Torneo' })).toHaveLength(2)
})
