import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CoinAdjusted, TurnOrder } from '@/api/schemas'
import { TurnOrderCard } from './TurnOrderCard'

const turnOrder: TurnOrder = {
  first: { wins: 15, losses: 5, ties: 0 },
  second: { wins: 3, losses: 7, ties: 0 },
  unknown: 4,
  coverage: 88,
  firstShare: 75,
  secondShare: 30,
  gap: 45,
  z: 2.4,
  p: 0.02,
  verdict: 'clear',
  text: 'Empezando ganás el 75 % (n = 20) y yendo segundo el 30 % (n = 10): 45 puntos más empezando.',
}
const coin: CoinAdjusted = {
  value: 52.5,
  ci95: [36.7, 69.3],
  first: turnOrder.first,
  second: turnOrder.second,
  firstShare: 75,
  secondShare: 30,
  games: 30,
  unknown: 4,
  orientative: false,
  plain: 60,
  text: 'Ajustado por la moneda: 53 % (mitad empezando, 75 % en 20; mitad yendo segundo, 30 % en 10; IC 37–69 %). Sin ajustar: 60 %.',
}

describe('TurnOrderCard (Fase 25, Fase 44)', () => {
  it('adds the share with the coin when there is one', () => {
    render(<TurnOrderCard turnOrder={turnOrder} coinAdjusted={coin} />)
    expect(screen.getByText('Con la moneda pareja:')).toBeInTheDocument()
    expect(screen.getByText('52,5 %')).toBeInTheDocument()
    expect(screen.getByText(/Sin ajustar: 60 %/)).toBeInTheDocument()
  })

  it('phone review: «%» stays with its number and the counts carry their separator', () => {
    const { container } = render(<TurnOrderCard turnOrder={{ ...turnOrder, unknown: 1234 }} coinAdjusted={coin} />)
    // The raw text: Testing Library's queries read a no-break space as a plain one, so they cannot see «88 %» break.
    const text = container.textContent ?? ''
    expect(text).toContain('75\u00a0%')
    expect(text).toContain('52,5\u00a0%')
    expect(text).toContain('88\u00a0% de estas partidas tienen anotado quién empezó (1.234 sin el dato)')
  })

  it('without a match on each side, only the split', () => {
    render(<TurnOrderCard turnOrder={turnOrder} />)
    expect(screen.queryByText('Con la moneda pareja:')).toBeNull()
  })
})
