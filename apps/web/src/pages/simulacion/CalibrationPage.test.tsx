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
  expect(JSON.parse(String(post?.body))).toEqual({ bot: 'e2', gamesPerPair: 1000, size: 25 })
})
