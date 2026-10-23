import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeAll, expect, it } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { CalibrationPage } from './CalibrationPage'

const queued = {
  id: 40,
  kind: 'matrix',
  status: 'queued',
  label: 'Calibración · expectiminimax, profundidad 3 · B4a',
  players: ['e2', 'e2'],
  playersEs: ['e2', 'e2'],
  gamesPerPair: 1000,
  baseSeed: '1',
  engineRev: 'a'.repeat(40),
  replaySample: 0,
  createdAt: '2026-10-13T12:00:00Z',
  startedAt: null,
  finishedAt: null,
  error: null,
  progress: {
    totalGames: 378000,
    gamesDone: 0,
    chunks: { total: 378, done: 0, running: 0, failed: 0 },
    etaSeconds: null,
  },
}

// jsdom has no pointer capture, which the Radix select asks for.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

function show() {
  const router = createMemoryRouter([{ path: '/simulacion/calibracion', element: <CalibrationPage /> }], {
    initialEntries: ['/simulacion/calibracion'],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

it('elige cuántos arquetipos juega el banco (D-029), dice cuánto cuesta y lo manda', async () => {
  const api = fakeApi({ 'GET /api/calibration': [], 'POST /api/calibration': queued })
  const user = userEvent.setup()
  show()
  // The Laboratorio's bank by default: 15 archetypes, 18 lists with the second ones, 153 pairings.
  expect(await screen.findByText(/Con 15 arquetipos son unas 18 listas .* 153 cruces: 30\.600 partidas/)).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: 'Arquetipos del banco' }))
  await user.click(await screen.findByRole('option', { name: '25' }))
  const games = screen.getByLabelText('Partidas por cruce')
  await user.clear(games)
  await user.type(games, '1000')
  expect(screen.getByText(/Con 25 arquetipos son unas 28 listas .* 378 cruces: 378\.000 partidas/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Calibrar' }))
  const post = api.calls.find((call) => call.method === 'POST' && call.path === '/api/calibration')
  // D-029: g2 by default since 23/10/2026.
  expect(JSON.parse(String(post?.body))).toEqual({ bot: 'g2', gamesPerPair: 1000, size: 25 })
})

it('empieza con g2, el bot por defecto (D-029), y lo marca en la lista', async () => {
  fakeApi({
    'GET /api/calibration': [],
    'GET /api/simulations/engine': {
      engineRev: 'a'.repeat(40),
      cards: 10,
      incomplete: 0,
      source: 'worker',
      workers: [],
      bots: [
        { code: 'e2', label: 'expectiminimax, profundidad 2' },
        { code: 'g2', label: 'expectiminimax sin trampa, profundidad 2' },
      ],
    },
  })
  const user = userEvent.setup()
  show()
  const bot = await screen.findByRole('combobox', { name: 'Bot' })
  expect(bot).toHaveTextContent('g2 · expectiminimax sin trampa, profundidad 2 (por defecto)')
  await user.click(bot)
  expect(await screen.findByRole('option', { name: 'e2 · expectiminimax, profundidad 2' })).toBeVisible()
  expect(screen.getByText(/g2, el bot por defecto, tarda unas 3 veces lo de e2/)).toBeVisible()
  // D-029: e3 as measured (4,6 times e2, the calibration report of 12/10), as the estimates count it.
  expect(screen.getByText(/y\s+e3 unas 4,6\./)).toBeVisible()
})
