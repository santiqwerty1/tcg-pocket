// The rules of mock-up D that only the source can show, for the pieces of phase 1 «componentes» (DIRECCION-D §1, §13
// and §14, and point 6 of the agreement: a piece is given its data, it never asks for it). vitest runs without the
// stylesheet and jsdom has no boxes, so this reads the files as text, as app/tokens.test.ts does.
//
// Point 6 has three guards. Two are here: (a) a piece imports only types from the API and calls no hook that fetches,
// and (c) the exact list of the sources that poll. The third, (b) «the screen that adopts a piece makes the same
// requests as before», is asserted on the call log of test/fakeApi.ts, in the test of each screen that adopts one:
// ADOPTED lists every source that draws a piece with the test that pins its requests, and this file checks that the
// list is whole and that each of those tests reads the log.
//
// A new piece is one line of PIECES; a new folder of pieces, one line of FOLDERS; a screen that takes a piece, one
// line of ADOPTED.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The tests run from apps/web (jsdom's import.meta.url is not a file URL).
const SRC = resolve(process.cwd(), 'src')

/** The tokens with a hue. A piece draws with the text and surface tokens; these are for what the list below says. */
const HUES = ['warning', 'success', 'destructive', 'draw', 'energy', 'holo', 'ring'] as const
type Hue = (typeof HUES)[number]

interface Piece {
  /** The `data-slot` of each component the file exports, one for each, in the order they are written. */
  slots: readonly string[]
  /** The tokens with a hue each of its components may use, by the name of the component; none for one left out. */
  hues?: Readonly<Record<string, readonly Hue[]>>
  /** The hooks it calls that are not React's own; none when left out. */
  hooks?: readonly string[]
}

/** Every file of the pieces, from src. */
const PIECES: Record<string, Piece> = {
  'components/figures/FigureValue.tsx': { slots: ['figure'] },
  // The mark of a reference on the bar: the one amber thing that is not a mark of Marks.tsx.
  'components/figures/IntervalBar.tsx': { slots: ['interval-bar'], hues: { IntervalBar: ['warning'] } },
  // Amber says «careful with this number»: it is the marks', and no other piece of a figure takes it.
  'components/figures/Marks.tsx': {
    slots: ['orientative-mark', 'coverage-mark', 'no-data', 'mark-words'],
    hues: { OrientativeMark: ['warning'], CoverageMark: ['warning'] },
  },
  // Green, red and grey are a victory, a defeat and a tie: the bar of a record, and nothing else of a figure.
  'components/figures/MiniCharts.tsx': {
    slots: ['interval-mark', 'bar-mark', 'record-bar'],
    hues: { IntervalMark: ['warning'], RecordBar: ['success', 'destructive', 'draw'] },
  },
  'components/figures/SourceBlock.tsx': { slots: ['source-block'] },
  'components/figures/SourceLegend.tsx': { slots: ['source-legend'] },
  'components/figures/SourceSeal.tsx': { slots: ['source-seal'] },
  // Where the parts of a chart go: numbers only, it draws nothing.
  'components/figures/scale.ts': { slots: [] },
  // The action of the fixed row, and the look of the row around it: the row draws it, and so does the gallery.
  'app/RowAction.tsx': { slots: ['row-action'] },
}
/** The folders that hold nothing but pieces: a source in one of them that is not listed above fails. */
const FOLDERS = ['components/figures'] as const
/** What turns the shapes of the API into the pieces' own: under the same rules of point 6. */
const ADAPTERS = ['lib/figure.ts'] as const

/**
 * Every source that draws a piece, with the test that pins what its screen asks the API for (point 6, guard b). A
 * screen that takes a piece joins this list on purpose, with the test that reads its call log.
 */
const ADOPTED: Record<string, string> = {
  // «Piezas de la interfaz»: test data, and no request at all.
  'pages/mas/PiecesPage.tsx': 'pages/mas/PiecesPage.test.tsx',
  // The three sources of a deck. It is given its columns by the deck's «Rendimiento», whose test pins the requests.
  'pages/mazos/SourceLanes.tsx': 'pages/mazos/DeckPerformance.test.tsx',
}
/** The test data of the gallery: invented numbers, which no screen but the gallery may read. */
const FIXTURES = 'pages/mas/pieces/fixtures.ts'
/** What is given its data and asks for nothing, however far its imports go: the pieces, their adapter, the gallery. */
const QUIET = [...Object.keys(PIECES), ...ADAPTERS, ...Object.keys(ADOPTED), FIXTURES]

/** The hooks of React that keep state or read the page: none of them asks the server for anything. */
const REACT_HOOKS = new Set([
  'useCallback',
  'useContext',
  'useDeferredValue',
  'useEffect',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition',
])

/** The sources under a folder of src that are not tests, as paths from src with «/» on every system. */
function sources(dir = ''): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry): string[] => {
    const path = posix.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** A text without its comments, line for line: a rule is about what is written to run, not about what is explained. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/.*$/gm, '$1')
}

/** The code of a source. */
const code = (path: string) => withoutComments(readFileSync(join(SRC, path), 'utf8'))

interface Import {
  /** `import type` (or `export type … from`): erased when the file is compiled. */
  typeOnly: boolean
  /** The module, as a path from src when it is one of the app's («@/…» or relative); as written otherwise. */
  module: string
}

/** Every module the code of a file names: what it imports, re-exports, loads on demand or imports for its effects. */
function importsIn(text: string, path: string): Import[] {
  const own = (module: string) =>
    module.startsWith('@/')
      ? module.slice(2)
      : module.startsWith('.')
        ? relative(SRC, resolve(SRC, dirname(path), module))
            .split(sep)
            .join('/')
        : module
  return [
    ...[...text.matchAll(/\b(?:import|export)\s+(type\s+)?[^'";]*?\bfrom\s*(['"])([^'"]+)\2/g)].map((found) => ({
      typeOnly: found[1] !== undefined,
      module: own(found[3] ?? ''),
    })),
    ...[...text.matchAll(/\bimport\s*\(?\s*(['"])([^'"]+)\1/g)].map((found) => ({
      typeOnly: false,
      module: own(found[2] ?? ''),
    })),
  ]
}

const imports = (path: string) => importsIn(code(path), path)

/** The source a module of the app is, as a path from src; null for a package and for what is not a source. */
function sourceOf(module: string): string | null {
  return (
    [`${module}.ts`, `${module}.tsx`, `${module}/index.ts`, `${module}/index.tsx`].find((path) =>
      existsSync(join(SRC, path)),
    ) ?? null
  )
}

/**
 * Everything a source loads when it runs, however far: its own imports that are not types, and theirs. The sources
 * of the app as paths from src, the packages by their name.
 */
function loaded(path: string, seen = new Set<string>()): Set<string> {
  for (const item of imports(path)) {
    if (item.typeOnly) continue
    const source = sourceOf(item.module)
    const reached = source ?? item.module
    if (seen.has(reached)) continue
    seen.add(reached)
    if (source) loaded(source, seen)
  }
  return seen
}

/** The hooks a code calls that are not React's own (one it only defines is not a call), each once, in order. */
function ownHooks(text: string): string[] {
  const called = [...text.matchAll(/(?<!function\s+)\b(use[A-Z]\w*)\s*(?:<[^<>()]*>)?\(/g)].map(
    (found) => found[1] ?? '',
  )
  return [...new Set(called.filter((hook) => !REACT_HOOKS.has(hook)))].sort()
}

/** What a code does to ask for something by itself, or to ask again: none of it belongs in a piece. */
const ASKS =
  /\buse\s*\(|\bfetch\s*\(|\bEventSource\b|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\brefetch\w*|\bsetInterval\b/

/** The tokens with a hue a code names, in a class («border-warning») or as a variable («var(--warning)»). */
function huesIn(text: string): Hue[] {
  const hue = new RegExp(`-(${HUES.join('|')})(?![a-zA-Z0-9_])`, 'g')
  return [...new Set([...text.matchAll(hue)].map((found) => found[1] as Hue))].sort()
}

/**
 * A colour that is not a token: a palette of Tailwind, white or black, a literal, a colour named in brackets
 * («text-[gold]») or in a property of its own («[color:tomato]»), and one in a style («color: 'tomato'»).
 */
const HAND_COLOUR = new RegExp(
  [
    /-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/,
    /-(?:white|black)(?![\w-])/,
    /#[0-9a-fA-F]{3,8}\b/,
    /\b(?:rgba?|hsla?|oklch|oklab)\(/,
    // A size or a variable in brackets is not a colour: «text-[15px]», «bg-[var(--card)]», «border-[1.5px]».
    /\b(?:text|bg|border(?:-[trblxy])?|fill|stroke|outline|decoration|ring|shadow|accent|caret)-\[(?!var\()[a-zA-Z]+\]/,
    /\[(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color):(?!var\()/,
    /\b(?:color|background(?:Color)?|border(?:Top|Right|Bottom|Left)?Color|outlineColor|fill|stroke)\s*:\s*['"`]/,
  ]
    .map((part) => part.source)
    .join('|'),
)

/** The slots a code writes on an element, in order (a selector, `[data-slot="…"]`, writes none). */
const slotsIn = (text: string) => [...text.matchAll(/(?<!\[)data-slot="([a-z0-9-]+)"/g)].map((found) => found[1] ?? '')

/** The components a file gives to others, each with its code: from its `export function` to the next export. */
function componentsIn(text: string): { name: string; body: string }[] {
  const exported = [...text.matchAll(/^export /gm)].map((found) => found.index)
  return [...text.matchAll(/^export function ([A-Z]\w*)/gm)].map((found) => ({
    name: found[1] ?? '',
    body: text.slice(found.index, exported.find((at) => at > found.index) ?? text.length),
  }))
}

/** The opening tags of the elements a code writes, each whole (a tag of several lines is one). */
const tagsIn = (text: string) => [...text.matchAll(/<[a-z][a-z0-9]*\b[^<>]*>/g)].map((found) => found[0])

/** Each component of the pieces that uses a token with this hue, as «path Component». */
function painters(hue: Hue): string[] {
  return Object.entries(PIECES)
    .flatMap(([path, piece]) =>
      Object.entries(piece.hues ?? {})
        .filter(([, hues]) => hues.includes(hue))
        .map(([component]) => `${path} ${component}`),
    )
    .sort()
}

/**
 * What cuts a name with «…» or pins a thing to the edge of the window. `fixed` is the class among others in a string
 * («fixed inset-0», «md:fixed»), not the string 'fixed' alone, which is a value of a prop.
 */
const CUT_OR_STUCK = new RegExp(
  [
    /(?<![\w-])(?:truncate|text-ellipsis|overflow-ellipsis|sticky)(?![\w-])|line-clamp-|text-overflow|textOverflow/,
    /(?<![\w'"`-])fixed(?![\w'"`-])|(?<=['"`])fixed(?=\s)|(?<=\s)fixed(?=['"`])/,
    /\bposition\s*:\s*['"`]?(?:fixed|sticky)/,
  ]
    .map((part) => part.source)
    .join('|'),
)

/** A size of text this file cannot hold to 13 px: in a style, in a unit relative to what is around, as a property. */
const SIZE_UNREAD = /fontSize\s*:|(?<![\w-])text-\[(?:length:|[\d.]+(?:em|%)\])|\[font-size:|\bfont:\s*['"`]/

const ruled = [...Object.keys(PIECES), ...ADAPTERS]

describe('how this file reads a source', () => {
  /** What a piece of components/figures would import with this line. */
  const named = (line: string) => importsIn(line, 'components/figures/Piece.tsx')

  it('tells a type import, which leaves nothing in the compiled file, from every other way of naming a module', () => {
    expect(named("import type { WinRate } from '@/api/schemas'")).toEqual([{ typeOnly: true, module: 'api/schemas' }])
    expect(named("import type * as Api from '@/api/schemas'")).toEqual([{ typeOnly: true, module: 'api/schemas' }])
    expect(named("export type { WinRate } from '@/api/schemas'")).toEqual([{ typeOnly: true, module: 'api/schemas' }])
    // A type among the names is not enough: the module is still loaded.
    for (const line of [
      "import { type WinRate } from '@/api/schemas'",
      "import { winRateSchema } from '@/api/schemas'",
      "import {\n  useDeckComparison,\n  useMatchStats,\n} from '@/api/matches'",
      "export { useDecks } from '@/api/decks'",
      "export * from '@/api/decks'",
      "const decks = await import('@/api/decks')",
      "import '@/api/queryClient'",
    ]) {
      const found = named(line)
      expect(found, line).toHaveLength(1)
      expect(found[0]?.typeOnly, line).toBe(false)
      expect(found[0]?.module, line).toMatch(/^api\//)
    }
    expect(named("import { useQuery } from '@tanstack/react-query'")).toEqual([
      { typeOnly: false, module: '@tanstack/react-query' },
    ])
  })

  it('reads a relative path as the file it reaches, and each line of several', () => {
    expect(named("import { request } from '../../api/client'")).toEqual([{ typeOnly: false, module: 'api/client' }])
    expect(named("import { NoData } from './Marks'")).toEqual([{ typeOnly: false, module: 'components/figures/Marks' }])
    expect(
      named("import type { WinRate } from '@/api/schemas'\nimport { cn } from '@/lib/utils'\nexport function A() {}\n"),
    ).toEqual([
      { typeOnly: true, module: 'api/schemas' },
      { typeOnly: false, module: 'lib/utils' },
    ])
    // And in the app as it is: the adapter takes types from the API and values from lib.
    expect(imports('lib/figure.ts')).toEqual([
      { typeOnly: true, module: 'api/schemas' },
      { typeOnly: false, module: 'lib/matches' },
    ])
    expect(imports('api/matches.ts')).toContainEqual({ typeOnly: false, module: '@tanstack/react-query' })
  })

  it('tells a hook of React from any other, and sees what asks for data', () => {
    expect(ownHooks('const [open, setOpen] = useState(false)\nconst id = useId()')).toEqual([])
    expect(ownHooks('const size = useRef<HTMLSpanElement>(null)')).toEqual([])
    expect(ownHooks('const comparison = useDeckComparison(deckId)')).toEqual(['useDeckComparison'])
    expect(ownHooks('const a = useQuery<Deck[]>({ queryKey })\nconst b = useQuery({ queryKey })')).toEqual(['useQuery'])
    // A hook that the file defines is not a call; calling it is.
    expect(ownHooks('export function useBoardSort(key: string) {}')).toEqual([])
    expect(ownHooks('function useBoardSort() {}\nconst sort = useBoardSort()')).toEqual(['useBoardSort'])
    for (const asking of [
      'const data = use(promise)',
      "await fetch('/api/decks')",
      "new EventSource('/api/play/1/events')",
      'query.refetch()',
      'refetchInterval: 5000',
      'setInterval(tick, 1000)',
    ]) {
      expect(ASKS.test(asking), asking).toBe(true)
    }
    for (const quiet of ['useState(0)', 'onRetry()', 'setTimeout(close, 0)', 'const user = 1', 'figure.record']) {
      expect(ASKS.test(quiet), quiet).toBe(false)
    }
  })

  it('finds a token with a hue in a class and in a variable, a colour written by hand, a cut and a stuck thing', () => {
    expect(huesIn('border-warning bg-[linear-gradient(90deg,var(--warning)_50%,transparent_50%)]')).toEqual(['warning'])
    expect(huesIn('text-success bg-destructive/8 bg-draw text-draw-foreground')).toEqual([
      'destructive',
      'draw',
      'success',
    ])
    expect(huesIn('bg-energy-fire [--acc:var(--energy-water)] bg-(image:--holo)')).toEqual(['energy', 'holo'])
    // The teal of the focus ring is a hue too, in a class and as a variable; the width of a ring is not.
    expect(huesIn('text-ring outline-ring/50 [--edge:var(--ring)]')).toEqual(['ring'])
    expect(huesIn('focus-visible:ring-2 string')).toEqual([])
    // A prop or a field with the same word is not a colour, and the text and surface tokens have no hue.
    expect(
      huesIn('warning?: ReactNode; props.warning; drawOdds(); bg-foreground text-card border-foreground-2'),
    ).toEqual([])
    for (const hand of [
      'text-amber-700',
      'bg-red-500/20',
      'text-white',
      'bg-black/50',
      "'#fbbf24'",
      'rgba(0, 0, 0, 0.5)',
      'text-[gold]',
      'border-l-[Tomato]',
      'bg-[CanvasText]',
      '[color:tomato]',
      '[background-color:red]',
      "style={{ color: 'tomato' }}",
      'style={{ backgroundColor: `red` }}',
    ]) {
      expect(HAND_COLOUR.test(hand), hand).toBe(true)
    }
    for (const token of [
      'text-warning',
      'whitespace-nowrap',
      'bg-surface-2',
      'mazo #12',
      'size-[18px]',
      'text-[15px]',
      'border-[1.5px]',
      'bg-[var(--card)]',
      'shadow-[0_0_0_2px_var(--chart-surface,var(--card))]',
      'bg-[linear-gradient(90deg,var(--warning)_50%,transparent_50%)]',
      '[--chart-surface:var(--background)]',
      'style={{ left: place(at) }}',
    ]) {
      expect(HAND_COLOUR.test(token), token).toBe(false)
    }
    for (const bad of [
      'block truncate font-medium',
      'line-clamp-2',
      'sticky top-0',
      "position: 'sticky'",
      "'fixed inset-x-0 bottom-0'",
      '"bottom-0 fixed"',
      'a md:fixed b',
      "position: 'fixed'",
      '[text-overflow:ellipsis]',
      "textOverflow: 'ellipsis'",
    ]) {
      expect(CUT_OR_STUCK.test(bad), bad).toBe(true)
    }
    for (const unread of [
      'style={{ fontSize: 11 }}',
      'text-[0.8em]',
      'text-[80%]',
      'text-[length:11px]',
      '[font-size:11px]',
      "font: '11px sans-serif'",
    ]) {
      expect(SIZE_UNREAD.test(unread), unread).toBe(true)
    }
    for (const read of ['text-[15px]', 'text-[0.875rem]', 'leading-[1.1em]', 'font-heading', 'text-sm']) {
      expect(SIZE_UNREAD.test(read), read).toBe(false)
    }
    for (const fine of [
      'data-slot="sticky-actions"',
      '<StickyActions>',
      'whitespace-nowrap',
      'break-words',
      "decimals === 'fixed'",
      "decimals?: 'fixed' | 'auto'",
      'prefixed',
    ]) {
      expect(CUT_OR_STUCK.test(fine), fine).toBe(false)
    }
  })

  it('gives each exported component its own code, and reads the slots it writes on an element', () => {
    const text = [
      "import { cn } from '@/lib/utils'",
      'const SHAPE = 1',
      'export function First({ empty }: { empty: boolean }) {',
      '  if (empty) return <span data-slot="first" />',
      '  return <span data-slot="first">a</span>',
      '}',
      'function inner() {}',
      'export const OTHER = 2',
      'export function second() {}',
      'export function Third({ className }: { className?: string }) {',
      '  return <i data-slot="third" className={cn(\'[&_[data-slot="first"]]:hidden\', className)} />',
      '}',
    ].join('\n')
    const found = componentsIn(text)
    // A component is a function with a capital: a helper in lower case is not one, exported or not.
    expect(found.map((component) => component.name)).toEqual(['First', 'Third'])
    expect(slotsIn(found[0]?.body ?? '')).toEqual(['first', 'first'])
    // What is not exported stays with the component above it; the next export ends it.
    expect(found[0]?.body).toContain('function inner')
    expect(found[0]?.body).not.toContain('OTHER')
    // A selector names a slot, it does not write one.
    expect(slotsIn(found[1]?.body ?? '')).toEqual(['third'])
    expect(slotsIn(text)).toEqual(['first', 'first', 'third'])
    expect(slotsIn('<span data-slot={slot} />')).toEqual([])
  })

  it('reads each opening tag whole, whatever its lines, and nothing of what is between two tags', () => {
    const text = [
      'const SIZE = { 6: "h-[6px]" }',
      'return (',
      '  <span data-slot="a" className={cn(BOX, className)}>',
      '    <i',
      '      data-part="reference"',
      '      style={{ left: place(at.reference) }}',
      '      className="absolute bg-warning"',
      '    />',
      '    {label}',
      '  </span>',
      ')',
    ].join('\n')
    const tags = tagsIn(text)
    expect(tags).toHaveLength(2)
    expect(tags[0]).toBe('<span data-slot="a" className={cn(BOX, className)}>')
    expect(tags[1]).toContain('data-part="reference"')
    expect(tags[1]).toContain('bg-warning')
    expect(huesIn(tags[0] ?? '')).toEqual([])
    expect(huesIn(tags[1] ?? '')).toEqual(['warning'])
    // A closing tag and a comparison are not an element.
    expect(tagsIn('</span>')).toEqual([])
    expect(tagsIn('if (a < b) return c > d')).toEqual([])
  })

  it('reads the code and not the comments, and keeps every line in its place', () => {
    const text = [
      '/** «orientativo»: never `truncate`. */',
      'export const A = 1 // sticky',
      '// fetch(',
      "const url = 'https://example.invalid/a'",
      '{/* dark: */}',
    ].join('\n')
    expect(withoutComments(text).split('\n')).toEqual([
      '                                       ',
      'export const A = 1 ',
      '',
      "const url = 'https://example.invalid/a'",
      '{           }',
    ])
  })
})

describe('the pieces of mock-up D: what only their source shows', () => {
  it('every source of a folder of pieces is listed, and every listed file is there', () => {
    expect(FOLDERS.flatMap((folder) => sources(folder)).sort()).toEqual(
      Object.keys(PIECES)
        .filter((path) => FOLDERS.some((folder) => path.startsWith(`${folder}/`)))
        .sort(),
    )
    for (const path of ruled) expect(existsSync(join(SRC, path)), path).toBe(true)
    expect(Object.keys(PIECES).length).toBeGreaterThanOrEqual(7)
  })

  it('point 6: a piece imports only types from the API, and nothing of react-query', () => {
    for (const path of ruled) {
      const found = imports(path)
      expect(
        found.filter((item) => !item.typeOnly && (item.module === 'api' || item.module.startsWith('api/'))),
        path,
      ).toEqual([])
      expect(
        found.filter((item) => item.module.startsWith('@tanstack/')),
        path,
      ).toEqual([])
      // A screen is not a piece's business either: it is the screen that brings the data.
      expect(
        found.filter((item) => /^(?:pages|app)\//.test(item.module)),
        path,
      ).toEqual([])
    }
  })

  it('point 6: a piece calls no hook that fetches, and asks for nothing by itself', () => {
    for (const path of ruled) {
      const text = code(path)
      // The hooks of its own that a piece calls are on its line: one of the API, or of a screen, is not a piece's.
      expect(ownHooks(text), path).toEqual([...(PIECES[path]?.hooks ?? [])].sort())
      expect(text, path).not.toMatch(ASKS)
    }
  })

  it('point 6: nothing new is polled: these are the sources with a `refetchInterval`, and how many each has', () => {
    const polled = Object.fromEntries(
      sources()
        .map((path) => [path, code(path).match(/\brefetchInterval\w*/g)?.length ?? 0] as const)
        .filter(([, times]) => times > 0),
    )
    // A poll more, in a new file or in one of these, moves this list: it is a decision, never a side effect.
    expect(polled).toEqual({
      'api/alerts.ts': 1,
      'api/calibration.ts': 2,
      'api/catalog.ts': 1,
      'api/decks.ts': 1,
      'api/lab.ts': 2,
      'api/play.ts': 1,
      'api/simulationAnalysis.ts': 1,
      'api/simulations.ts': 3,
      'api/tournaments.ts': 1,
    })
  })

  it('no name is cut, nothing sticks, and nothing is written under 13 px', () => {
    for (const path of [...Object.keys(PIECES), ...Object.keys(ADOPTED)]) {
      const text = code(path)
      // A name wraps to a second line, it is never cut with «…»; and nothing of a piece is stuck to the window.
      expect(text, path).not.toMatch(CUT_OR_STUCK)
      for (const [size, amount, unit] of text.matchAll(/(?<![\w-])text-\[(\d*\.?\d+)(px|rem)\]/g)) {
        expect(Number(amount) * (unit === 'rem' ? 16 : 1), `${path} ${size}`).toBeGreaterThanOrEqual(13)
      }
      // The sizes of the kit under 13 px were taken out of the theme; one written by hand in a style would not be,
      // nor one in a unit this cannot read here (em, %), nor one in a property of its own.
      expect(text, path).not.toMatch(SIZE_UNREAD)
    }
  })

  it('every component writes its `data-slot`, and a slot is of one piece only', () => {
    for (const [path, piece] of Object.entries(PIECES)) {
      const text = code(path)
      const components = componentsIn(text)
      // One slot for each component the file gives to others, in the order they are written.
      expect(components, path).toHaveLength(piece.slots.length)
      components.forEach((component, at) => {
        // Its own and no other. A component that returns one thing or another writes it on both: the same slot twice.
        expect([...new Set(slotsIn(component.body))], `${path} ${component.name}`).toEqual([piece.slots[at]])
      })
      // And nothing else of the file writes a slot.
      expect([...new Set(slotsIn(text))], path).toEqual(piece.slots)
    }
    const slots = Object.values(PIECES).flatMap((piece) => piece.slots)
    expect(new Set(slots).size).toBe(slots.length)
    // The screens suite selects a piece by its slot: no other source of the app writes one of them.
    const elsewhere = sources()
      .filter((path) => !(path in PIECES))
      .flatMap((path) =>
        [...code(path).matchAll(/(?<!\[)data-slot=["'{]+([a-z0-9-]+)/g)]
          .filter((found) => slots.includes(found[1] ?? ''))
          .map((found) => `${path} ${found[1]}`),
      )
    expect(elsewhere).toEqual([])
  })

  it('colour: each component uses the tokens with a hue that its line lists, and no colour written by hand', () => {
    for (const [path, piece] of Object.entries(PIECES)) {
      const text = code(path)
      const components = componentsIn(text)
      const allowed = piece.hues ?? {}
      // A hue is listed under a component the file really exports.
      expect(
        Object.keys(allowed).filter((name) => !components.some((component) => component.name === name)),
        path,
      ).toEqual([])
      for (const component of components) {
        expect(huesIn(component.body), `${path} ${component.name}`).toEqual([...(allowed[component.name] ?? [])].sort())
      }
      // And nothing of the file that is not the code of one of its components paints one.
      expect(huesIn(text), path).toEqual([...new Set(Object.values(allowed).flat())].sort())
      // Only the tokens: no palette of Tailwind, no literal.
      expect(text, path).not.toMatch(HAND_COLOUR)
    }
  })

  it('amber is the marks’ and the mark of a reference on a chart; the colours of a result, the record bar’s', () => {
    // Another component that takes one of them joins these lists, on purpose.
    expect(painters('warning')).toEqual([
      'components/figures/IntervalBar.tsx IntervalBar',
      'components/figures/Marks.tsx CoverageMark',
      'components/figures/Marks.tsx OrientativeMark',
      'components/figures/MiniCharts.tsx IntervalMark',
    ])
    for (const hue of ['success', 'destructive', 'draw'] as const) {
      expect(painters(hue), hue).toEqual(['components/figures/MiniCharts.tsx RecordBar'])
    }
    // The teal of the focus ring is the focus's: nothing of a figure is drawn with it.
    for (const hue of ['energy', 'holo', 'ring'] as const) expect(painters(hue), hue).toEqual([])
    // The list covers every hue there is: a new one in HUES has to be placed here.
    expect([...HUES].sort()).toEqual(['destructive', 'draw', 'energy', 'holo', 'ring', 'success', 'warning'])
  })

  it('on a chart the amber is one thing only: the mark of a reference', () => {
    for (const path of ['components/figures/MiniCharts.tsx', 'components/figures/IntervalBar.tsx']) {
      const text = code(path)
      const amber = tagsIn(text).filter((tag) => huesIn(tag).includes('warning'))
      expect(amber, path).toHaveLength(1)
      expect(amber[0], path).toContain('data-part="reference"')
      // And it is written nowhere else of the file: not in a constant, not in a class built on the way.
      expect(text.match(/-warning(?![a-zA-Z0-9_])/g), path).toHaveLength(1)
    }
  })

  it('in the record bar the colours of a result are three tones of its map, each on its own', () => {
    const text = code('components/figures/MiniCharts.tsx')
    expect(text).toContain("win: 'bg-success',")
    expect(text).toContain("loss: 'bg-destructive',")
    expect(text).toContain("draw: 'bg-draw',")
    for (const hue of ['success', 'destructive', 'draw']) {
      expect(text.match(new RegExp(`-${hue}(?![a-zA-Z0-9_])`, 'g')), hue).toHaveLength(1)
    }
  })
})

describe('the screens that take a piece, and the gallery', () => {
  it('reads a module as the source it is, and follows what a source loads, not what it only names as a type', () => {
    expect(sourceOf('lib/figure')).toBe('lib/figure.ts')
    expect(sourceOf('components/figures/SourceSeal')).toBe('components/figures/SourceSeal.tsx')
    expect(sourceOf('react')).toBeNull()
    expect(sourceOf('@tanstack/react-query')).toBeNull()
    // The adapter names the API's types and loads only the formats: nothing of the API runs with it.
    expect([...loaded('lib/figure.ts')].sort()).toEqual(['lib/format.ts', 'lib/matches.ts'])
    // A source that asks: its hooks load the client of the API and react-query.
    const asking = loaded('pages/mazos/DeckPerformance.tsx')
    expect(asking).toContain('api/matches.ts')
    expect(asking).toContain('api/client.ts')
    expect(asking).toContain('@tanstack/react-query')
    // And it reaches the pieces through the one source it draws them with.
    expect(asking).toContain('pages/mazos/SourceLanes.tsx')
    expect(asking).toContain('components/figures/SourceBlock.tsx')
  })

  it('point 6, however far the imports go: nothing a piece or the gallery loads is the API’s, or react-query’s', () => {
    for (const path of QUIET) {
      expect(existsSync(join(SRC, path)), path).toBe(true)
      const reached = [...loaded(path)]
      expect(
        reached.filter((module) => module.startsWith('api/') || module.startsWith('@tanstack/')),
        path,
      ).toEqual([])
      // Nor a screen that asks: the gallery draws the deck's three sources through the source that only draws them.
      expect(
        reached.filter((module) => /^(?:pages|app)\//.test(module) && !QUIET.includes(module)),
        path,
      ).toEqual([])
    }
    // The gallery does load every piece: it is where each one is seen.
    const gallery = loaded('pages/mas/PiecesPage.tsx')
    for (const path of Object.keys(PIECES)) expect(gallery, path).toContain(path)
    expect(gallery).toContain(FIXTURES)
  })

  it('point 6: the gallery and what it is drawn with call no hook and ask for nothing by themselves', () => {
    for (const path of [...Object.keys(ADOPTED), FIXTURES]) {
      const text = code(path)
      expect(ownHooks(text), path).toEqual([])
      expect(text, path).not.toMatch(ASKS)
      // No hook of React either: these draw what they are given, and keep nothing.
      expect(text.match(/\buse[A-Z]\w*\s*\(/g) ?? [], path).toEqual([])
    }
  })

  it('point 6: every source that draws a piece is listed, with a test that reads the requests of its screen', () => {
    const drawing = sources()
      .filter((path) => !(path in PIECES))
      .filter((path) => imports(path).some((item) => FOLDERS.some((folder) => item.module.startsWith(`${folder}/`))))
      .sort()
    expect(drawing).toEqual(Object.keys(ADOPTED).sort())
    for (const [path, test] of Object.entries(ADOPTED)) {
      expect(existsSync(join(SRC, test)), `${path}: ${test}`).toBe(true)
      const text = readFileSync(join(SRC, test), 'utf8')
      // The log of the fake API, compared whole: with a list, or with nothing at all.
      expect(text, test).toMatch(/const \{ calls(?:, \w+)* \} = /)
      expect(text, test).toMatch(/expect\((?:requests\(calls\)|calls)\)\.toEqual\(/)
    }
    // The deck's «Rendimiento» is the screen that brings the three sources their columns, and its test says what it
    // asked before the blocks.
    expect(imports('pages/mazos/DeckPerformance.tsx')).toContainEqual({
      typeOnly: false,
      module: 'pages/mazos/SourceLanes',
    })
    const deck = readFileSync(join(SRC, 'pages/mazos/DeckPerformance.test.tsx'), 'utf8')
    expect(deck).toMatch(/const BEFORE = \[[^\]]*'GET \/api\/decks\/40\/comparison'/)
    expect(deck.match(/expect\(requests\(calls\)\)\.toEqual\(BEFORE\)/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('the test data is the gallery’s: no other source of the app reads it, and none reads what is only for tests', () => {
    const reading = (module: string) =>
      sources()
        .filter((path) => imports(path).some((item) => item.module === module || item.module.startsWith(`${module}/`)))
        .sort()
    // Invented numbers never reach a real screen: the fixtures are imported by the gallery page alone.
    expect(reading('pages/mas/pieces/fixtures')).toEqual(['pages/mas/PiecesPage.tsx'])
    expect(reading('pages/mas/pieces')).toEqual(['pages/mas/PiecesPage.tsx'])
    // And nothing that ships reads src/test (the helpers of the tests, and the figures they share).
    expect(reading('test')).toEqual([])
    // The gallery is opened by its route, and by nothing else.
    expect(reading('pages/mas/PiecesPage')).toEqual(['app/routes.tsx'])
  })

  it('the gallery and the three sources of a deck paint with the text and surface tokens only', () => {
    for (const path of Object.keys(ADOPTED)) {
      const text = code(path)
      expect(huesIn(text), path).toEqual([])
      expect(text, path).not.toMatch(HAND_COLOUR)
    }
  })

  it('every number of the gallery comes from its test data or from a format: the page writes no percentage', () => {
    const text = code('pages/mas/PiecesPage.tsx')
    // A percentage written by hand would be a number of nobody's fixtures: «51,1 %», «{value} %», «50%».
    expect(text).not.toMatch(/\d(?:[,.]\d+)?\s*(?:%|&nbsp;%)/)
    // And it says what its numbers are, in the words the page promises.
    expect(text).toContain("const NOTICE = 'Datos de prueba: ninguna cifra de esta página es tuya'")
  })
})

describe('«orientativo» says what it counted', () => {
  it('every badge is given the kind of sample of its own rate; these are all of them, each with what it is given', () => {
    const badges = sources().flatMap((path) =>
      [...code(path).matchAll(/<OrientativeBadge\b([^>]*)\/>/g)].map((found) => [path, (found[1] ?? '').trim()]),
    )
    // The whole list, with the props of each: a badge with a kind written by hand («kind="matches"» on a rate that
    // counts lists) says the wrong thing with every other test green, so one more, or one changed, moves this list.
    expect(badges.sort(([a = '', x = ''], [b = '', y = '']) => a.localeCompare(b) || x.localeCompare(y))).toEqual([
      ['components/RateSummary.tsx', 'kind={rate.sampleKind}'],
      ['components/RateSummary.tsx', 'kind={row.rate.sampleKind}'],
      // The coin-adjusted rate of own matches is no `WinRate`: it has no kind, and the default is its own.
      ['components/TurnOrderCard.tsx', ''],
      ['pages/mazos/TournamentVersion.tsx', 'kind={list.rate.sampleKind}'],
      ['pages/simulacion/SimulationDetailPage.tsx', 'kind={row.rate.sampleKind}'],
      ['pages/simulacion/SimulationDetailPage.tsx', 'kind={selectedCell.rate.sampleKind}'],
      // A difference between two rates has no kind either, and the API decides it on lists.
      ['pages/torneos/ArchetypeCards.tsx', 'kind="lists"'],
      ['pages/torneos/ArchetypeCards.tsx', 'kind={row.rate.sampleKind}'],
    ])
    // The three columns of a deck are not in it: they are blocks now, and their «orientativo» is the block's.
  })
})
