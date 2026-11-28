// The numbers are invented (test/figures.ts).
import { render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { SOURCE_NAME, type SourceKey } from '@/lib/figure'
import {
  ARCHETYPE,
  BOTS,
  COVERED,
  DASH,
  EXACT_LIST,
  EXPECTED,
  LOST_ONCE,
  MINE,
  NBSP,
  POPULAR,
  STALE,
} from '@/test/figures'
import { SourceBlock } from './SourceBlock'

/** The piece as it is in the page: the root of what the component writes. */
function root(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  expect(container.children).toHaveLength(1)
  return container.firstElementChild as HTMLElement
}
const classes = (element: Element | null | undefined) => (element?.getAttribute('class') ?? '').split(/\s+/)
/** The parts of a block, in the order they are written. */
const parts = (block: HTMLElement) => [...block.children].map((child) => child.getAttribute('data-part'))
function part(block: HTMLElement, name: string): HTMLElement {
  const found = block.querySelector<HTMLElement>(`[data-part="${name}"]`)
  if (!found) throw new Error(`the block writes no ${name}`)
  return found
}
/** The lines a block writes under its bar. */
const lines = (block: HTMLElement) => [...part(block, 'figures').children].map((line) => line.textContent)
/** What separates two pieces of a line: the dot stays with the piece before it. */
const DOT = `${NBSP}· `

const MINE_INTERVAL = `IC${NBSP}37,2${DASH}64,7${NBSP}%`

describe('SourceBlock', () => {
  describe('a source with a number, inside a detail or a sheet', () => {
    it('writes the seal and the name, the percentage with its n, the interval and the record', () => {
      const block = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} />)
      expect(block).toHaveAttribute('data-slot', 'source-block')
      expect(block).toHaveAttribute('data-source', 'matches')
      expect(block).toHaveAttribute('data-size', 'row')
      expect(block).not.toHaveAttribute('data-unavailable')
      expect(parts(block)).toEqual(['head', 'chart', 'figures'])
      expect(part(block, 'head')).toHaveTextContent(/^MMis partidas51,1 % n = 47$/)
      expect(part(block, 'value').textContent).toBe(`51,1${NBSP}% n = 47`)
      // One line that wraps between its pieces: the interval first, then the record.
      expect(lines(block)).toEqual([`${MINE_INTERVAL}${DOT}24 V · 22 D · 1 E`])
    })

    it('the value is 16 px bold with its n at 14 px beside it; the name, 14 px in the second text colour', () => {
      const block = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} />)
      expect(classes(block)).toEqual(expect.arrayContaining(['grid', 'min-w-0', 'gap-1']))
      expect(classes(part(block, 'value'))).toEqual(
        expect.arrayContaining([
          'shrink-0',
          'whitespace-nowrap',
          'font-heading',
          'text-[16px]',
          'leading-[1.1]',
          'font-bold',
          'text-foreground',
        ]),
      )
      // Not a figure of a column: its digits keep their own widths, as D's (70 px for «12,5 % n = 8»).
      expect(classes(part(block, 'value')).filter((name) => /^type-|-nums$/.test(name))).toEqual([])
      expect(classes(part(block, 'value').querySelector('span'))).toEqual(
        expect.arrayContaining(['type-n', 'text-foreground-3']),
      )
      const name = part(block, 'head').firstElementChild
      // The line height is written after the size, or the merge of the classes would drop it.
      expect(classes(name)).toEqual(
        expect.arrayContaining([
          'text-[14px]',
          'leading-[1.2]',
          'font-semibold',
          'tracking-[0.02em]',
          'text-foreground-2',
        ]),
      )
      expect(classes(part(block, 'figures'))).toEqual(expect.arrayContaining(['type-sub', 'text-foreground-3']))
    })

    it('its n, its lines and the ends of its scale are data, at 14 px: nothing writes another size over their role', () => {
      // Every class of each part, and not only the ones it must have: a size put on top of the role («text-[13px]»
      // after `type-sub`) would win over it, and the n, the interval and the record would go under 14 px.
      const sorted = (element: Element | null | undefined) => classes(element).sort()
      const row = root(<SourceBlock source="tournament" name="En torneos" figure={EXACT_LIST} />)
      expect(sorted(part(row, 'figures'))).toEqual(['text-foreground-3', 'text-pretty', 'type-sub'])
      expect(sorted(part(row, 'value').querySelector('span'))).toEqual(['text-foreground-3', 'type-n'])
      const lane = root(<SourceBlock source="tournament" name="Torneo" figure={EXACT_LIST} size="lane" />)
      expect(sorted(part(lane, 'figures'))).toEqual(['leading-[1.4]', 'text-foreground-2', 'text-pretty', 'type-sub'])
      expect(sorted(part(lane, 'chart'))).toEqual([
        'gap-[9px]',
        'grid',
        'grid-cols-[auto_minmax(0,1fr)_auto]',
        'items-center',
        'leading-none',
        'text-foreground-3',
        'type-n',
      ])
      // And nothing inside them sets a size of its own: the pieces of a line and the two ends of a scale take the
      // part's.
      const sized = /^(?:[\w-]+:)*(?:text-(?:\[|xs$|sm$|base$|lg$|\d?xl$)|type-|\[font-size)/
      for (const [block, name] of [
        [row, 'figures'],
        [lane, 'figures'],
        [lane, 'chart'],
      ] as const) {
        const inner = [...part(block, name).querySelectorAll('*')].filter(
          (element) => !element.closest('[data-slot="interval-bar"]'),
        )
        expect(inner.length, name).toBeGreaterThan(0)
        expect(
          inner.flatMap((element) => classes(element).filter((written) => sized.test(written))),
          name,
        ).toEqual([])
      }
    })

    it('a tournament figure says the lists it was counted on, and «orientativo» in words with what it counted', () => {
      const block = root(<SourceBlock source="tournament" name="En torneos" figure={EXACT_LIST} />)
      expect(part(block, 'value').textContent).toBe(`12,5${NBSP}% n = 8 en 2 listas`)
      expect(lines(block)).toEqual([
        `IC${NBSP}2,2${DASH}47,1${NBSP}%${DOT}1 V · 7 D${DOT}orientativo: menos de 30 listas`,
      ])
      // 70 games, and still «orientativo»: it counted 14 lists.
      const archetype = root(<SourceBlock source="tournament" name="En torneos" figure={ARCHETYPE} />)
      expect(part(archetype, 'value').textContent).toBe(`35,7${NBSP}% n = 70 en 14 listas`)
      expect(part(archetype, 'figures')).toHaveTextContent('orientativo: menos de 30 listas')
      // Own matches count matches.
      const mine = root(<SourceBlock source="matches" name="Vos contra él" figure={LOST_ONCE} />)
      expect(part(mine, 'figures')).toHaveTextContent('orientativo: menos de 30 partidas')
      expect(
        part(root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} />), 'figures'),
      ).not.toHaveTextContent(/orientativo/)
    })

    it('the mark of «orientativo» is drawn before its words, and only the words are read', () => {
      const block = root(<SourceBlock source="tournament" name="Torneos" figure={EXACT_LIST} />)
      const mark = block.querySelector('[data-slot="orientative-mark"]') as HTMLElement
      expect(mark).not.toBeNull()
      expect(mark.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(screen.queryByRole('img', { name: /orientativo/ })).not.toBeInTheDocument()
      // Decoration with no name of its own: what is read is the words, and they say lists.
      expect(mark).not.toHaveAttribute('aria-label')
      expect(mark.closest('[data-slot="mark-words"]')).toHaveTextContent(/^orientativo: menos de 30 listas$/)
      // The mark stays on the line of the first word.
      expect(mark.closest('.whitespace-nowrap')).toHaveTextContent(/^orientativo:$/)
    })

    it('the bar is drawn for the eye only: everything it shows is written in words', () => {
      const block = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} />)
      const chart = part(block, 'chart')
      expect(chart).toHaveAttribute('aria-hidden', 'true')
      expect(chart.querySelector('[data-slot="interval-bar"]')).not.toBeNull()
      // Nothing of the block is an image to a reader: the seal is beside its name, the bar under its numbers.
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(part(block, 'figures').textContent).toContain(MINE_INTERVAL)
      expect(part(block, 'figures').closest('[aria-hidden="true"]')).toBeNull()
      // A row has no labels at the ends of its bar.
      expect(chart.textContent).toBe('')
    })

    it('a real zero is a figure, with its bar', () => {
      const block = root(<SourceBlock source="matches" name="Vos contra él" figure={LOST_ONCE} />)
      expect(part(block, 'value').textContent).toBe(`0${NBSP}% n = 1`)
      expect(parts(block)).toEqual(['head', 'chart', 'figures'])
      expect(block.textContent).not.toMatch(/sin datos/)
    })
  })

  describe('a block of a page', () => {
    it('writes the percentage large, the two ends of the bar, and two lines: the sample and the record, the interval', () => {
      const block = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} size="lane" />)
      expect(block).toHaveAttribute('data-size', 'lane')
      expect(parts(block)).toEqual(['head', 'chart', 'figures'])
      // Only the percentage is beside the name: its n opens the first line under the bar.
      expect(part(block, 'value').textContent).toBe(`51,1${NBSP}%`)
      expect(lines(block)).toEqual([`n = 47${DOT}24 V · 22 D · 1 E`, MINE_INTERVAL])
      expect(part(block, 'chart').textContent).toBe('0100')
      expect([...part(block, 'chart').children].map((child) => child.getAttribute('data-slot'))).toEqual([
        null,
        'interval-bar',
        null,
      ])
    })

    it('28 px for the value, 15 px bold for the name, the lines in the second text colour', () => {
      const block = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} size="lane" />)
      expect(classes(block)).toEqual(expect.arrayContaining(['grid', 'min-w-0', 'gap-[6px]']))
      expect(classes(part(block, 'value'))).toEqual(
        expect.arrayContaining([
          'font-heading',
          'text-[28px]',
          'leading-[0.95]',
          'font-bold',
          'shrink-0',
          'whitespace-nowrap',
          'text-foreground',
        ]),
      )
      // D's «.lane-pct»: 28 px with the digits at their own widths («51,1 %» is 65.8 px; in columns it would be 79).
      expect(classes(part(block, 'value')).filter((name) => /^type-|-nums$|^tracking-/.test(name))).toEqual([])
      // One size and one line height: the ones of a lane, not also the ones of a row.
      expect(classes(part(block, 'value')).filter((name) => /^(?:text-\[|leading-)/.test(name))).toEqual([
        'text-[28px]',
        'leading-[0.95]',
      ])
      expect(classes(part(block, 'head').firstElementChild)).toEqual(
        expect.arrayContaining(['text-[15px]', 'leading-[1.2]', 'font-bold', 'tracking-[0.02em]', 'text-foreground-2']),
      )
      expect(classes(part(block, 'figures'))).toEqual(
        expect.arrayContaining(['type-sub', 'leading-[1.4]', 'text-foreground-2']),
      )
      expect(classes(part(block, 'chart'))).toEqual(
        expect.arrayContaining([
          'grid',
          'grid-cols-[auto_minmax(0,1fr)_auto]',
          'items-center',
          'type-n',
          'text-foreground-3',
        ]),
      )
    })

    it('a tournament lane: the lists with the sample, «orientativo» with the interval', () => {
      const block = root(<SourceBlock source="tournament" name="Torneo" figure={EXACT_LIST} size="lane" />)
      expect(lines(block)).toEqual([
        `n = 8 en 2 listas${DOT}1 V · 7 D`,
        `IC${NBSP}2,2${DASH}47,1${NBSP}%${DOT}orientativo: menos de 30 listas`,
      ])
      const bots = root(<SourceBlock source="simulation" name="Simulación" figure={BOTS} size="lane" />)
      expect(part(bots, 'value').textContent).toBe(`50${NBSP}%`)
      expect(lines(bots)).toEqual([`n = 14.179${DOT}7.095 V · 7.004 D · 80 E`, `IC${NBSP}49,2${DASH}50,9${NBSP}%`])
    })

    it('a line with nothing to say is not written', () => {
      // A number against the meta: no record and no interval; its coverage goes with the sample.
      const block = root(<SourceBlock source="tournament" name="Torneo" figure={EXPECTED} size="lane" />)
      expect(lines(block)).toEqual([`n = 41${DOT}cruces con datos: 0${NBSP}% del meta`])
    })
  })

  describe('each piece of a line', () => {
    it('a number, a record and an interval never break inside; words may', () => {
      const block = root(
        <SourceBlock
          source="tournament"
          name="Torneo"
          figure={{ ...EXACT_LIST, coverage: 73.2, stale: { era: 'B4b' } }}
          reference={{ value: 40.7, label: 'esperable' }}
        />,
      )
      const pieces = [...part(block, 'figures').querySelectorAll<HTMLElement>('[data-piece]')]
      expect(pieces.map((piece) => piece.dataset.piece)).toEqual([
        'interval',
        'record',
        'orientative',
        'coverage',
        'era',
        'reference',
      ])
      expect(pieces.map((piece) => classes(piece).includes('whitespace-nowrap'))).toEqual([
        true,
        true,
        false,
        false,
        false,
        false,
      ])
      // Each one but the last ends with its dot, so a line never starts with one.
      expect(pieces.map((piece) => piece.textContent?.endsWith(`${NBSP}·`))).toEqual([
        true,
        true,
        true,
        true,
        true,
        false,
      ])
      expect(lines(block)).toEqual([
        [
          `IC${NBSP}2,2${DASH}47,1${NBSP}%`,
          '1 V · 7 D',
          'orientativo: menos de 30 listas',
          `cruces con datos: 73,2${NBSP}% del meta`,
          'de la era B4b',
          `esperable: 40,7${NBSP}%`,
        ].join(DOT),
      ])
    })

    it('how much of the meta has data is written; with none, the mark of the legend goes before it', () => {
      const covered = root(<SourceBlock source="tournament" name="Torneo" figure={COVERED} />)
      expect(lines(covered)).toEqual([`IC${NBSP}44,7${DASH}51,1${NBSP}%${DOT}cruces con datos: 73,2${NBSP}% del meta`])
      expect(covered.querySelector('[data-slot="coverage-mark"]')).toBeNull()
      const none = root(<SourceBlock source="tournament" name="Torneo" figure={EXPECTED} />)
      expect(lines(none)).toEqual([`cruces con datos: 0${NBSP}% del meta`])
      const mark = none.querySelector('[data-slot="coverage-mark"]') as HTMLElement
      expect(mark.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(mark.closest('.whitespace-nowrap')).toHaveTextContent(/^cruces$/)
      // A figure that is no number against the meta says nothing of it.
      expect(
        part(root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} />), 'figures'),
      ).not.toHaveTextContent(/cruces/)
    })

    it('a score of another era is drawn quiet, not bold, and its era is written', () => {
      const block = root(<SourceBlock source="simulation" name="Laboratorio: bots g2" figure={STALE} />)
      expect(classes(part(block, 'value'))).toEqual(expect.arrayContaining(['font-medium', 'text-foreground-2']))
      expect(classes(part(block, 'value'))).not.toContain('text-foreground')
      expect(classes(part(block, 'value'))).not.toContain('font-bold')
      expect(lines(block)).toEqual([`IC${NBSP}48,7${DASH}51,9${NBSP}%${DOT}de la era B4b`])
      const lane = root(<SourceBlock source="simulation" name="Laboratorio" figure={STALE} size="lane" />)
      expect(classes(part(lane, 'value'))).toEqual(
        expect.arrayContaining(['text-[28px]', 'font-medium', 'text-foreground-2']),
      )
      expect(classes(part(lane, 'value'))).not.toContain('font-bold')
      expect(classes(part(lane, 'value'))).not.toContain('text-foreground')
      expect(lines(lane)).toEqual([`n = 3.600`, `IC${NBSP}48,7${DASH}51,9${NBSP}%${DOT}de la era B4b`])
    })
  })

  describe('the scale and the reference', () => {
    it('go to the bar, and a lane writes the two ends of its scale', () => {
      const block = root(
        <SourceBlock
          source="simulation"
          name="Variante 3"
          figure={BOTS}
          size="lane"
          scale={[45, 55]}
          reference={{ value: 48.2, label: 'tu lista' }}
        />,
      )
      expect(part(block, 'chart').textContent).toBe('4555')
      const bar = part(block, 'bar')
      expect(bar.querySelector<HTMLElement>('[data-part="point"]')?.style.left).toBe('50.39%')
      expect(bar.querySelector<HTMLElement>('[data-part="band"]')?.style.left).toBe('42%')
      expect(bar.querySelector<HTMLElement>('[data-part="reference"]')?.style.left).toBe('32%')
      // A cut scale has no tick at 50.
      expect(bar.querySelector('[data-part="tick"]')).toBeNull()
    })

    it('the amber mark has no text of its own: the block writes what it is, with its value', () => {
      const lane = root(
        <SourceBlock
          source="simulation"
          name="Variante 3"
          figure={BOTS}
          size="lane"
          reference={{ value: 48.2, label: 'tu lista' }}
        />,
      )
      expect(lines(lane)[1]).toBe(`IC${NBSP}49,2${DASH}50,9${NBSP}%${DOT}tu lista: 48,2${NBSP}%`)
      const row = root(<SourceBlock source="simulation" name="Variante 3" figure={BOTS} reference={{ value: 48.2 }} />)
      expect(lines(row)).toEqual([
        `IC${NBSP}49,2${DASH}50,9${NBSP}%${DOT}7.095 V · 7.004 D · 80 E${DOT}referencia: 48,2${NBSP}%`,
      ])
      // Without one, nothing is drawn or written of it; the full scale is 0–100 with its tick.
      const plain = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} size="lane" />)
      expect(plain.querySelector('[data-part="reference"]')).toBeNull()
      expect(plain.querySelector('[data-part="tick"]')).not.toBeNull()
      expect(part(plain, 'figures')).not.toHaveTextContent(/referencia/)
    })
  })

  describe('without data', () => {
    it('says «sin datos» where the percentage would be: no bar, no number, never a zero', () => {
      for (const size of ['row', 'lane'] as const) {
        const block = root(<SourceBlock source="matches" name="Mis partidas" figure={null} size={size} />)
        expect(parts(block), size).toEqual(['head'])
        expect(part(block, 'head'), size).toHaveTextContent(/^MMis partidassin datos$/)
        expect(block.querySelector('[data-slot="no-data"]'), size).toHaveTextContent(/^sin datos$/)
        expect(block.textContent, size).not.toMatch(/%|\d/)
        expect(block.querySelector('[data-slot="interval-bar"]'), size).toBeNull()
        expect(block, size).not.toHaveAttribute('data-unavailable')
        expect(classes(block), size).not.toContain('border-dashed')
      }
    })

    it('the note says why there is nothing yet', () => {
      const block = root(
        <SourceBlock
          source="matches"
          name="Mis partidas"
          figure={null}
          size="lane"
          note="Todavía no registraste partidas con este mazo."
        />,
      )
      expect(parts(block)).toEqual(['head', 'note'])
      expect(part(block, 'note')).toHaveTextContent('Todavía no registraste partidas con este mazo.')
    })
  })

  describe('a source that is not available', () => {
    it('takes a dashed edge and writes why, in a paragraph', () => {
      const block = root(
        <SourceBlock
          source="tournament"
          name="Torneo"
          figure={null}
          unavailable="Nadie jugó esta lista ni una parecida en la era."
        />,
      )
      expect(block).toHaveAttribute('data-unavailable')
      expect(classes(block)).toEqual(
        expect.arrayContaining(['rounded-[10px]', 'border', 'border-dashed', 'border-input', 'px-[10px]', 'py-2']),
      )
      expect(parts(block)).toEqual(['head', 'unavailable'])
      const why = part(block, 'unavailable')
      expect(why.tagName).toBe('P')
      expect(why).toHaveTextContent('Nadie jugó esta lista ni una parecida en la era.')
      expect(classes(why)).toEqual(expect.arrayContaining(['type-sub', 'wrap-anywhere', 'text-foreground-2']))
      expect(block.querySelector('[data-slot="no-data"]')).toHaveTextContent(/^sin datos$/)
    })

    it('an available source has a plain edge, with or without a number', () => {
      for (const figure of [MINE, null]) {
        const block = root(<SourceBlock source="matches" name="Mis partidas" figure={figure} />)
        expect(classes(block).filter((name) => /^(?:border|rounded)/.test(name))).toEqual([])
      }
    })

    it('without a reason it is still marked; and a number that came anyway is not hidden', () => {
      const silent = root(<SourceBlock source="tournament" name="Torneo" figure={null} unavailable="" />)
      expect(silent).toHaveAttribute('data-unavailable')
      expect(classes(silent)).toContain('border-dashed')
      expect(parts(silent)).toEqual(['head'])
      const both = root(<SourceBlock source="tournament" name="Torneo" figure={EXACT_LIST} unavailable="No cargó." />)
      expect(parts(both)).toEqual(['head', 'chart', 'figures', 'unavailable'])
      expect(part(both, 'value').textContent).toBe(`12,5${NBSP}% n = 8 en 2 listas`)
    })
  })

  describe('the note, the warning and what goes under them', () => {
    it('the warning goes right under the figures, then the note, then the rest of the source', () => {
      const block = root(
        <SourceBlock
          source="simulation"
          name="Simulación"
          figure={BOTS}
          size="lane"
          warning="Posible punto ciego del bot: juega cartas que el bot usa mal."
          note="Bots g2 vs g2, 5 simulaciones. El porcentaje depende del bot."
        >
          <h3>Más de esta fuente</h3>
        </SourceBlock>,
      )
      expect(parts(block)).toEqual(['head', 'chart', 'figures', 'warning', 'note', 'more'])
      const warning = part(block, 'warning')
      expect(warning.tagName).toBe('P')
      expect(warning).toHaveTextContent('Posible punto ciego del bot: juega cartas que el bot usa mal.')
      // In the first text colour, so it is not read as small print. The amber of a warning is the marks'.
      expect(classes(warning)).toEqual(expect.arrayContaining(['type-sub', 'wrap-anywhere', 'text-foreground']))
      expect(warning.className).not.toMatch(/warning/)
      const note = part(block, 'note')
      expect(note.tagName).toBe('P')
      expect(classes(note)).toEqual(expect.arrayContaining(['type-sub', 'wrap-anywhere', 'text-foreground-3']))
      expect(within(part(block, 'more')).getByRole('heading', { name: 'Más de esta fuente' })).toBeInTheDocument()
    })

    it('what is given to it cannot make it wider than its box: its one column shrinks to the block', () => {
      // Seen on the deck's page: the rows of a tournament block cut their names on one line, and a column of the
      // width of its content grew to that line and pushed the percentage out of the card.
      for (const size of ['row', 'lane'] as const) {
        const block = root(
          <SourceBlock source="tournament" name="Torneo" figure={EXACT_LIST} size={size}>
            <span className="block truncate">
              Arquetipo: Mega-Gardevoir ex / Gallade con Dedenne ex y Caramelo Raro
            </span>
          </SourceBlock>,
        )
        expect(classes(block), size).toEqual(expect.arrayContaining(['grid', 'min-w-0', 'grid-cols-[minmax(0,1fr)]']))
      }
    })

    it('the note is the last paragraph of its block, where the screens suite looks for it', () => {
      const { container } = render(
        <>
          <SourceBlock source="matches" name="Mis partidas" figure={MINE} size="lane" note="Partidas registradas." />
          <SourceBlock
            source="tournament"
            name="Torneo"
            figure={EXACT_LIST}
            size="lane"
            warning="Pocas listas."
            note="Datos de torneo: Limitless (play.limitlesstcg.com)."
          />
          <SourceBlock source="simulation" name="Simulación" figure={null} unavailable="No vino." note="Sin simular." />
        </>,
      )
      // e2e/phone-width.spec.ts: `[data-source="tournament"] p`, the last one.
      const paragraphs = [...container.querySelectorAll('[data-source="tournament"] p')]
      expect(paragraphs.at(-1)).toHaveTextContent('Datos de torneo: Limitless (play.limitlesstcg.com).')
      expect([...container.querySelectorAll('[data-source="simulation"] p')].at(-1)).toHaveTextContent('Sin simular.')
      expect(container.querySelectorAll('[data-source]')).toHaveLength(3)
    })

    it('a note can be more than a text, and nothing is written for what is not given', () => {
      const block = root(
        <SourceBlock
          source="tournament"
          name="Torneo"
          figure={EXACT_LIST}
          note={
            <>
              Lista exacta · <a href="/torneos">ver en Torneos</a>
            </>
          }
        />,
      )
      expect(within(part(block, 'note')).getByRole('link', { name: 'ver en Torneos' })).toBeInTheDocument()
      const bare = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} note="" warning={null} />)
      expect(parts(bare)).toEqual(['head', 'chart', 'figures'])
      expect(bare.querySelector('p')).toBeNull()
    })
  })

  describe('whose number it is', () => {
    it.each(['matches', 'tournament', 'simulation'] as const)(
      '%s: beside the very name of its source the seal is decoration',
      (source: SourceKey) => {
        const block = root(<SourceBlock source={source} name={SOURCE_NAME[source]} figure={MINE} />)
        const seal = block.querySelector('[data-slot="source-seal"]')
        expect(seal).toHaveAttribute('aria-hidden', 'true')
        expect(part(block, 'head')).toHaveTextContent(SOURCE_NAME[source])
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
      },
    )

    it.each([
      ['tournament', 'Torneo'],
      ['simulation', 'Simulación'],
      ['simulation', 'Laboratorio: bots g2'],
      ['matches', 'Partidas de la era'],
    ] as const)('%s: beside «%s», a name that already says its source, the seal is decoration', (source, name) => {
      // The API's labels: a reader would hear «Torneos, Torneo» and «Bots, Simulación» (review of #211).
      const block = root(<SourceBlock source={source} name={name} figure={EXACT_LIST} size="lane" />)
      expect(block.querySelector('[data-slot="source-seal"]')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('beside a name that does not say its source the seal says it: «Vos contra él» does not say whose it is', () => {
      const mine = root(<SourceBlock source="matches" name="Vos contra él" figure={MINE} />)
      expect(mine).toContainElement(screen.getByRole('img', { name: 'Mis partidas' }))
      // Another source's word is not this one's: «Torneo» beside the bots' seal still names the bots.
      const bots = root(<SourceBlock source="simulation" name="Torneo del banco" figure={null} />)
      expect(bots).toContainElement(screen.getByRole('img', { name: 'Bots' }))
    })

    it('the seal is 18 px, before the name, and a long name wraps beside it instead of being cut', () => {
      const block = root(
        <SourceBlock source="tournament" name="Torneo: su arquetipo contra el meta" figure={ARCHETYPE} size="lane" />,
      )
      const seal = block.querySelector('[data-slot="source-seal"]') as HTMLElement
      expect(classes(seal)).toContain('size-[18px]')
      const name = seal.nextElementSibling as HTMLElement
      expect(name).toHaveTextContent(/^Torneo: su arquetipo contra el meta$/)
      expect(classes(name)).toEqual(expect.arrayContaining(['min-w-0', 'wrap-anywhere']))
      expect(block.innerHTML).not.toMatch(/truncate|line-clamp|text-ellipsis/)
      // The percentage keeps its place and its line: it is the name that gives way.
      expect(classes(part(block, 'value'))).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']))
    })
  })

  describe('the head of a row', () => {
    it('a long n goes under the name, at the right, instead of squeezing it: the head wraps between the two', () => {
      const block = root(<SourceBlock source="tournament" name="En torneos" figure={POPULAR} />)
      expect(part(block, 'value').textContent).toBe(`47,9${NBSP}% n = 12.406 en 1.203 listas`)
      const head = part(block, 'head')
      expect(classes(head)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'justify-between']))
      // Pushed to the right on its own line too, and never broken inside.
      expect(classes(part(block, 'value'))).toEqual(
        expect.arrayContaining(['ml-auto', 'shrink-0', 'whitespace-nowrap']),
      )
      expect(classes(head.firstElementChild)).toEqual(expect.arrayContaining(['flex', 'min-w-0']))
      // «sin datos» stands where the value would, at the right as well.
      const empty = root(<SourceBlock source="tournament" name="En torneos" figure={null} />)
      expect(classes(part(empty, 'head').querySelector('[data-slot="no-data"]'))).toEqual(
        expect.arrayContaining(['ml-auto', 'shrink-0']),
      )
    })

    it('a lane does not wrap its head: its n is under the bar, and the name wraps beside the value', () => {
      const lane = root(<SourceBlock source="tournament" name="En torneos" figure={POPULAR} size="lane" />)
      expect(classes(part(lane, 'head'))).not.toContain('flex-wrap')
      expect(part(lane, 'value').textContent).toBe(`47,9${NBSP}%`)
      expect(lines(lane)[0]).toContain(`n = 12.406 en 1.203 listas`)
    })
  })

  it('one block is one source: its numbers are its own, and it draws no hue but the marks’', () => {
    const { container } = render(
      <>
        <SourceBlock source="matches" name="Mis partidas" figure={MINE} />
        <SourceBlock source="tournament" name="Torneos" figure={EXACT_LIST} />
        <SourceBlock source="simulation" name="Bots" figure={BOTS} />
      </>,
    )
    const blocks = [...container.querySelectorAll<HTMLElement>('[data-slot="source-block"]')]
    expect(blocks.map((block) => block.dataset.source)).toEqual(['matches', 'tournament', 'simulation'])
    expect(blocks.map((block) => part(block, 'value').textContent)).toEqual([
      `51,1${NBSP}% n = 47`,
      `12,5${NBSP}% n = 8 en 2 listas`,
      `50${NBSP}% n = 14.179`,
    ])
    for (const block of blocks) {
      const coloured = [...block.querySelectorAll('[class]')]
        .filter((element) => /success|destructive|draw|warning|energy|holo/.test(element.getAttribute('class') ?? ''))
        .map((element) => element.getAttribute('data-slot') ?? element.getAttribute('data-part'))
      expect(coloured.filter((slot) => slot !== 'orientative-mark')).toEqual([])
    }
  })

  it('takes the classes of where it is drawn', () => {
    const block = root(<SourceBlock source="matches" name="Mis partidas" figure={MINE} className="px-[14px] py-3" />)
    expect(classes(block)).toEqual(expect.arrayContaining(['px-[14px]', 'py-3', 'grid']))
  })
})
