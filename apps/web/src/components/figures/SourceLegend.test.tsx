import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { INTERVAL_KEY, SOURCE_NAME, type SourceKey } from '@/lib/figure'
import { NBSP } from '@/test/figures'
import { SourceLegend } from './SourceLegend'

/** The legend as it is in the page: the root of what the component writes. */
function root(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  expect(container.children).toHaveLength(1)
  return container.firstElementChild as HTMLElement
}
const classes = (element: Element | null | undefined) => (element?.getAttribute('class') ?? '').split(/\s+/)
/** The keys of a legend, in the order they are written. */
const keys = (legend: HTMLElement) => [...legend.children].map((child) => child.getAttribute('data-key'))
function key(legend: HTMLElement, name: string): HTMLElement {
  const found = legend.querySelector<HTMLElement>(`:scope > [data-key="${name}"]`)
  if (!found) throw new Error(`the legend has no key for ${name}`)
  return found
}

const ALL: SourceKey[] = ['matches', 'tournament', 'simulation']

describe('SourceLegend', () => {
  it('says what each seal is: «M mis partidas», «T torneos», «B bots»', () => {
    const legend = root(<SourceLegend sources={ALL} />)
    expect(legend).toHaveAttribute('data-slot', 'source-legend')
    expect(keys(legend)).toEqual(['matches', 'tournament', 'simulation', 'interval'])
    expect(key(legend, 'matches').textContent).toBe('Mmis partidas')
    expect(key(legend, 'tournament').textContent).toBe('Ttorneos')
    expect(key(legend, 'simulation').textContent).toBe('Bbots')
    // The names are the sources' own, in lower case: a legend never calls a source by another name.
    for (const source of ALL) {
      expect(key(legend, source).textContent?.slice(1)).toBe(SOURCE_NAME[source].toLowerCase())
    }
  })

  it('lists exactly the sources it is given, in the order given', () => {
    expect(keys(root(<SourceLegend sources={['tournament']} />))).toEqual(['tournament', 'interval'])
    expect(keys(root(<SourceLegend sources={['tournament', 'matches']} />))).toEqual([
      'tournament',
      'matches',
      'interval',
    ])
    expect(keys(root(<SourceLegend sources={['simulation', 'matches']} />))).toEqual([
      'simulation',
      'matches',
      'interval',
    ])
    const none = root(<SourceLegend sources={[]} />)
    expect(keys(none)).toEqual(['interval'])
    expect(none.querySelector('[data-slot="source-seal"]')).toBeNull()
    // A source given twice has one key.
    expect(keys(root(<SourceLegend sources={['matches', 'tournament', 'matches']} />))).toEqual([
      'matches',
      'tournament',
      'interval',
    ])
  })

  it('names the bots only when the data names them, and only on the key of the bots', () => {
    expect(key(root(<SourceLegend sources={ALL} bot="g2" />), 'simulation').textContent).toBe('Bbots g2')
    for (const unnamed of [undefined, null, '']) {
      expect(key(root(<SourceLegend sources={ALL} bot={unnamed} />), 'simulation').textContent).toBe('Bbots')
    }
    const legend = root(<SourceLegend sources={ALL} bot="g2" />)
    expect(key(legend, 'matches').textContent).toBe('Mmis partidas')
    expect(key(legend, 'tournament').textContent).toBe('Ttorneos')
    // With no B figure above there is no key to hang the bots on.
    expect(root(<SourceLegend sources={['matches', 'tournament']} bot="g2" />).textContent).not.toMatch(/g2|bots/)
  })

  it('in a key the seal is decoration: the name it stands for is written right after it', () => {
    const legend = root(<SourceLegend sources={ALL} bot="g2" marks={{ orientative: ['matches'], coverage: true }} />)
    const seals = [...legend.querySelectorAll('[data-slot="source-seal"]')]
    expect(seals.map((seal) => seal.textContent)).toEqual(['M', 'T', 'B'])
    for (const seal of seals) expect(seal).toHaveAttribute('aria-hidden', 'true')
    // Nothing of a legend is an image to a reader: every key is its words.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  describe('the key of «orientativo»', () => {
    const orientative = (kinds: Parameters<typeof SourceLegend>[0]['marks']) =>
      key(root(<SourceLegend sources={ALL} marks={kinds} />), 'orientative').textContent

    it('says what the figures above counted', () => {
      expect(orientative({ orientative: ['matches'] })).toBe('orientativo: menos de 30 partidas')
      expect(orientative({ orientative: ['lists'] })).toBe('orientativo: menos de 30 listas')
      expect(orientative({ orientative: ['simulations'] })).toBe('orientativo: menos de 30 partidas simuladas')
    })

    it('with figures of more than one kind, it lists the kinds really there', () => {
      expect(orientative({ orientative: ['matches', 'lists'] })).toBe(
        'orientativo: menos de 30 partidas, o de 30 listas en torneos',
      )
      expect(orientative({ orientative: ['lists', 'matches', 'lists'] })).toBe(
        'orientativo: menos de 30 partidas, o de 30 listas en torneos',
      )
      expect(orientative({ orientative: ['matches', 'lists', 'simulations'] })).toBe(
        'orientativo: menos de 30 partidas, o de 30 listas en torneos, o de 30 partidas simuladas',
      )
    })

    it('is left out when no figure above is «orientativo»', () => {
      for (const marks of [undefined, {}, { orientative: [] }, { coverage: true }] as const) {
        const legend = root(<SourceLegend sources={ALL} marks={marks} />)
        expect(keys(legend)).not.toContain('orientative')
        expect(legend.textContent).not.toMatch(/orientativo/)
        expect(legend.querySelector('[data-slot="orientative-mark"]')).toBeNull()
      }
    })

    it('draws the mark before the words, as decoration, and keeps it on the line of the first word', () => {
      const legend = root(<SourceLegend sources={ALL} marks={{ orientative: ['matches', 'lists'] }} />)
      const mark = legend.querySelector('[data-slot="orientative-mark"]') as HTMLElement
      expect(key(legend, 'orientative')).toContainElement(mark)
      expect(mark.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(mark.closest('.whitespace-nowrap')).toHaveTextContent(/^orientativo:$/)
      // The rest of a long key wraps: the key itself is not one unbreakable piece.
      expect(classes(key(legend, 'orientative'))).not.toContain('whitespace-nowrap')
      expect(classes(mark)).toContain('mr-[5px]')
    })

    it('carries no name at all: nothing of a legend says a kind its key does not write', () => {
      // The mark beside the key used to keep the name of a mark that counts matches, under a key that said lists.
      for (const kinds of [['lists'], ['simulations'], ['matches', 'lists']] as const) {
        const legend = root(<SourceLegend sources={ALL} bot="g2" marks={{ orientative: kinds, coverage: true }} />)
        const named = [legend, ...legend.querySelectorAll('*')].filter(
          (element) =>
            element.hasAttribute('aria-label') || element.hasAttribute('title') || element.hasAttribute('role'),
        )
        expect(named, kinds.join()).toEqual([])
        expect(legend.outerHTML, kinds.join()).not.toMatch(/menos de 30 partidas(?!,| simuladas)/)
        cleanup()
      }
    })
  })

  it('the key of ▲ is there when some figure above has no matchup with data, with its words', () => {
    const legend = root(<SourceLegend sources={['tournament']} marks={{ coverage: true }} />)
    expect(keys(legend)).toEqual(['tournament', 'coverage', 'interval'])
    expect(key(legend, 'coverage').textContent).toBe('sin cruces con datos en el meta')
    const mark = legend.querySelector('[data-slot="coverage-mark"]') as HTMLElement
    expect(mark.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(mark.closest('.whitespace-nowrap')).toHaveTextContent(/^sin$/)
    for (const marks of [undefined, {}, { coverage: false }, { orientative: ['lists'] }] as const) {
      expect(keys(root(<SourceLegend sources={['tournament']} marks={marks} />))).not.toContain('coverage')
    }
  })

  it('says once which interval every «IC» above is: the one of 95 %', () => {
    const legend = root(<SourceLegend sources={ALL} />)
    expect(INTERVAL_KEY).toBe(`IC: intervalo de confianza del 95${NBSP}%`)
    expect(key(legend, 'interval').textContent).toBe(INTERVAL_KEY)
    // Where no interval is drawn or written above, the legend does not speak of one.
    const plain = root(<SourceLegend sources={ALL} interval={false} />)
    expect(keys(plain)).toEqual(['matches', 'tournament', 'simulation'])
    expect(plain.textContent).toBe('Mmis partidasTtorneosBbots')
  })

  it('the keys come in one order: the sources, «orientativo», ▲, the interval, and then what the screen adds', () => {
    const legend = root(
      <SourceLegend sources={ALL} bot="g2" marks={{ coverage: true, orientative: ['lists'] }}>
        <span data-key="more">Tocá una fila: IC y récord.</span>
      </SourceLegend>,
    )
    expect(keys(legend)).toEqual(['matches', 'tournament', 'simulation', 'orientative', 'coverage', 'interval', 'more'])
    expect(key(legend, 'more')).toHaveTextContent('Tocá una fila: IC y récord.')
  })

  it('a short key never breaks; the legend wraps between its keys, at 14 px in the third text colour', () => {
    const legend = root(<SourceLegend sources={ALL} bot="g2" />)
    expect(classes(legend)).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-wrap',
        'gap-x-[14px]',
        'type-n',
        'leading-[1.3]',
        'tracking-[0.01em]',
        'text-foreground-3',
      ]),
    )
    for (const source of ALL) {
      expect(classes(key(legend, source))).toEqual(
        expect.arrayContaining(['inline-flex', 'items-center', 'gap-[5px]', 'whitespace-nowrap']),
      )
    }
    expect(legend.innerHTML).not.toMatch(/truncate|line-clamp|text-ellipsis/)
  })

  it('at the foot of a card it goes under a line, with the card’s padding; loose on a page, without them', () => {
    const board = classes(root(<SourceLegend sources={ALL} />))
    expect(board).toEqual(
      expect.arrayContaining(['border-t', 'border-border', 'px-[14px]', 'pt-2', 'pb-[10px]', 'gap-y-1']),
    )
    expect(classes(root(<SourceLegend sources={ALL} variant="board" />))).toEqual(board)
    const page = classes(root(<SourceLegend sources={ALL} variant="page" />))
    expect(page).toEqual(expect.arrayContaining(['px-0.5', 'pt-0.5', 'gap-y-0.5']))
    expect(page.filter((name) => name.startsWith('border'))).toEqual([])
    expect(classes(root(<SourceLegend sources={ALL} className="mt-2" />))).toContain('mt-2')
  })

  it('draws no hue but the marks’: the three sources are told apart by the shape of their seals', () => {
    const legend = root(<SourceLegend sources={ALL} bot="g2" marks={{ orientative: ['matches'], coverage: true }} />)
    const coloured = [legend, ...legend.querySelectorAll('[class]')]
      .filter((element) => /success|destructive|draw|warning|energy|holo/.test(element.getAttribute('class') ?? ''))
      .map((element) => element.getAttribute('data-slot'))
    expect(coloured).toEqual(['orientative-mark', 'coverage-mark'])
  })
})
