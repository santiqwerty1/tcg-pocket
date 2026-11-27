import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { SOURCE_LETTER, SOURCE_NAME, type SourceKey } from '@/lib/figure'
import { SourceSeal } from './SourceSeal'

const SOURCES: SourceKey[] = ['matches', 'tournament', 'simulation']
/** The seal as it is in the page: the root of what the component writes. */
function seal(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  expect(container.children).toHaveLength(1)
  return container.firstElementChild as HTMLElement
}
const classes = (element: HTMLElement) => element.className.split(/\s+/)

describe('SourceSeal', () => {
  it.each(SOURCES)('%s: its letter, and its name when it is alone', (source) => {
    const named = seal(<SourceSeal source={source} named />)
    expect(named).toHaveTextContent(SOURCE_LETTER[source])
    expect(named.textContent).toHaveLength(1)
    expect(screen.getByRole('img', { name: SOURCE_NAME[source] })).toBe(named)
    expect(named).not.toHaveAttribute('aria-hidden')
  })

  it('M, T and B: the letters and the names a reader knows them by', () => {
    render(
      <p>
        {SOURCES.map((source) => (
          <SourceSeal key={source} source={source} named />
        ))}
      </p>,
    )
    const seals = screen.getAllByRole('img')
    expect(seals.map((item) => item.textContent)).toEqual(['M', 'T', 'B'])
    expect(seals.map((item) => item.getAttribute('aria-label'))).toEqual(['Mis partidas', 'Torneos', 'Bots'])
  })

  it.each(SOURCES)('%s: next to its written name it is decoration, hidden from a screen reader', (source) => {
    const decoration = seal(<SourceSeal source={source} />)
    expect(decoration).toHaveAttribute('aria-hidden', 'true')
    expect(decoration).not.toHaveAttribute('role')
    expect(decoration).not.toHaveAttribute('aria-label')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    // The letter is still drawn.
    expect(decoration).toHaveTextContent(SOURCE_LETTER[source])
  })

  it('a label is the name it says: it wins over the source’s, and a seal with one is named', () => {
    const exact = seal(<SourceSeal source="tournament" named label="Torneo, lista exacta" />)
    expect(screen.getByRole('img', { name: 'Torneo, lista exacta' })).toBe(exact)
    expect(screen.queryByRole('img', { name: 'Torneos' })).not.toBeInTheDocument()
    const bots = seal(<SourceSeal source="simulation" label="Bots g2" />)
    expect(bots).toHaveAttribute('role', 'img')
    expect(bots).toHaveAttribute('aria-label', 'Bots g2')
    expect(bots).not.toHaveAttribute('aria-hidden')
  })

  it('the root writes its slot, with or without a name', () => {
    for (const source of SOURCES) {
      expect(seal(<SourceSeal source={source} />)).toHaveAttribute('data-slot', 'source-seal')
      expect(seal(<SourceSeal source={source} named />)).toHaveAttribute('data-slot', 'source-seal')
    }
  })

  it('three shapes, never a colour alone: M filled, T outlined, B dashed', () => {
    const [m, t, b] = SOURCES.map((source) => classes(seal(<SourceSeal source={source} />))) as [
      string[],
      string[],
      string[],
    ]
    // M: a fill, with the letter in the colour of the surface under it.
    expect(m).toEqual(expect.arrayContaining(['bg-foreground', 'text-card']))
    // T: an outline drawn inside the box, no fill.
    expect(t).toContain('shadow-[inset_0_0_0_1.5px_var(--foreground-2)]')
    // B: a dashed edge, no fill.
    expect(b).toEqual(expect.arrayContaining(['border-[1.5px]', 'border-dashed', 'border-foreground-2']))
    for (const outline of [t, b]) {
      expect(outline).toContain('text-foreground')
      expect(outline.filter((name) => name.startsWith('bg-'))).toEqual([])
    }
    expect(m.filter((name) => /^(?:shadow-|border-)/.test(name))).toEqual([])
    expect(t.filter((name) => name.startsWith('border-'))).toEqual([])
    expect(b.filter((name) => name.startsWith('shadow-'))).toEqual([])
    // What tells them apart is never a hue: the same two text colours, in the three.
    for (const shape of [m, t, b]) {
      expect(shape.join(' ')).not.toMatch(/success|destructive|warning|draw|energy|ring-ring|primary/)
    }
  })

  it('where the system forces its colours, still three shapes: M a double edge, T a single one, B dashed', () => {
    // There the fill and the inset line are dropped, and every edge is painted in the system's colour of text.
    const forced = (source: SourceKey, quiet = false) =>
      classes(seal(<SourceSeal source={source} quiet={quiet} />)).filter((name) => name.startsWith('forced-colors:'))
    expect(forced('matches')).toEqual(['forced-colors:border-[3px]', 'forced-colors:border-double'])
    expect(forced('matches', true)).toEqual(['forced-colors:border-[3px]', 'forced-colors:border-double'])
    expect(forced('tournament')).toEqual(['forced-colors:border-[1.5px]'])
    // B is drawn with its dashed edge in every mode: nothing to add.
    expect(forced('simulation')).toEqual([])
  })

  it('the quiet M steps back to the second text colour; T and B, already an outline, stay as they are', () => {
    const quiet = classes(seal(<SourceSeal source="matches" quiet />))
    expect(quiet).toEqual(expect.arrayContaining(['bg-foreground-2', 'text-card']))
    expect(quiet).not.toContain('bg-foreground')
    for (const source of ['tournament', 'simulation'] as const) {
      expect(seal(<SourceSeal source={source} quiet />).className).toBe(seal(<SourceSeal source={source} />).className)
    }
  })

  it('18 px by default and 16 px inside a cell, with a 13 px letter in the display face', () => {
    const large = classes(seal(<SourceSeal source="matches" />))
    const small = classes(seal(<SourceSeal source="matches" size={16} />))
    expect(large).toContain('size-[18px]')
    expect(large).not.toContain('size-[16px]')
    expect(small).toContain('size-[16px]')
    expect(small).not.toContain('size-[18px]')
    // Inside a line of text the box sits a little under the baseline, by its size, so the letter reads on the line.
    expect(large.filter((name) => name.startsWith('align-'))).toEqual(['align-[-3px]'])
    expect(small.filter((name) => name.startsWith('align-'))).toEqual(['align-[-2px]'])
    for (const size of [large, small]) {
      expect(size).toEqual(expect.arrayContaining(['font-heading', 'text-[13px]', 'leading-none', 'font-bold']))
      // Inside a label in capitals with its letters spaced, the letter stays in the centre of its box.
      expect(size).toEqual(expect.arrayContaining(['tracking-normal', 'normal-case', 'shrink-0']))
    }
  })

  it('takes the classes of where it is drawn, and they win over its own', () => {
    const moved = classes(seal(<SourceSeal source="tournament" className="mr-[5px] align-[0px]" />))
    expect(moved).toEqual(expect.arrayContaining(['mr-[5px]', 'align-[0px]']))
    expect(moved).not.toContain('align-[-3px]')
  })
})
