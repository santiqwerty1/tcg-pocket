// «Piezas de la interfaz»: the gallery of the pieces of mock-up D, with test data. What is checked here is what the
// page promises: it says its numbers are nobody's, on top and in every section; it draws each piece in each of its
// states; and it asks the API for nothing. How it measures on a phone is e2e/piezas.spec.ts.
import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'
import { DASH, NBSP } from '@/test/figures'
import { PiecesPage } from './PiecesPage'
import { LONG_NAME, NOTES } from './pieces/fixtures'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const NOTICE = 'Datos de prueba: ninguna cifra de esta página es tuya'

/** The sections of the page, by the id of each piece, in order. */
const PIECES = [
  ['sellos', 'Sellos'],
  ['marcas', 'Marcas'],
  ['mini-graficos', 'Mini-gráficos'],
  ['barra-de-intervalo', 'Barra de intervalo'],
  ['cifra', 'Cifra'],
  ['bloque', 'Bloque de una fuente'],
  ['leyenda', 'Leyenda'],
  ['tres-fuentes', 'Las tres fuentes de un mazo'],
] as const

function show() {
  return render(<PiecesPage />).container
}
/** The section of a piece, from the page or from the section itself. */
function piece(container: HTMLElement, id: string): HTMLElement {
  const selector = `[data-section="${id}"]`
  const found = container.matches(selector) ? container : container.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`no section of ${id}`)
  return found
}
/** A state of a piece, by the name it is drawn under. */
function state(container: HTMLElement, id: string, name: string | RegExp): HTMLElement {
  const found = [...piece(container, id).querySelectorAll<HTMLElement>('[data-state]')].filter((item) => {
    const written = item.getAttribute('data-state') ?? ''
    return typeof name === 'string' ? written === name : name.test(written)
  })
  if (found.length !== 1) throw new Error(`${found.length} states of ${id} named ${String(name)}`)
  return found[0] as HTMLElement
}
const count = (of: Element, selector: string) => of.querySelectorAll(selector).length
/** A text as it is read: a no-break space is a space. */
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replaceAll(NBSP, ' ')

describe('«Piezas de la interfaz»', () => {
  it('says that its numbers are test data: once on top, and once in every section', () => {
    const container = show()
    const notices = [...container.querySelectorAll('[data-notice]')]
    expect(notices.map((notice) => notice.textContent)).toEqual(Array(PIECES.length + 1).fill(NOTICE))
    // The first thing of the page, before any number.
    expect(container.firstElementChild?.firstElementChild?.firstElementChild).toBe(notices[0])
    expect(container.querySelectorAll('[data-section]')).toHaveLength(PIECES.length)
    for (const [id] of PIECES) {
      const section = piece(container, id)
      const own = section.querySelectorAll('[data-notice]')
      expect(own, id).toHaveLength(1)
      // Before the first state of the section, not after its numbers.
      const first = section.querySelector('[data-state]') as Element
      expect(own[0]?.compareDocumentPosition(first) ?? 0, id).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
  })

  it('has one section for each piece, in order from the smallest to the whole, each named by its heading', () => {
    const container = show()
    expect(
      [...container.querySelectorAll('[data-section]')].map((section) => section.getAttribute('data-section')),
    ).toEqual(PIECES.map(([id]) => id))
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(
      PIECES.map(([, title]) => title),
    )
    for (const [id, title] of PIECES) {
      // A region of the page, named by its own heading.
      expect(screen.getByRole('region', { name: title })).toBe(piece(container, id))
    }
    // No heading of the first level: the title of the page is the header's.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('every state is under its own name, and no two states of a piece share one', () => {
    const container = show()
    const states = (id: string) =>
      [...piece(container, id).querySelectorAll('[data-state]')].map((item) => item.getAttribute('data-state'))
    expect(PIECES.map(([id]) => states(id).length)).toEqual([4, 6, 12, 4, 16, 14, 4, 2])
    for (const [id] of PIECES) {
      expect(new Set(states(id)).size, id).toBe(states(id).length)
      for (const item of piece(container, id).querySelectorAll('[data-state]')) {
        // Its name is its first heading (the three sources of a deck have one more, of their own: the detail of the
        // tournament).
        expect(within(item as HTMLElement).getAllByRole('heading', { level: 3 })[0]?.textContent, id).toBe(
          item.getAttribute('data-state'),
        )
      }
    }
  })

  it('draws this many of each piece: what the screens suite measures', () => {
    const container = show()
    const drawn = (selector: string) => count(container, selector)
    // Change these with the page, and with e2e/piezas.spec.ts, which counts the same things in the browser.
    expect({
      seals18: drawn('[data-slot="source-seal"].size-\\[18px\\]'),
      seals16: drawn('[data-slot="source-seal"].size-\\[16px\\]'),
      orientative: drawn('[data-slot="orientative-mark"]'),
      coverage: drawn('[data-slot="coverage-mark"]'),
      noData: drawn('[data-slot="no-data"]'),
      intervalMarks: drawn('[data-slot="interval-mark"]'),
      barMarks: drawn('[data-slot="bar-mark"]'),
      recordBars6: drawn('[data-slot="record-bar"].h-\\[6px\\]'),
      recordBars12: drawn('[data-slot="record-bar"].h-\\[12px\\]'),
      intervalBars: drawn('[data-slot="interval-bar"]'),
      figures: drawn('[data-slot="figure"]'),
      rowBlocks: drawn('[data-slot="source-block"][data-size="row"]'),
      laneBlocks: drawn('[data-slot="source-block"][data-size="lane"]'),
      legends: drawn('[data-slot="source-legend"]'),
      middleTicks: drawn('[data-state*="marca del medio"] [data-part="tick"]'),
    }).toEqual({
      seals18: 40,
      seals16: 20,
      orientative: 16,
      coverage: 4,
      noData: 9,
      intervalMarks: 7,
      barMarks: 3,
      recordBars6: 2,
      recordBars12: 2,
      intervalBars: 19,
      figures: 18,
      rowBlocks: 13,
      laneBlocks: 7,
      legends: 6,
      middleTicks: 3,
    })
    expect(drawn('[data-slot="source-seal"]')).toBe(40 + 20)
  })

  it('the seals: the three sources at both sizes, and the quiet M', () => {
    const section = piece(show(), 'sellos')
    const letters = (of: Element) =>
      [...of.querySelectorAll('[data-slot="source-seal"]')].map((seal) => seal.textContent)
    expect(letters(state(section, 'sellos', /^18 px/))).toEqual(['M', 'T', 'B'])
    expect(text(state(section, 'sellos', /^18 px/))).toContain('Mis partidasTTorneosBBots')
    // Beside its name a seal is decoration; alone it says its source.
    for (const seal of state(section, 'sellos', /^18 px/).querySelectorAll('[data-slot="source-seal"]')) {
      expect(seal).toHaveAttribute('aria-hidden', 'true')
    }
    const alone = [...state(section, 'sellos', /^16 px/).querySelectorAll('[data-slot="source-seal"]')]
    expect(alone.map((seal) => seal.getAttribute('aria-label'))).toEqual(['Mis partidas', 'Torneos', 'Bots'])
    const quiet = state(section, 'sellos', /callada/).querySelector('[data-slot="source-seal"]')
    expect(quiet).toHaveClass('bg-foreground-2', 'size-[16px]')
    expect(alone[0]).toHaveClass('bg-foreground')
    // A name more exact than its source's is the one it says.
    const exact = state(section, 'sellos', /^Con un nombre más exacto/).querySelector('[data-slot="source-seal"]')
    expect(exact).toHaveTextContent('T')
    expect(exact).toHaveAttribute('role', 'img')
    expect(exact).toHaveAttribute('aria-label', 'Torneo, lista exacta')
  })

  it('the marks: «orientativo» by each thing it can count, no coverage, and the two texts of no data', () => {
    const section = piece(show(), 'marcas')
    // Each mark with the words that say it, written beside it: the mark is decoration there, and the words are read.
    const words = [...section.querySelectorAll('[data-slot="mark-words"]')]
    expect(words.map((item) => text(item))).toEqual([
      'orientativo: menos de 30 partidas',
      'orientativo: menos de 30 listas',
      'orientativo: menos de 30 partidas simuladas',
      'sin cruces con datos en el meta',
    ])
    expect(words.map((item) => item.querySelector('[data-slot$="-mark"]')?.getAttribute('data-slot'))).toEqual([
      'orientative-mark',
      'orientative-mark',
      'orientative-mark',
      'coverage-mark',
    ])
    for (const mark of section.querySelectorAll('[data-slot$="-mark"]')) {
      expect(mark).toHaveAttribute('aria-hidden', 'true')
      expect(mark).not.toHaveAttribute('aria-label')
    }
    expect(text(state(section, 'marcas', 'Orientativo: por listas de torneo'))).toContain(
      'orientativo: menos de 30 listas',
    )
    expect(text(state(section, 'marcas', 'Sin cruces con datos'))).toContain('sin cruces con datos en el meta')
    expect([...section.querySelectorAll('[data-slot="no-data"]')].map((item) => item.textContent)).toEqual([
      'sin datos',
      'sin partidas',
    ])
  })

  it('the small charts: a figure, a real zero, a hundred, no interval, no data, a cut scale with a reference', () => {
    const section = piece(show(), 'mini-graficos')
    const parts = (of: Element) =>
      [...of.querySelectorAll('[data-slot="interval-mark"] > *')].map((item) => item.getAttribute('data-part'))
    const left = (of: Element, name: string) => of.querySelector<HTMLElement>(`[data-part="${name}"]`)?.style.left
    // The point is drawn over the tick of the middle, so where a state shows the tick its point is away from 50
    // (the screens suite measures that it is clear of it).
    const full = state(section, 'mini-graficos', /^Punto e intervalo sobre 0–100/)
    expect(parts(full)).toEqual(['track', 'tick', 'band', 'point'])
    expect(left(full, 'tick')).toBe('50%')
    expect(left(full, 'point')).toBe('35.71%')
    expect(text(full)).toContain('35,7 %, n = 70 en 14 listas')
    const zero = state(section, 'mini-graficos', /^Un 0\s% real/)
    expect(left(zero, 'point')).toBe('0%')
    expect(text(zero)).toContain('0 %, n = 1')
    expect(left(state(section, 'mini-graficos', /^Un 100\s%/), 'point')).toBe('100%')
    // No interval: the point alone, and the words do not say «IC».
    const alone = state(section, 'mini-graficos', 'Sin intervalo: solo el punto')
    expect(parts(alone)).toEqual(['track', 'tick', 'point'])
    expect(text(alone)).not.toContain('IC')
    // No data: the dashed track, «sin datos», and no percentage.
    const empty = state(section, 'mini-graficos', 'Sin datos: la guía punteada')
    expect(empty.querySelector('[data-slot="interval-mark"]')).toHaveAttribute('data-empty')
    expect(parts(empty)).toEqual(['track'])
    expect(text(empty)).toContain('sin datos')
    expect(text(empty)).not.toMatch(/\d\s*%/)
    // A cut scale: no tick of the middle, the amber mark of the reference, said in words too.
    const cut = state(section, 'mini-graficos', /^Escala cortada a 40–70, con una referencia/)
    expect(parts(cut)).toEqual(['track', 'band', 'reference', 'point'])
    expect(text(cut)).toContain('esperable: 55,8 %')
    // On a cut scale the tick of the middle is there only when it is asked for: 50 is a third of 40–70.
    const ticked = state(section, 'mini-graficos', /^Escala cortada a 40–70, con la marca del medio pedida/)
    expect(parts(ticked)).toEqual(['track', 'tick', 'band', 'point'])
    expect(left(ticked, 'tick')).toBe('33.33%')
    // Its point inside the scale, and not on the tick: 66,7 % is near the right end of 40–70.
    expect(left(ticked, 'point')).toBe('88.89%')
    expect(text(ticked)).toContain('66,7 %, n = 24')
    // Every chart has its words under it: none says something that is not written.
    for (const item of section.querySelectorAll('[data-state]')) {
      const name = item.getAttribute('data-state') ?? ''
      expect(text(item).slice(name.length).trim(), name).not.toBe('')
    }
  })

  it('the bars: against the largest of a column, a record at both sizes, parts that are no record, and nothing', () => {
    const section = piece(show(), 'mini-graficos')
    const fills = [...section.querySelectorAll<HTMLElement>('[data-slot="bar-mark"] [data-part="fill"]')]
    expect(fills.map((fill) => fill.style.width)).toEqual(['100%', '55.24%', '8.39%'])
    const tones = (of: Element) =>
      [...of.querySelectorAll('[data-slot="record-bar"] > *')].map((part) => part.getAttribute('data-tone'))
    expect(tones(state(section, 'mini-graficos', /^Récord, 6 px/))).toEqual(['win', 'loss', 'draw'])
    expect(text(state(section, 'mini-graficos', /^Récord, 6 px/))).toContain('24 V · 22 D · 1 E')
    expect(tones(state(section, 'mini-graficos', /^Récord, 12 px/))).toEqual(['win', 'loss', 'draw'])
    const parts = state(section, 'mini-graficos', 'Partes que no son un récord')
    expect(tones(parts)).toEqual(['strong', 'soft', 'none'])
    // Alone with no record written: it says its parts itself.
    expect(within(parts).getByRole('img', { name: '212 completas · 61 empezadas · 27 sin tener' })).toBeInTheDocument()
    expect(tones(state(section, 'mini-graficos', 'Sin nada que contar'))).toEqual([])
  })

  it('the interval bar: alone, with a reference and its two labels, and on a cut scale', () => {
    const section = piece(show(), 'barra-de-intervalo')
    // What each bar says to who does not see it.
    const names = [...section.querySelectorAll('[data-slot="interval-bar"] [role="img"][data-part="bar"]')].map((bar) =>
      (bar.getAttribute('aria-label') ?? '').replaceAll(NBSP, ' '),
    )
    expect(names).toEqual([
      `51,1 %, IC 37,2${DASH}64,7 %`,
      `66,7 %, IC 46,7${DASH}82,0 %, esperable: 55,8 %`,
      `51,1 %, IC 37,2${DASH}64,7 %`,
      // A name of its own, which says whose number it is.
      `Mis partidas: 51,1 %, n = 47, IC 37,2${DASH}64,7 %`,
    ])
    const labelled = state(section, 'barra-de-intervalo', 'Con una referencia y sus rótulos')
    expect(text(labelled.querySelector('[data-part="above"]'))).toBe('Mvos 66,7 %')
    expect(text(labelled.querySelector('[data-part="below"]'))).toBe('esperable 55,8 %')
    expect(labelled.querySelector('[data-part="reference"]')).not.toBeNull()
    expect(
      state(section, 'barra-de-intervalo', /^Escala cortada/).querySelector<HTMLElement>('[data-part="tick"]')?.style
        .left,
    ).toBe('33.33%')
  })

  it('the figure: its four sizes, and each state a cell can be in', () => {
    const section = piece(show(), 'cifra')
    const figure = (name: string | RegExp) =>
      state(section, 'cifra', name).querySelector('[data-slot="figure"]') as HTMLElement
    expect(
      [...section.querySelectorAll('[data-slot="figure"]')].map((item) => item.getAttribute('data-size')).slice(0, 4),
    ).toEqual(['cell', 'header', 'hero', 'score'])
    // With data: the percentage and its n, never one without the other.
    for (const item of section.querySelectorAll('[data-slot="figure"]:not([data-empty])')) {
      expect(item.querySelector('[data-part="value"]')?.textContent, text(item)).toMatch(/\d/)
      expect(item.querySelector('[data-part="n"]')?.textContent, text(item)).toMatch(/^n\s\d/)
    }
    expect(text(figure('Celda de una tabla'))).toBe(`M 51,1 % n 47, IC 37,2${DASH}64,7 %`)
    // «orientativo» says what it counted: matches, or lists (also with 70 games in 14 lists).
    const mark = (name: string | RegExp) =>
      figure(name).querySelector('[data-slot="orientative-mark"]')?.getAttribute('aria-label')
    expect(mark('Orientativa por partidas')).toBe('orientativo: menos de 30 partidas')
    expect(mark('Orientativa por listas')).toBe('orientativo: menos de 30 listas')
    expect(mark(/^Más de 30 partidas en pocas listas/)).toBe('orientativo: menos de 30 listas')
    expect(text(figure(/^Más de 30 partidas en pocas listas/))).toContain('35,7 % n 70')
    // No data: the text, and no percentage at all.
    const empty = figure('Sin datos')
    expect(empty).toHaveAttribute('data-empty')
    expect(text(empty)).toBe('M sin datos')
    // Or why there is nothing, in its place.
    expect(figure('Sin datos, con su motivo')).toHaveAttribute('data-empty')
    expect(text(figure('Sin datos, con su motivo'))).toBe('M sin partidas')
    // A real zero is a figure.
    expect(text(figure(/^Un 0\s% real/))).toContain('0,0 % n 1')
    expect(figure(/^Un 0\s% real/)).not.toHaveAttribute('data-empty')
    // No interval and no coverage: the ▲, and no «IC» said.
    const bare = figure('Sin intervalo y sin cruces con datos')
    expect(bare.querySelector('[data-slot="coverage-mark"]')).not.toBeNull()
    expect(text(bare)).not.toContain('IC')
    // Another era: quiet, and it says which.
    expect(figure(/^De otra era/)).toHaveAttribute('data-stale')
    expect(text(figure(/^De otra era/))).toContain('de la era B4b')
    // Sorted by n: the n goes first.
    expect(text(figure('En una tabla ordenada por n'))).toMatch(/^M n 47 51,1 %/)
    // In a column one decimal always; out of it, one at most.
    expect(text(figure(/^Un decimal fijo/))).toContain('50,0 % n 14.179')
    expect(text(figure(/^Un decimal como mucho/))).toContain('50 % n 14.179')
    // A cell that is not in a column can be told so.
    expect(text(figure(/^Una celda suelta/))).toContain('50 % n 14.179')
    expect(figure(/^Una celda suelta/)).toHaveAttribute('data-size', 'cell')
  })

  it('the block of a source: with data, «orientativo» by matches and by lists, no data, a zero, and the rest', () => {
    const section = piece(show(), 'bloque')
    const block = (name: string | RegExp) =>
      state(section, 'bloque', name).querySelector('[data-slot="source-block"]') as HTMLElement
    expect(text(block('Con datos'))).toBe(`MMis partidas51,1 % n = 47IC 37,2${DASH}64,7 % · 24 V · 22 D · 1 E`)
    expect(text(block('Orientativo por partidas'))).toContain('orientativo: menos de 30 partidas')
    // 70 games in 14 lists: «orientativo», and it says lists.
    expect(text(block('Orientativo por listas'))).toContain('35,7 % n = 70 en 14 listas')
    expect(text(block('Orientativo por listas'))).toContain('orientativo: menos de 30 listas')
    expect(text(block('Orientativo por listas'))).not.toContain('menos de 30 partidas')
    // No data: the text and the note, no chart and no percentage.
    const empty = block('Sin datos')
    expect(text(empty)).toBe(`MMis partidassin datos${NOTES.noMatches}`)
    expect(empty.querySelector('[data-part="chart"]')).toBeNull()
    expect(empty).not.toHaveAttribute('data-unavailable')
    // A real zero, drawn and written.
    expect(text(block(/^Un 0\s% real/))).toContain('0 % n = 1')
    expect(block(/^Un 0\s% real/).querySelector('[data-part="chart"]')).not.toBeNull()
    // No interval: no band and no «IC»; no coverage: the ▲ and its words.
    const bare = block('Sin intervalo y sin cruces con datos')
    expect(bare.querySelector('[data-part="band"]')).toBeNull()
    expect(text(bare)).not.toContain('IC')
    expect(bare.querySelector('[data-slot="coverage-mark"]')).not.toBeNull()
    expect(text(bare)).toContain('cruces con datos: 0 % del meta')
    expect(text(block('Con cruces en una parte del meta'))).toContain('cruces con datos: 73,2 % del meta')
    expect(block('Con cruces en una parte del meta').querySelector('[data-slot="coverage-mark"]')).toBeNull()
    // Another era.
    expect(text(block('De otra era'))).toContain('de la era B4b')
    // Not available: the dashed box and its reason.
    const off = block('Fuente no disponible')
    expect(off).toHaveAttribute('data-unavailable')
    expect(text(off)).toBe(`TTorneosin datos${NOTES.noTournaments}`)
    // A warning, before the note.
    const warned = block('Con un aviso y su nota')
    expect(warned.querySelector('[data-part="warning"]')).toHaveTextContent(NOTES.blindSpot)
    expect(warned.querySelector('[data-part="note"]')).toHaveTextContent(NOTES.bots)
    // A long name: whole.
    expect(text(block(/^Nombre largo/))).toContain(LONG_NAME)
    // A reference: drawn and said.
    expect(block('Con una referencia').querySelector('[data-part="reference"]')).not.toBeNull()
    expect(text(block('Con una referencia'))).toContain('esperable: 55,8 %')
    // A lane on a cut scale writes its two ends, and its bar has no tick it was not asked for.
    const zoomed = block(/^Una franja sobre una escala cortada/)
    expect(zoomed).toHaveAttribute('data-size', 'lane')
    expect([...zoomed.querySelectorAll('[data-part="chart"] > span')].map(text)).toEqual(['40', '70'])
    expect(zoomed.querySelector('[data-part="tick"]')).toBeNull()
    // Thousands of matches in many lists: the n is whole, beside or under a name that keeps its words.
    expect(text(block(/^Con miles de partidas/))).toContain('Su arquetipo en torneos47,9 % n = 12.406 en 1.203 listas')
  })

  it('the legend: of a card with everything, of a view, and of one source with no interval written', () => {
    const section = piece(show(), 'leyenda')
    const keys = (name: string | RegExp) =>
      [...state(section, 'leyenda', name).querySelectorAll('[data-key]')].map((key) => key.getAttribute('data-key'))
    expect(keys(/^Al pie de una tarjeta/)).toEqual([
      'matches',
      'tournament',
      'simulation',
      'orientative',
      'coverage',
      'interval',
    ])
    expect(text(state(section, 'leyenda', /^Al pie de una tarjeta/))).toContain('bots g2')
    expect(text(state(section, 'leyenda', /^Al pie de una tarjeta/))).toContain(
      'orientativo: menos de 30 partidas, o de 30 listas en torneos, o de 30 partidas simuladas',
    )
    expect(keys('Al pie de una vista')).toEqual(['matches', 'tournament', 'simulation', 'orientative', 'interval'])
    expect(keys(/^De una sola fuente/)).toEqual(['matches'])
    // Where every figure is «orientativo» the legend says it once, in a sentence of the screen, and the figures do
    // not draw the mark (each still says it to a screen reader).
    const all = state(section, 'leyenda', /^Todo orientativo/)
    expect(keys(/^Todo orientativo/)).toEqual(['matches', 'sentence'])
    expect(text(all.querySelector('[data-key="sentence"]'))).toBe(
      'Todo lo de arriba es orientativo: menos de 30 partidas.',
    )
    expect(all.querySelectorAll('[data-slot="figure"]')).toHaveLength(2)
    expect(all.querySelector('[data-slot="orientative-mark"]')).toBeNull()
    for (const figure of all.querySelectorAll('[data-slot="figure"]')) {
      expect(text(figure.querySelector('.sr-only'))).toContain('orientativo: menos de 30 partidas')
    }
  })

  it('the three sources of a deck: the deck page’s own blocks, with a number in each and with none', () => {
    const section = piece(show(), 'tres-fuentes')
    const full = within(section).getByRole('region', { name: 'Tres fuentes, nunca mezcladas' })
    const empty = within(section).getByRole('region', { name: 'Tres fuentes de un mazo sin datos' })
    const sources = (of: Element) =>
      [...of.querySelectorAll('[data-slot="source-block"]')].map((block) => block.getAttribute('data-source'))
    expect(sources(full)).toEqual(['matches', 'tournament', 'simulation'])
    expect(sources(empty)).toEqual(['matches', 'tournament', 'simulation'])
    expect([...full.querySelectorAll('[data-part="value"]')].map(text)).toEqual(['51,1 %', '12,5 %', '50 %'])
    expect(text(full)).toContain('n = 8 en 2 listas')
    expect(full.querySelector('[data-part="warning"]')).toHaveTextContent(NOTES.blindSpot)
    expect(text(full.querySelector('[data-slot="source-legend"]'))).toContain('orientativo: menos de 30 listas')
    // The detail of the tournament as the deck's page draws it: its rows, inside its block. What the page adds to
    // it (the choice of the deck's archetype) needs the archetypes of the era, and is not here.
    const detail = within(full.querySelector('[data-source="tournament"] [data-part="more"]') as HTMLElement)
    expect(detail.getByRole('heading', { level: 3, name: 'Torneo, en detalle' })).toBeInTheDocument()
    expect(detail.getAllByRole('listitem').map((row) => text(row).split(/\d/)[0])).toEqual([
      'Lista exacta',
      'Arquetipo: Butterfree Mega Sceptile ex',
    ])
    expect(full.querySelectorAll('[data-part="more"]')).toHaveLength(1)
    expect(within(full).queryByRole('combobox')).toBeNull()
    expect(within(full).queryByRole('link')).toBeNull()
    // With none: «sin datos» three times, two dashed boxes, and no percentage.
    expect(empty.querySelectorAll('[data-slot="no-data"]')).toHaveLength(3)
    expect(empty.querySelectorAll('[data-unavailable]')).toHaveLength(2)
    expect(text(empty)).not.toMatch(/\d\s*%/)
  })

  it('where there is no data there is never a zero: every empty figure and block says «sin datos» or its reason', () => {
    const container = show()
    const empty = [
      ...container.querySelectorAll('[data-slot="figure"][data-empty]'),
      ...[...container.querySelectorAll('[data-slot="source-block"]')].filter((block) =>
        block.querySelector(':scope > [data-part="head"] [data-slot="no-data"]'),
      ),
    ]
    // Two figures, two blocks, and the three sources of the deck with no data.
    expect(empty).toHaveLength(2 + 2 + 3)
    for (const item of empty) expect(text(item)).not.toMatch(/\d\s*%/)
  })

  it('writes every percentage with the space that does not break', () => {
    // Testing Library reads the two spaces as one: this reads the text as it is.
    const all = show().textContent ?? ''
    expect(all).not.toMatch(/\d %/)
    expect(all.match(new RegExp(`\\d${NBSP}%`, 'g'))?.length).toBeGreaterThan(60)
  })
})

describe('the gallery in the app', () => {
  const ownClock = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  function open(path: string) {
    const api = fakeApi({})
    const router = createMemoryRouter(routes, { initialEntries: [path] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    return { ...api, router }
  }

  it('opens at /mas/piezas under its title, and «Volver» leads to «Acerca de»', async () => {
    const { router } = open('/mas/piezas')
    expect(await screen.findByRole('heading', { level: 1, name: 'Piezas de la interfaz' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Sellos' })).toBeInTheDocument()
    // The one h1 is the header's.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await act(async () => screen.getByRole('button', { name: 'Volver' }).click())
    // «Acerca de» loads its own chunk before the address changes.
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/mas/acerca'))
  })

  it('point 6: it asks for nothing, not on opening and not in two hours', async () => {
    // The chunk of the page first: under the clock of the test nothing waits on a real load.
    await import('./PiecesPage')
    ownClock()
    const { calls, fetchMock } = open('/mas/piezas')
    for (let round = 0; round < 5; round++) await pass(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Piezas de la interfaz' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-section]')).toHaveLength(PIECES.length)
    expect(calls).toEqual([])
    // Two hours: far beyond any wait before asking, and four times the half hour of the frame's alerts.
    await pass(120 * 60_000)
    expect(calls).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
