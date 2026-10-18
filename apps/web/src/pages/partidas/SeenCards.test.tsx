import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeenCard } from '@/api/schemas'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { SeenCardsField } from './SeenCards'

afterEach(() => {
  vi.unstubAllGlobals()
})

const cards = (twos: number, ones: number): SeenCard[] =>
  Array.from({ length: twos + ones }, (_, at) => ({
    cardId: `A1-${at + 1}`,
    count: at < twos ? 2 : 1,
    nameEs: `Carta ${at + 1}`,
  }))

function renderField(value: SeenCard[]) {
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SeenCardsField value={value} onChange={() => {}} opponent="Alguien" onPickRival={() => {}} />
    </Providers>,
  )
}

describe('cartas que vi: 20 copias como mucho (Codex on #114)', () => {
  it('with 20 copies there is no search, and it says why', () => {
    fakeApi({})
    renderField(cards(10, 0))
    expect(screen.queryByRole('searchbox', { name: 'Buscar carta' })).not.toBeInTheDocument()
    expect(screen.getByText('Ya son 20 cartas: un mazo no tiene más.')).toBeInTheDocument()
  })

  it('with 20 copies a card seen once cannot go to two; one seen twice can go back to one', () => {
    fakeApi({})
    renderField(cards(9, 2))
    expect(screen.getByRole('button', { name: /Carta 10: una copia/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Carta 1: dos copias/ })).toBeEnabled()
  })

  it('below 20 the search is there and every card can change', () => {
    fakeApi({})
    renderField(cards(9, 1))
    expect(screen.getByRole('searchbox', { name: 'Buscar carta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Carta 10: una copia/ })).toBeEnabled()
  })
})
