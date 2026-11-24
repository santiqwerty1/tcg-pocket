import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlusIcon } from 'lucide-react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { FixedRow, ViewTabs } from './FixedRow'
import type { FrameAction, FrameView } from './frame'

const VIEWS: FrameView[] = [
  { label: 'Sobres', path: '/sobres' },
  { label: 'Colección', path: '/coleccion' },
]
const ACTION: FrameAction = { label: 'Sincronizar', icon: PlusIcon, to: '/coleccion/importar' }

function Where() {
  const location = useLocation()
  return <output aria-label="Dirección">{location.pathname + location.search}</output>
}

function renderRow(props: Parameters<typeof FixedRow>[0], at = '/sobres') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <FixedRow {...props} />
      <Where />
    </MemoryRouter>,
  )
}

const row = () => document.querySelector('[data-slot="fixed-row"]')

describe('the fixed row', () => {
  it('with views and an action shows the views and the action as an icon with its name', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas de Cartas', action: ACTION })
    const list = screen.getByRole('tablist', { name: 'Vistas de Cartas' })
    expect(row()).toContainElement(list)
    expect(
      within(list)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Sobres', 'Colección'])

    const action = screen.getByRole('link', { name: 'Sincronizar' })
    expect(row()).toContainElement(action)
    expect(action).toHaveAttribute('href', '/coleccion/importar')
    // Its icon alone: the name is for a screen reader and for the pointer.
    expect(action).toHaveTextContent('')
    expect(action).toHaveAttribute('aria-label', 'Sincronizar')
    expect(action).toHaveAttribute('title', 'Sincronizar')
    expect(action.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // The views first, the action at the right.
    expect(list.compareDocumentPosition(action)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('with only an action shows it with its text', () => {
    renderRow({ views: null, viewsLabel: null, action: ACTION })
    expect(screen.queryByRole('tablist')).toBeNull()
    const action = screen.getByRole('link', { name: 'Sincronizar' })
    expect(row()).toContainElement(action)
    expect(action).toHaveTextContent('Sincronizar')
    expect(action).not.toHaveAttribute('aria-label')
    expect(action).not.toHaveAttribute('title')
    expect(action).toHaveAttribute('href', '/coleccion/importar')
  })

  it('with only views shows them alone', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas de Cartas', action: null })
    expect(row()).toContainElement(screen.getByRole('tablist', { name: 'Vistas de Cartas' }))
    expect(within(row() as HTMLElement).queryByRole('link')).toBeNull()
  })

  it('with nothing is not drawn at all', () => {
    renderRow({ views: null, viewsLabel: null, action: null })
    expect(row()).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('the views as tabs', () => {
  it('the chosen view takes a plain click for itself, and leaves a click with a modifier to the browser', () => {
    render(
      <MemoryRouter initialEntries={['/coleccion?vista=edicion']}>
        <ViewTabs views={VIEWS} label="Vistas de Cartas" place="row" />
        <Where />
      </MemoryRouter>,
    )
    const coleccion = screen.getByRole('tab', { name: 'Colección' })
    // jsdom would try to load the link: the window stops it, after noting whether the view had stopped it first.
    const prevented: boolean[] = []
    const noLoad = (event: Event) => {
      prevented.push(event.defaultPrevented)
      event.preventDefault()
    }
    window.addEventListener('click', noLoad)
    fireEvent.click(coleccion)
    // Ctrl or ⌘: it opens in another window, as every other link of the frame.
    fireEvent.click(coleccion, { ctrlKey: true })
    fireEvent.click(coleccion, { metaKey: true })
    window.removeEventListener('click', noLoad)
    expect(prevented).toEqual([true, false, false])
    expect(screen.getByRole('status', { name: 'Dirección' })).toHaveTextContent('/coleccion?vista=edicion')
  })

  it('one is selected by the pathname alone, and it is the one stop of Tab', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/Coleccion/?vista=edicion']}>
        <ViewTabs views={VIEWS} label="Vistas de Cartas" place="top" />
        <Where />
      </MemoryRouter>,
    )
    const [sobres, coleccion] = screen.getAllByRole('tab')
    expect(coleccion).toHaveAttribute('aria-selected', 'true')
    expect(sobres).toHaveAttribute('aria-selected', 'false')
    await user.tab()
    expect(coleccion).toHaveFocus()
    await user.tab()
    expect(sobres).not.toHaveFocus()

    // The arrows go round and open the view they land on.
    coleccion?.focus()
    await user.keyboard('{ArrowRight}')
    expect(sobres).toHaveFocus()
    expect(screen.getByRole('status', { name: 'Dirección' })).toHaveTextContent('/sobres')
    expect(sobres).toHaveAttribute('aria-selected', 'true')
    expect(sobres).toHaveAttribute('tabindex', '0')
    expect(coleccion).toHaveAttribute('tabindex', '-1')
  })
})
