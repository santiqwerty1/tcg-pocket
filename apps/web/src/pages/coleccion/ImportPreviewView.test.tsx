import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import fixture from '@/api/__fixtures__/import-preview.json'
import { importPreviewSchema } from '@/api/schemas'
import { expansionOf, groupChangesByExpansion, ImportPreviewView } from './ImportPreviewView'

const preview = importPreviewSchema.parse(fixture)

describe('expansionOf', () => {
  it('handles plain and promo ids', () => {
    expect(expansionOf('A1-1')).toBe('A1')
    expect(expansionOf('B4b-372')).toBe('B4b')
    expect(expansionOf('P-A-23')).toBe('P-A')
  })
})

describe('groupChangesByExpansion', () => {
  it('groups consecutive changes by expansion keeping the API order', () => {
    const groups = groupChangesByExpansion(preview.changes)
    expect(groups.map((g) => [g.expansion, g.changes.length])).toEqual([
      ['A1', 1],
      ['A4a', 1],
      ['B3b', 1],
      ['B4b', 1],
    ])
  })
})

describe('ImportPreviewView', () => {
  it('renders the summary, the adjustment sections and the before → after rows', () => {
    render(
      <MemoryRouter>
        <ImportPreviewView preview={preview} />
      </MemoryRouter>,
    )
    expect(screen.getByText('tcgcollectiontracterexport.csv', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('4.317')).toBeInTheDocument()
    expect(screen.getByText('5.844')).toBeInTheDocument()
    expect(screen.getByText('4.714')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Ajustes que ya coinciden' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Latias' })).toHaveAttribute('href', '/grupos/A4a-36')
    expect(screen.getByText('ajuste 2')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Ajustes que esconden un cambio' })).toBeInTheDocument()
    expect(screen.getByText('stock 2 → 3 · ajuste 1')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'Cambios (4)' })).toBeInTheDocument()
    const bulbasaur = screen.getByText('Bulbasaur').closest('li')
    expect(bulbasaur).not.toBeNull()
    expect(within(bulbasaur as HTMLElement).getByText('A1-1, A4b-1')).toBeInTheDocument()
    expect(within(bulbasaur as HTMLElement).getByText('2 → 3')).toBeInTheDocument()
    expect(screen.getByText('0 → 2 · nueva')).toBeInTheDocument()
    expect(screen.queryByText(/errores en el archivo/)).toBeNull()
  })

  it('offers to retire matching adjustments when a handler is given', () => {
    const calls: string[] = []
    render(
      <MemoryRouter>
        <ImportPreviewView preview={preview} onResolveAdjustment={(id) => calls.push(id)} />
      </MemoryRouter>,
    )
    screen.getByRole('button', { name: 'Retirar' }).click()
    expect(calls).toEqual(['adj_latias'])
  })

  it('tells a twin conflict of ptcgpocket.gg as a mismatch to sync again, not as a file to fix in the tracker', () => {
    const conflict = {
      stockCardId: 'A1-1',
      rows: [
        { cardId: 'A1-1', line: 2, amountOwned: 2, collected: true },
        { cardId: 'A4b-1', line: 3, amountOwned: 1, collected: true },
      ],
    }
    const { unmount } = render(
      <MemoryRouter>
        <ImportPreviewView preview={{ ...preview, source: 'dotgg', twinConflicts: [conflict] }} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/desajuste entre ptcgpocket.gg y el catálogo/)).toBeInTheDocument()
    expect(screen.getByText(/La exportación de ptcgpocket.gg trae errores/)).toBeInTheDocument()
    expect(screen.queryByText(/Corregí el archivo en el tracker/)).not.toBeInTheDocument()
    unmount()
    render(
      <MemoryRouter>
        <ImportPreviewView preview={{ ...preview, twinConflicts: [conflict] }} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Corregí el archivo en el tracker/)).toBeInTheDocument()
  })
})
