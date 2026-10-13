import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoadingRows } from './ListState'

afterEach(() => vi.restoreAllMocks())

describe('LoadingRows without signal (phone review: an endless skeleton)', () => {
  it('says the screen loads when the signal is back', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(<LoadingRows />)
    expect(screen.getByText('Sin señal: esto se carga cuando vuelva la conexión.')).toBeInTheDocument()
  })

  it('says nothing with signal', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    render(<LoadingRows />)
    expect(screen.queryByText(/Sin señal/)).not.toBeInTheDocument()
  })
})
