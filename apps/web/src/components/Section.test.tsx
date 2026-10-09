import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Fold, Section } from './Section'

describe('Fold', () => {
  it('mounts its content (and what it fetches) only when opened, and keeps the title once', async () => {
    const mounted = vi.fn()
    function Heavy() {
      useEffect(() => mounted(), [])
      return <Section title="Mano inicial">contenido</Section>
    }
    const user = userEvent.setup()
    render(
      <Fold title="Mano inicial">
        <Heavy />
      </Fold>,
    )
    expect(mounted).not.toHaveBeenCalled()
    expect(screen.queryByText('contenido')).toBeNull()

    await user.click(screen.getByText('Mano inicial'))
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(screen.getByText('contenido')).toBeVisible()
    // The summary is the title: the inner Section does not repeat it.
    expect(screen.getAllByRole('heading', { name: 'Mano inicial' })).toHaveLength(1)
  })

  it('remembers on this device that it was left open', async () => {
    localStorage.setItem('tcg.fold.prueba', '1')
    render(
      <Fold title="Revisiones" remember="tcg.fold.prueba">
        <p>lista</p>
      </Fold>,
    )
    expect(screen.getByText('lista')).toBeInTheDocument()
  })
})
