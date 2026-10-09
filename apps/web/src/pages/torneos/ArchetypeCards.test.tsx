import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { ArchetypeCards } from './ArchetypeCards'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const rate = (value: number, games: number) => ({
  source: 'tournament',
  value,
  games,
  samples: Math.round(games / 7),
  sampleKind: 'lists',
  ci95: [value - 10, value + 10],
  orientative: games < 30,
})
const row = (lists: number, value: number) => ({
  lists,
  record: { wins: 10, losses: 10, ties: 0 },
  // Tournament rates are «orientativo» under 30 lists.
  rate: { ...rate(value, lists * 7), orientative: lists < 30 },
  share: 5,
})

const cards = {
  scope: {
    era: { code: 'B4a', nameEs: 'Era B4a', from: '2026-08-28', to: null, current: true },
    format: 'STANDARD',
    minPlayers: 12,
    tournaments: 1,
    lists: 393,
    games: 2190,
    mean: row(393, 47),
    conflicts: [],
    unknownCards: 0,
    attribution: 'Limitless',
  },
  archetype: { id: 'mega-lucario-ex-b3-lucario-a2', name: 'Mega Lucario ex', icons: [] },
  lists: 33,
  resamples: 1000,
  core: [{ groupId: 'B3-1', nameEs: 'Mega Lucario ex', lists: 33, share: 100, averageCopies: 2, byCopies: [0, 0, 33] }],
  coreSlots: 12.7,
  freeSlots: 7.3,
  techs: [
    {
      groupId: 'A2-91',
      nameEs: 'Riolu',
      lists: 22,
      share: 67,
      averageCopies: 1.5,
      with: row(22, 52),
      without: row(11, 44),
      difference: {
        value: 8.4,
        ci95: [-9.3, 25.8],
        p: 0.33,
        clear: false,
        orientative: true,
        text: '+8,4 puntos (IC −9,3 a +25,8, orientativo; puede ser azar)',
      },
    },
    {
      groupId: 'B3-79',
      nameEs: 'Riolu',
      lists: 19,
      share: 58,
      averageCopies: 1.2,
      with: row(19, 60),
      without: row(14, 30),
      difference: {
        value: 30,
        ci95: [12, 45],
        p: 0.002,
        clear: true,
        orientative: false,
        text: '+30,0 puntos (IC +12,0 a +45,0; clara)',
      },
    },
  ],
  copies: [],
  conversion: {
    top: 8,
    minPlayers: 32,
    tournaments: 1,
    lists: 33,
    topLists: 3,
    rate: 9.1,
    ci95: [3.1, 23.6],
    expected: 0.66,
    baseline: 2,
    ratio: 4.5,
    ratioCi95: [1.5, 11.6],
    excluded: { tournaments: 0, lists: 0 },
    orientative: false,
    text: '3 de 33 listas llegaron al top 8 (9 %, IC 3–24 %); en sus torneos, al ritmo del resto del campo, se esperaban 0,7; razón ajustada por torneo: 4,5× (IC 1,5–11,6). Llega más de lo esperado.',
  },
  note: 'Diferencias entre las listas que juegan la carta y las que no.',
}

describe('núcleo, techs and top 8 of an archetype (Fase 44)', () => {
  it('asks the server only when opened, and tells two Riolu apart and a clear difference from chance', async () => {
    const { calls } = fakeApi({ 'GET /api/tournaments/archetypes/mega-lucario-ex-b3-lucario-a2/cards': cards })
    const user = userEvent.setup()
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ArchetypeCards id="mega-lucario-ex-b3-lucario-a2" scope={{}} />
      </Providers>,
    )
    expect(calls).toHaveLength(0)
    await user.click(screen.getByText('Núcleo, techs y top 8'))
    expect(await screen.findByText(/3 de 33 listas llegaron al top 8/)).toBeInTheDocument()
    expect(screen.getByText(/ocupa ~12,7 de los 20 lugares/)).toBeInTheDocument()
    expect(screen.getByText(/se compara con el resto de las listas de su torneo/)).toBeInTheDocument()
    expect(screen.getByText('Riolu (A2-91)')).toBeInTheDocument()
    expect(screen.getByText('Riolu (B3-79)')).toBeInTheDocument()
    expect(screen.getByText(/\+8,4 puntos .*puede ser azar/)).toBeInTheDocument()
    expect(screen.getAllByText('rinde más')).toHaveLength(1)
    // Each side with its n and interval (review of #17), and «orientativo» where it applies.
    expect(screen.getAllByText(/IC 42.*62/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('orientativo').length).toBeGreaterThan(1)
  })
})
