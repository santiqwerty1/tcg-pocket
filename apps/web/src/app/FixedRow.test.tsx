import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlusIcon, RefreshCwIcon } from 'lucide-react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { FixedRow, ViewTabs } from './FixedRow'
import type { FrameAction, FrameView, RowActionSpec } from './frame'
import type { PageActionState } from './pageAction'

const VIEWS: FrameView[] = [
  { label: 'Sobres', path: '/sobres' },
  { label: 'Colección', path: '/coleccion' },
]
/** The shapes of the table of `frame.ts`, with what each one says. */
const PLUS: RowActionSpec = { label: 'Nueva simulación', icon: PlusIcon, kind: 'link', to: () => '/simulacion/nueva' }
const DECK: RowActionSpec = {
  label: 'Registrar partida',
  ariaLabel: 'Registrar partida con este mazo',
  icon: PlusIcon,
  kind: 'link',
  to: ({ deckId = '' }) => `/partidas?mazo=${deckId}`,
}
const SYNC: RowActionSpec = {
  label: 'Sincronizar',
  ariaLabel: 'Sincronizar la colección',
  icon: RefreshCwIcon,
  display: 'text',
  kind: 'button',
  pendingLabel: 'Sincronizando…',
}
/** Phase 4's: a button that writes, with its label from the data and no icon. */
const UPDATE: RowActionSpec = { label: 'Actualizar el mazo', kind: 'button' }
const SHEET: RowActionSpec = { label: 'Nueva prueba', icon: PlusIcon, kind: 'button', opens: 'dialog' }

const at = (spec: RowActionSpec, params: Record<string, string> = {}): FrameAction => ({ spec, params })

function Where() {
  const location = useLocation()
  return <output aria-label="Dirección">{location.pathname + location.search}</output>
}

function renderRow(props: Parameters<typeof FixedRow>[0], path = '/sobres') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FixedRow {...props} />
      <Where />
    </MemoryRouter>,
  )
}

const row = () => document.querySelector('[data-slot="fixed-row"]')
const action = () => {
  const found = row()?.querySelector<HTMLElement>('[data-slot="row-action"]')
  if (!found) throw new Error('no action in the row')
  return found
}
const spoken = () => within(row() as HTMLElement).getByRole('status')
const address = () => screen.getByRole('status', { name: 'Dirección' })

describe('the fixed row', () => {
  it('beside the views, an action of display «auto» is its icon alone, 48 × 48, named for both a reader and a pointer', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas de Cartas', action: at(PLUS) })
    const list = screen.getByRole('tablist', { name: 'Vistas de Cartas' })
    expect(row()).toContainElement(list)
    expect(
      within(list)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Sobres', 'Colección'])

    const plus = screen.getByRole('link', { name: 'Nueva simulación' })
    expect(plus).toBe(action())
    expect(plus).toHaveAttribute('href', '/simulacion/nueva')
    expect(plus).toHaveTextContent('')
    expect(plus).toHaveAttribute('aria-label', 'Nueva simulación')
    expect(plus).toHaveAttribute('title', 'Nueva simulación')
    expect(plus).toHaveAttribute('data-layout', 'icon')
    expect(plus).toHaveClass('h-[48px]', 'w-[48px]', 'flex-none')
    expect(plus.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(plus.querySelector('svg')).toHaveClass('size-[24px]')
    // The views first, the action at the right.
    expect(list.compareDocumentPosition(plus)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // A link is a link: no state of a button.
    expect(plus.tagName).toBe('A')
    expect(plus).not.toHaveAttribute('aria-disabled')
    expect(plus).not.toHaveAttribute('aria-haspopup')
  })

  it('beside the views, an action of display «text» keeps its icon and its text, and its longer name', () => {
    const select = vi.fn()
    renderRow(
      { views: VIEWS, viewsLabel: 'Vistas de Cartas', action: at(SYNC), page: { onSelect: select } },
      '/coleccion',
    )
    const sync = screen.getByRole('button', { name: 'Sincronizar la colección' })
    expect(sync).toBe(action())
    // Its label, and not its longer name: what is seen is the word, what is heard says more.
    expect(sync).toHaveTextContent(/^Sincronizar$/)
    expect(sync).toHaveAttribute('type', 'button')
    expect(sync).toHaveAttribute('data-layout', 'text')
    // It takes only what it needs: the views share the rest.
    expect(sync).toHaveClass('h-[48px]', 'flex-none', 'px-[16px]')
    expect(sync).not.toHaveClass('flex-1')
    expect(sync).not.toHaveAttribute('title')
    expect(sync.querySelector('svg')).toHaveClass('size-[20px]')
    fireEvent.click(sync)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('alone, an action takes the row with its text: a link, its longer name only when it has one', () => {
    renderRow({ views: null, viewsLabel: null, action: at(DECK, { deckId: '7' }) }, '/mazos/7')
    expect(screen.queryByRole('tablist')).toBeNull()
    const deck = screen.getByRole('link', { name: 'Registrar partida con este mazo' })
    expect(deck).toBe(action())
    expect(deck).toHaveTextContent(/^Registrar partida$/)
    expect(deck).toHaveAttribute('href', '/partidas?mazo=7')
    expect(deck).toHaveAttribute('data-layout', 'full')
    expect(deck).toHaveClass('h-[48px]', 'flex-1', 'px-[16px]')
    expect(deck).not.toHaveAttribute('title')
    fireEvent.click(deck)
    expect(address()).toHaveTextContent('/partidas?mazo=7')
  })

  it('alone and without a longer name, only its text names it', () => {
    renderRow({ views: null, viewsLabel: null, action: at(PLUS) }, '/mazos')
    const plus = screen.getByRole('link', { name: 'Nueva simulación' })
    expect(plus).toHaveTextContent(/^Nueva simulación$/)
    expect(plus).not.toHaveAttribute('aria-label')
    expect(plus).not.toHaveAttribute('title')
  })

  it('the views «arriba» leave an action of display «text» or «auto» alone, with its text', () => {
    renderRow({ views: null, viewsLabel: null, action: at(SYNC), page: { onSelect: () => {} } }, '/coleccion')
    const sync = screen.getByRole('button', { name: 'Sincronizar la colección' })
    expect(sync).toHaveAttribute('data-layout', 'full')
    expect(sync).toHaveClass('flex-1')
  })

  it('a button that opens a dialog says so', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas', action: at(SHEET), page: { onSelect: () => {} } })
    expect(screen.getByRole('button', { name: 'Nueva prueba' })).toHaveAttribute('aria-haspopup', 'dialog')
  })

  it('a button the page gave no handler is drawn, does nothing and says it is not available', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas de Cartas', action: at(SYNC) }, '/coleccion')
    const sync = screen.getByRole('button', { name: 'Sincronizar la colección' })
    expect(sync).toHaveAttribute('aria-disabled', 'true')
    expect(sync).not.toHaveAttribute('aria-busy')
    expect(sync).not.toBeDisabled()
    expect(sync).toHaveClass('opacity-50')
    fireEvent.click(sync)
    // Nothing to call, and nothing to say.
    expect(spoken()).toHaveTextContent('')
  })

  it('pending: a spinner in the icon’s place, busy, the pending text said, and taps ignored', async () => {
    const user = userEvent.setup()
    const select = vi.fn()
    const page: PageActionState = { onSelect: select, pending: false }
    const view = renderRow({ views: VIEWS, viewsLabel: 'Vistas de Cartas', action: at(SYNC), page }, '/coleccion')
    // The region that says it is there before anything is said, so what it says is announced.
    expect(spoken()).toHaveTextContent('')
    view.rerender(
      <MemoryRouter initialEntries={['/coleccion']}>
        <FixedRow views={VIEWS} viewsLabel="Vistas de Cartas" action={at(SYNC)} page={{ ...page, pending: true }} />
      </MemoryRouter>,
    )
    const sync = screen.getByRole('button', { name: 'Sincronizar la colección' })
    expect(sync).toHaveAttribute('aria-busy', 'true')
    expect(sync).toHaveAttribute('aria-disabled', 'true')
    // Still its text, and not dimmed: it is working, not unavailable.
    expect(sync).toHaveTextContent(/^Sincronizar$/)
    expect(sync).not.toHaveClass('opacity-50')
    const icons = sync.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveClass('animate-spin', 'size-[20px]')
    expect(spoken()).toHaveTextContent('Sincronizando…')
    await user.click(sync)
    sync.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(select).not.toHaveBeenCalled()
  })

  it('pending with nothing better to say, it says «Un momento…»; the icon alone spins at its size', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas', action: at(SHEET), page: { onSelect: () => {}, pending: true } })
    const sheet = screen.getByRole('button', { name: 'Nueva prueba' })
    expect(sheet.querySelector('svg')).toHaveClass('animate-spin', 'size-[24px]')
    expect(spoken()).toHaveTextContent('Un momento…')
  })

  it('what the page declares wins over the route: its label, its name and its pending text', () => {
    renderRow(
      {
        views: VIEWS,
        viewsLabel: 'Vistas de Cartas',
        action: at(SYNC),
        page: {
          onSelect: () => {},
          pending: true,
          ariaLabel: 'Sincronizar la colección con el juego',
          pendingLabel: 'Consultando ptcgpocket.gg…',
        },
      },
      '/coleccion',
    )
    expect(screen.getByRole('button', { name: 'Sincronizar la colección con el juego' })).toHaveTextContent(
      /^Sincronizar$/,
    )
    expect(spoken()).toHaveTextContent('Consultando ptcgpocket.gg…')
  })

  it('a label from the data and no icon: its text alone', () => {
    const select = vi.fn()
    renderRow({
      views: null,
      viewsLabel: null,
      action: at(UPDATE),
      page: { onSelect: select, label: 'Actualizar el mazo #1' },
    })
    const update = screen.getByRole('button', { name: 'Actualizar el mazo #1' })
    expect(update).toHaveTextContent(/^Actualizar el mazo #1$/)
    expect(update.querySelector('svg')).toBeNull()
    expect(update).toHaveAttribute('data-layout', 'full')
    fireEvent.click(update)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('a label from the data and no name drops the route’s longer name: the name keeps the words on screen', () => {
    renderRow({
      views: null,
      viewsLabel: null,
      action: at(DECK, { deckId: '1' }),
      page: { label: 'Registrar con el mazo #1' },
    })
    // WCAG 2.5.3: the route's «Registrar partida con este mazo» was written for the route's label, not the page's.
    const link = screen.getByRole('link', { name: 'Registrar con el mazo #1' })
    expect(link).toHaveTextContent(/^Registrar con el mazo #1$/)
    expect(link).not.toHaveAttribute('aria-label')
  })

  it('without an icon there is no icon to stand alone: beside the views it keeps its text', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas', action: at(UPDATE), page: { onSelect: () => {} } })
    const update = screen.getByRole('button', { name: 'Actualizar el mazo' })
    expect(update).toHaveTextContent(/^Actualizar el mazo$/)
    expect(update).toHaveAttribute('data-layout', 'text')
    expect(update).not.toHaveAttribute('title')
  })

  it('a link the page disables does not go anywhere', () => {
    renderRow(
      { views: null, viewsLabel: null, action: at(DECK, { deckId: '7' }), page: { disabled: true } },
      '/mazos/7',
    )
    const deck = screen.getByRole('link', { name: 'Registrar partida con este mazo' })
    expect(deck).toHaveAttribute('aria-disabled', 'true')
    expect(deck).toHaveClass('opacity-50')
    fireEvent.click(deck)
    fireEvent.click(deck, { ctrlKey: true })
    expect(address()).toHaveTextContent('/mazos/7')
  })

  it('with only views shows them alone', () => {
    renderRow({ views: VIEWS, viewsLabel: 'Vistas de Cartas', action: null })
    expect(row()).toContainElement(screen.getByRole('tablist', { name: 'Vistas de Cartas' }))
    expect(row()?.querySelector('[data-slot="row-action"]')).toBeNull()
    expect(within(row() as HTMLElement).queryByRole('status')).toBeNull()
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
