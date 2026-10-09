import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EnergyChips, EnergyPicker } from './EnergyChip'

describe('EnergyPicker', () => {
  it('shows the eight selectable energies in Spanish (no dragon, no colorless)', () => {
    render(<EnergyPicker value={[]} onChange={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Planta',
      'Fuego',
      'Agua',
      'Rayo',
      'Psíquico',
      'Lucha',
      'Oscuridad',
      'Metal',
    ])
    expect(screen.queryByText('Dragón')).toBeNull()
    expect(screen.queryByText('Incoloro')).toBeNull()
  })

  it('toggles chips and reports the selection in canonical order', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<EnergyPicker value={['lightning']} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Rayo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Fuego' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'Fuego' }))
    expect(onChange).toHaveBeenLastCalledWith(['fire', 'lightning'])

    await user.click(screen.getByRole('button', { name: 'Rayo' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('with 3 chosen, the others are off until one is taken out (P-006)', () => {
    render(<EnergyPicker value={['fire', 'water', 'lightning']} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Planta' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fuego' })).toBeEnabled()
  })
})

describe('EnergyChips', () => {
  it('renders a placeholder when the deck has no energy', () => {
    render(<EnergyChips energies={[]} />)
    expect(screen.getByText('sin energía')).toBeInTheDocument()
  })
})
