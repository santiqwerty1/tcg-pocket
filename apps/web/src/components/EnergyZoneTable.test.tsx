import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DrawOdds } from '@/api/schemas'
import { DrawOddsTable } from './DrawOddsTable'
import { EnergyZoneTable } from './EnergyZoneTable'

const rows = (offset: number, probabilities: number[]) =>
  probabilities.map((probability, i) => ({ turn: i + 1, energies: Math.max(0, i + 1 - offset), probability }))

const odds: DrawOdds = {
  deck: { id: '4', name: 'Mega-Manectric ex / Heliolisk' },
  deckSize: 20,
  basics: 4,
  groups: [{ cards: [{ groupId: 'B2b-27', nameEs: 'Mega-Manectric ex' }], copies: 2, basicCopies: 0 }],
  rows: [
    { turn: 0, cardsSeen: 5, each: [0.45], all: null },
    { turn: 1, cardsSeen: 6, each: [0.53], all: null },
  ],
  basicsInHand: [{ count: 1, probability: 1 }],
  search: {
    cards: { pokeball: 2, research: 2, communication: 1 },
    runs: 20000,
    seed: 44,
    rows: [
      { turn: 0, probability: 0.45, se: 0.003 },
      { turn: 1, probability: 0.71, se: 0.003 },
    ],
    note: 'Simulación con semilla fija.',
  },
  energy: {
    attacker: { groupId: 'B2b-27', nameEs: 'Mega-Manectric ex' },
    types: ['lightning', 'fire'],
    attacks: [
      {
        name: 'Electrorrayo',
        cost: ['lightning', 'lightning', 'colorless'],
        payable: true,
        first: rows(1, [0, 0, 0, 0.5, 0.6875]),
        second: rows(0, [0, 0, 0.5, 0.6875, 0.8125]),
        likelyTurn: { first: 4, second: 3 },
      },
      {
        name: 'Garra Metal',
        cost: ['metal'],
        payable: false,
        first: rows(1, [0, 0, 0, 0, 0]),
        second: rows(0, [0, 0, 0, 0, 0]),
        likelyTurn: { first: null, second: null },
      },
    ],
    note: 'Toda la energía va al atacante.',
  },
  note: 'Solo robo natural.',
}

describe('draw odds with the search cards and the Energy Zone (Fase 44)', () => {
  it('shows the column counting the search cards, and which ones', () => {
    render(<DrawOddsTable data={odds} labels={['Mega-Manectric ex']} />)
    expect(screen.getByText('Con búsqueda')).toBeInTheDocument()
    expect(screen.getByText('71 %')).toBeInTheDocument()
    expect(screen.getByText(/2 Poké Ball, 2 Investigación de Profesores, 1 Comunicación Pokémon/)).toBeInTheDocument()
  })

  it('each attack by turn going first and second, and one the deck cannot pay', () => {
    render(<EnergyZoneTable energy={odds.energy as NonNullable<DrawOdds['energy']>} />)
    expect(screen.getByText('Energía para atacar con Mega-Manectric ex')).toBeInTheDocument()
    expect(screen.getByText('(2 Rayo + 1 Incolora)')).toBeInTheDocument()
    expect(screen.getAllByText('68,8 %')).toHaveLength(2)
    expect(screen.getByText(/Pide una energía que el mazo no tiene/)).toBeInTheDocument()
  })
})
