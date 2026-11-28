// The theme is CSS, and vitest runs without it (`css: false`): this reads src/index.css as text instead. It checks
// that every colour utility has a value in the two themes, that the pairs the app writes text with pass WCAG AA, and
// that the fonts are files of the app that the service worker keeps.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_COLOR } from '@/lib/look'

// The tests run from apps/web (jsdom's import.meta.url is not a file URL).
const ROOT = process.cwd()
const RAW_CSS = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8')
const CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
const THEMES = ['dark', 'light'] as const
type Theme = (typeof THEMES)[number]
const SRC = resolve(ROOT, 'src')
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8')

/** Every source of the app that is not a test, as [path from src with «/» on every system, text]. */
function sources(dir = SRC): [string, string][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): [string, string][] => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [[relative(SRC, path).split(sep).join('/'), readFileSync(path, 'utf8')]]
  })
}

/** The declarations of the block that starts with `header`, custom properties and the others (no nested braces). */
function block(header: string): Map<string, string> {
  const start = CSS.indexOf(`${header} {`)
  if (start < 0) throw new Error(`no «${header}» block in src/index.css`)
  const body = CSS.slice(start + header.length + 2, CSS.indexOf('}', start))
  const found = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    if (name && value) found.set(name, value.replace(/\s+/g, ' ').trim())
  }
  return found
}

const THEME_BLOCK = block('@theme inline')
const DARK = block(':root')
const LIGHT = block(':root[data-theme="light"]')
// The light theme is the dark one with some values replaced, as the cascade does it.
const VALUES: Record<Theme, Map<string, string>> = { dark: DARK, light: new Map([...DARK, ...LIGHT]) }

/** The value of a custom property in a theme, following `var(--other)`. */
function tokenValue(name: string, theme: Theme, depth = 0): string {
  const value = VALUES[theme].get(name)
  if (value === undefined) throw new Error(`${name} has no value in the ${theme} theme`)
  const reference = /^var\((--[\w-]+)\)$/.exec(value)
  if (!reference?.[1]) return value
  if (depth > 8) throw new Error(`${name} points at itself`)
  return tokenValue(reference[1], theme, depth + 1)
}

interface Rgba {
  rgb: [number, number, number]
  alpha: number
}

function parseColor(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1]
  if (hex) {
    return { rgb: [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as Rgba['rgb'], alpha: 1 }
  }
  const rgba = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(value)
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) }
  return null
}

function colorOf(name: string, theme: Theme): Rgba {
  const value = tokenValue(name, theme)
  const color = parseColor(value)
  if (!color) throw new Error(`${name} is not a colour in the ${theme} theme: ${value}`)
  return color
}

/** A colour as it is seen on an opaque surface. */
function seenOn(color: Rgba, surface: Rgba): [number, number, number] {
  if (surface.alpha !== 1) throw new Error('a surface must be opaque')
  return color.rgb.map((channel, at) => channel * color.alpha + (surface.rgb[at] ?? 0) * (1 - color.alpha)) as [
    number,
    number,
    number,
  ]
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast of a colour drawn on an opaque surface. */
function ratio(foreground: Rgba, surface: Rgba): number {
  const [lighter, darker] = [luminance(seenOn(foreground, surface)), luminance(surface.rgb)].sort((a, b) => b - a) as [
    number,
    number,
  ]
  return (lighter + 0.05) / (darker + 0.05)
}

/** The same, for two tokens in a theme: `--foreground` on `--surface`. */
const contrast = (foreground: string, surface: string, theme: Theme) =>
  ratio(colorOf(foreground, theme), colorOf(surface, theme))

/** The colour tokens of the theme (`--color-x` in `@theme inline`), by their utility name («foreground-2»). */
const COLOUR_TOKENS = new Set(
  [...THEME_BLOCK.keys()].filter((name) => name.startsWith('--color-')).map((name) => name.slice('--color-'.length)),
)

/**
 * The colour tokens a code paints with: as text («text-foreground-3») and as a graphic (a fill, an edge, a variable in a
 * shadow or a gradient). Read from the code, so a change of shape or size does not move a test built on it; a new
 * colour does.
 */
function paints(code: string): { text: string[]; graphic: string[] } {
  const text = new Set<string>()
  const graphic = new Set<string>()
  const utility =
    /(?<![\w-])(text|bg|border(?:-[trblxy])?|fill|stroke|outline|ring|decoration|from|via|to)-([a-z][\w-]*?)(?=[^\w-]|$)/g
  for (const [, kind = '', token = ''] of code.matchAll(utility)) {
    if (COLOUR_TOKENS.has(token)) (kind === 'text' ? text : graphic).add(token)
  }
  for (const [, token = ''] of code.matchAll(/var\(--([\w-]+)\)/g)) {
    if (COLOUR_TOKENS.has(token)) graphic.add(token)
  }
  return { text: [...text].sort(), graphic: [...graphic].sort() }
}

/** `--text` on a surface tinted with `alpha` of `--tint` (what `bg-primary/10` paints over the page). */
function contrastOnTint(text: string, tint: string, alpha: number, surface: string, theme: Theme): number {
  const tinted = seenOn({ rgb: colorOf(tint, theme).rgb, alpha }, colorOf(surface, theme))
  return ratio(colorOf(text, theme), { rgb: tinted, alpha: 1 })
}

describe('the contrast helper', () => {
  const color = (value: string) => {
    const parsed = parseColor(value)
    if (!parsed) throw new Error(value)
    return parsed
  }

  it('gives the known ratios', () => {
    expect(ratio(color('#ffffff'), color('#000000'))).toBeCloseTo(21, 5)
    expect(ratio(color('#000000'), color('#ffffff'))).toBeCloseTo(21, 5)
    expect(ratio(color('#ffffff'), color('#ffffff'))).toBe(1)
    // #767676 is the lightest grey that passes AA on white.
    expect(ratio(color('#767676'), color('#ffffff'))).toBeCloseTo(4.54, 2)
    // A translucent colour is composed over its surface first: half white over black is a mid grey.
    expect(ratio(color('rgba(255, 255, 255, 0.5)'), color('#000000'))).toBeCloseTo(5.28, 2)
    expect(ratio(color('rgba(255, 255, 255, 0)'), color('#000000'))).toBe(1)
  })

  it('reads the two ways the stylesheet writes a colour, and nothing else', () => {
    expect(parseColor('#0a0e14')).toEqual({ rgb: [10, 14, 20], alpha: 1 })
    expect(parseColor('rgba(20, 26, 34, 0.11)')).toEqual({ rgb: [20, 26, 34], alpha: 0.11 })
    expect(parseColor('oklch(1 0 0)')).toBeNull()
    expect(parseColor('linear-gradient(120deg, #3fd6c6, #8b9cff 50%, #e6a4ff)')).toBeNull()
  })
})

describe('the tokens of src/index.css', () => {
  const colorTokens = [...THEME_BLOCK].filter(([name]) => name.startsWith('--color-'))

  it('every colour utility has a colour in each theme', () => {
    expect(colorTokens.length).toBeGreaterThan(40)
    for (const [name, value] of colorTokens) {
      const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
      expect(reference, `${name} must point at a token`).toBeTruthy()
      for (const theme of THEMES) expect(() => colorOf(reference ?? '', theme), `${name} (${theme})`).not.toThrow()
    }
  })

  it('the two themes define the same palette: what one sets, the other sets too', () => {
    const themed = (values: Map<string, string>) =>
      [...values]
        .filter(([, value]) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(value))
        .map(([name]) => name)
        .sort()
    expect(themed(LIGHT)).toEqual(themed(DARK))
    // Nothing else changes with the theme: no radius, no motion, no alias. Only `color-scheme`, with it.
    expect([...LIGHT.keys()].filter((name) => name.startsWith('--')).sort()).toEqual(themed(LIGHT))
    expect(tokenValue('color-scheme', 'dark')).toBe('dark')
    expect(tokenValue('color-scheme', 'light')).toBe('light')
  })

  it('the names the code uses are all there, and the old ones nobody used are gone', () => {
    const names = new Set(colorTokens.map(([name]) => name.slice('--color-'.length)))
    for (const name of [
      'background',
      'foreground',
      'card',
      'card-foreground',
      'popover',
      'popover-foreground',
      'primary',
      'primary-foreground',
      'secondary',
      'secondary-foreground',
      'muted',
      'muted-foreground',
      'accent',
      'accent-foreground',
      'destructive',
      'destructive-foreground',
      'success',
      'success-foreground',
      'warning',
      'warning-foreground',
      'border',
      'input',
      'ring',
      'background-outer',
      'surface-2',
      'surface-3',
      'edge',
      'foreground-2',
      'foreground-3',
      'draw',
      'draw-foreground',
      'scrim',
      'track',
      'band',
    ]) {
      expect(names, name).toContain(name)
    }
    expect([...names].filter((name) => /^(chart|sidebar)/.test(name))).toEqual([])
    // A gradient, a shadow and the motion are plain custom properties, in both themes where they change.
    for (const theme of THEMES) {
      expect(tokenValue('--holo', theme)).toMatch(/^linear-gradient\(/)
      expect(tokenValue('--shadow-card', theme)).toMatch(/rgba\(/)
      for (const name of ['--dur-1', '--dur-2', '--dur-3', '--ease', '--spring', '--radius']) {
        expect(tokenValue(name, theme)).not.toBe('')
      }
    }
  })

  it('the browser paints its own bars with the page background: the meta, the script and the manifest agree', () => {
    for (const theme of THEMES) expect(tokenValue('--background', theme)).toBe(THEME_COLOR[theme])
    // An installed app opens dark, the default, before any script runs.
    const config = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')
    expect(config).toContain(`theme_color: '${THEME_COLOR.dark}'`)
    expect(config).toContain(`background_color: '${THEME_COLOR.dark}'`)
  })

  describe.each(THEMES)('WCAG AA in the %s theme', (theme) => {
    const TEXT = 4.5
    const EDGE = 3

    it.each(['--background', '--card'])('text on %s', (surface) => {
      // `--ring` is also written as text: the side whose turn it is and the hint next to the marked spots.
      for (const text of ['--foreground', '--muted-foreground', '--destructive', '--success', '--warning', '--ring']) {
        expect(contrast(text, surface, theme), `${text} on ${surface}`).toBeGreaterThanOrEqual(TEXT)
      }
    })

    it.each(['primary', 'secondary', 'accent', 'destructive', 'success', 'warning'])(
      'the text of a %s fill',
      (name) => {
        expect(contrast(`--${name}-foreground`, `--${name}`, theme)).toBeGreaterThanOrEqual(TEXT)
      },
    )

    it('muted text on muted, card text on a card, popover text on a popover', () => {
      expect(contrast('--muted-foreground', '--muted', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--card-foreground', '--card', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--popover-foreground', '--popover', theme)).toBeGreaterThanOrEqual(TEXT)
    })

    it.each(['--input', '--ring'])('%s, an edge, against the page, a card and a control', (edge) => {
      for (const surface of ['--background', '--card', '--secondary']) {
        expect(contrast(edge, surface, theme), `${edge} on ${surface}`).toBeGreaterThanOrEqual(EDGE)
      }
    })

    it('a field: its placeholder and its text on the fill, the switch’s thumb on its track', () => {
      // ui/input, ui/textarea, ui/select: `bg-secondary`, `placeholder:text-muted-foreground`.
      expect(contrast('--muted-foreground', '--secondary', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--foreground', '--secondary', theme)).toBeGreaterThanOrEqual(TEXT)
      // ui/switch: unchecked `bg-surface-3` with an `--input` edge and a `--foreground-2` thumb; checked, primary.
      expect(contrast('--input', '--surface-3', theme)).toBeGreaterThanOrEqual(EDGE)
      expect(contrast('--foreground-2', '--surface-3', theme)).toBeGreaterThanOrEqual(EDGE)
      expect(contrast('--primary-foreground', '--primary', theme)).toBeGreaterThanOrEqual(EDGE)
    })

    it('text on the tints the app writes', () => {
      // Muted text on a chosen row (`bg-primary/10`): why `--muted-foreground` is D's tx2 and not tx3.
      for (const surface of ['--background', '--card']) {
        expect(contrastOnTint('--muted-foreground', '--primary', 0.1, surface, theme), surface).toBeGreaterThanOrEqual(
          TEXT,
        )
      }
      // ui/button and ui/badge, `destructive`: red text on a tint of itself (alpha 0.08), wherever the button sits.
      for (const file of ['button.tsx', 'badge.tsx']) {
        expect(readFileSync(resolve(ROOT, 'src/components/ui', file), 'utf8')).toContain(
          "'bg-destructive/8 text-destructive ",
        )
      }
      for (const surface of ['--background', '--card', '--secondary']) {
        expect(contrastOnTint('--destructive', '--destructive', 0.08, surface, theme), surface).toBeGreaterThanOrEqual(
          TEXT,
        )
      }
      // The same pair written by a page (a wrong answer, the warning of a destructive catalogue update): red text
      // goes on that tint and no other. A stronger one is a bar or a state of the pointer, never under red text.
      const tints = sources().flatMap(([path, text]) =>
        text
          .split('\n')
          .filter((line) => /\btext-destructive\b/.test(line))
          .flatMap((line) => [...line.matchAll(/(?<![\w:-])bg-destructive\/(\d+)/g)].map((m) => `${path} /${m[1]}`)),
      )
      expect(tints.length).toBeGreaterThanOrEqual(4)
      expect(tints.filter((tint) => !tint.endsWith(' /8'))).toEqual([])
    })

    it('a figure written on a coloured bar takes the text colour', () => {
      // The option bars of a replay and of a solved puzzle: muted text on them fell to 3.61:1 in the light theme.
      const bars: [string, number][] = [
        ['--primary', 0.25],
        ['--success', 0.3],
        ['--destructive', 0.25],
      ]
      for (const [tint, alpha] of bars) {
        for (const surface of ['--background', '--card']) {
          expect(
            contrastOnTint('--foreground', tint, alpha, surface, theme),
            `${tint} ${alpha} on ${surface}`,
          ).toBeGreaterThanOrEqual(TEXT)
        }
      }
      const replay = read('components/replay/ReplayViewer.tsx')
      expect(replay).toContain("i === step.chosen ? 'bg-primary/25' : 'bg-muted'")
      expect(replay).toContain("i === step.chosen ? 'text-foreground' : 'text-muted-foreground'")
      const puzzle = read('pages/jugar/PuzzlePage.tsx')
      expect(puzzle).toContain(
        "i === result.best ? 'bg-success/30' : i === result.answer ? 'bg-destructive/25' : 'bg-muted'",
      )
      expect(puzzle).toContain("i === result.best || i === result.answer ? 'text-foreground' : 'text-muted-foreground'")
    })
  })

  it('one `dark:` branch is left, the fill of a destructive button, and its pair passes AA in the dark theme', () => {
    // Every other branch was folded into one rule for both themes. This one stays because the tint the light theme
    // takes (alpha 0.08) leaves a dark button without a fill; D does the same with a defeat (alpha 0.18 dark, 0.06 light).
    const found = sources()
      .flatMap(([path, text]) => [...text.matchAll(/\bdark:[^\s'"`]+/g)].map((m) => `${path} ${m[0]}`))
      .sort()
    expect(found).toEqual([
      'components/ui/badge.tsx dark:bg-destructive/20',
      'components/ui/button.tsx dark:bg-destructive/20',
    ])
    for (const surface of ['--background', '--card', '--secondary']) {
      expect(contrastOnTint('--destructive', '--destructive', 0.2, surface, 'dark'), surface).toBeGreaterThanOrEqual(
        4.5,
      )
    }
    // In the light theme that tint fails on the page, which is why it is a branch and why the pointer adds an edge
    // (`hover:border-destructive`, an edge of ≥ 3:1) and not more tint.
    expect(contrastOnTint('--destructive', '--destructive', 0.2, '--background', 'light')).toBeLessThan(4.5)
    for (const file of ['button.tsx', 'badge.tsx']) {
      expect(read(`components/ui/${file}`), file).toContain('hover:border-destructive')
      expect(read(`components/ui/${file}`), file).not.toMatch(/hover:bg-destructive\/\d/)
    }
    for (const theme of THEMES) expect(contrast('--destructive', '--background', theme)).toBeGreaterThanOrEqual(3)
    // The amber of a warning is the token, in a page too (amber-700 gave 4.34:1 on the light page background).
    expect(
      sources()
        .filter(([, text]) => /\btext-(?:amber|yellow|orange)-\d/.test(text))
        .map(([path]) => path),
    ).toEqual([])
  })

  it('the primary has no hue, so what points at a marked spot takes the colour the spot is drawn with', () => {
    // In the dark theme the primary and the text are the same colour to the eye: as a highlight it says nothing.
    expect(contrast('--primary', '--foreground', 'dark')).toBeLessThan(1.1)
    for (const file of ['pages/jugar/GamePage.tsx', 'pages/jugar/PuzzlePage.tsx']) {
      expect(read(file), file).toMatch(/className="[^"]*\btext-ring\b[^"]*">Tocá un lugar marcado</)
    }
    expect(read('components/board/Table.tsx')).toMatch(/target && 'board-target [^']*\bring-ring\b/)
  })
})

describe('what only the stylesheet and the class names say', () => {
  const UI = readdirSync(resolve(SRC, 'components/ui')).filter((file) => file.endsWith('.tsx'))
  const ui = (file: string) => read(`components/ui/${file}`)
  /** The selectors of every rule of the stylesheet that is only `@apply <utility>;`. */
  const applied = (utility: string) =>
    [...CSS.matchAll(new RegExp(`([^{}]+)\\{\\s*@apply ${utility};\\s*\\}`, 'g'))].map((match) =>
      (match[1] ?? '').replace(/\s+/g, ' ').trim(),
    )

  it('the theme follows the attribute, never the system', () => {
    expect(CSS).toContain('@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));')
    expect(CSS).not.toMatch(/prefers-color-scheme/)
    expect(ui('sonner.tsx')).toContain('theme={resolved}')
  })

  it('the display face goes on titles, controls, labels, figures, badges and what looks like a button', () => {
    expect(applied('font-heading')).toEqual([
      'h1, h2, h3, h4, h5, h6, button, [role="button"], [role="tab"], summary, th, label, legend',
    ])
    expect(/@utility tabular\s*\{([^}]*)\}/.exec(CSS)?.[1]).toMatch(/font-family:\s*var\(--font-heading\);/)
    // A link with the look of a button (`asChild`, `buttonVariants()`) is not a <button>: the class carries the face.
    for (const file of ['badge.tsx', 'button.tsx'])
      expect(/cva\(\s*["']([^"']+)["']/.exec(ui(file))?.[1]).toMatch(/\bfont-heading\b/)
  })

  it('and not on what is typed in a field, on the game board or on a help paragraph inside a label', () => {
    // Preflight makes a field inherit its font: inside a <label> it would take the label's. The board's tiles are
    // buttons, and its 9 to 11 px figures are too small for a condensed face.
    expect(applied('font-sans')).toEqual([
      'label :is(input, select, textarea)',
      '.board-table :is(button, [role="button"])',
    ])
    expect(read('components/board/Table.tsx')).toMatch(/<div className="board-table [^"]*">\s*<Side /)
    // A paragraph of help next to a switch or a checkbox is written inside the <label>: it says so itself.
    const hints: string[] = []
    for (const [path, text] of sources()) {
      let depth = 0
      let start = 0
      for (const tag of text.matchAll(/<(\/?)[Ll]abel\b[^>]*?(\/?)>/g)) {
        if (tag[2] === '/') continue
        if (tag[1] !== '/') {
          if (depth === 0) start = tag.index
          depth += 1
          continue
        }
        depth -= 1
        if (depth !== 0) continue
        for (const hint of text
          .slice(start, tag.index)
          .matchAll(/className="([^"]*\bblock\b[^"]*\btext-muted-foreground\b[^"]*)"/g)) {
          hints.push(`${path}: ${/\bfont-sans\b/.test(hint[1] ?? '') ? 'text face' : 'display face'}`)
        }
      }
    }
    expect(hints.length).toBeGreaterThanOrEqual(7)
    expect(hints.filter((hint) => !hint.endsWith('text face'))).toEqual([])
    // So is a label that is a sentence: the text next to a checkbox that says what ticking it does.
    const sentences = sources().flatMap(([path, text]) =>
      [...text.matchAll(/<label htmlFor="[^"]+"([^>]*)>([^<]*)<\/label>/g)]
        .filter((label) => (label[2] ?? '').replace(/\s+/g, ' ').trim().length > 60)
        .map((label) => `${path}: ${/\bfont-sans\b/.test(label[1] ?? '') ? 'text face' : 'display face'}`),
    )
    expect(sentences.length).toBeGreaterThanOrEqual(5)
    expect(sentences.filter((sentence) => !sentence.endsWith('text face'))).toEqual([])
    expect(read('pages/mas/CatalogPage.tsx')).toMatch(/<label className="[^"]*\bfont-sans\b[^"]*text-destructive">/)
    // The board: a tile written as text keeps the text face wherever it is drawn (the discard pile is a sheet,
    // outside the board), and the line with the player's name and counts is 13 px figures, whole in the display face.
    expect(read('components/board/CardArt.tsx')).toContain('p-1 text-left font-sans')
    const table = read('components/board/Table.tsx')
    expect(table).toContain('<div className="flex items-center gap-2 font-heading text-xs">')
    expect(table).toMatch(/className="font-heading [^"]*"\s*>\s*desc\. /)
    // One line, one face: the details under a rate and under a match are figures, in the display face as a whole; a
    // figure inside a sentence keeps the face of the sentence (`tabular-nums`, not `tabular`).
    expect(read('components/RateSummary.tsx')).toContain('gap-y-1 font-heading text-xs text-muted-foreground')
    expect(read('pages/partidas/MatchList.tsx')).toContain('block truncate font-heading text-xs text-muted-foreground')
    for (const file of ['pages/mazos/PickTodayPage.tsx', 'components/TurnOrderCard.tsx']) {
      expect(read(file), file).not.toMatch(/\btabular\b(?!-)/)
    }
  })

  it('the fallback faces stand in for Latin text only, so a symbol is not drawn shrunk', () => {
    const local = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((m) => m[1] ?? '')
      .filter((face) => !face.includes('url('))
    expect(local).toHaveLength(2)
    for (const face of local) {
      const ranges = (/unicode-range:\s*([^;]+);/.exec(face)?.[1] ?? '').split(',').map((range) => {
        const [from, to] = range.trim().replace(/^U\+/, '').split('-')
        return [Number.parseInt(from ?? '', 16), Number.parseInt(to ?? from ?? '', 16)] as const
      })
      const covers = (character: string) =>
        ranges.some(([from, to]) => (character.codePointAt(0) ?? 0) >= from && (character.codePointAt(0) ?? 0) <= to)
      for (const character of 'Añ·«»–—…€−\u00a0 09%,.') expect(covers(character), character).toBe(true)
      // Rarities, arrows and marks: the display face has none of them and the system draws them at full size.
      for (const character of '◊☆★✵→←▸✓≥≈') expect(covers(character), character).toBe(false)
    }
  })

  it('`text-xs` keeps its 16 px line, and the small button and a toast’s button use it', () => {
    expect(/--text-xs--line-height:\s*([^;]+);/.exec(CSS)?.[1]).toBe('calc(1 / 0.8125)')
    expect(ui('button.tsx')).not.toContain('text-[0.8rem]')
    // sonner writes its buttons at 12 px with a black focus shadow; `!` because its selectors outweigh a class.
    const toastButton = /const TOAST_BUTTON = '([^']+)'/.exec(ui('sonner.tsx'))?.[1]?.split(' ')
    expect(toastButton).toEqual(
      expect.arrayContaining(['text-xs!', 'focus-visible:ring-2!', 'focus-visible:ring-ring!']),
    )
    expect(ui('sonner.tsx')).toMatch(/actionButton: TOAST_BUTTON,\s*cancelButton: TOAST_BUTTON,/)
  })

  it('components/ui: a solid 2 px focus ring, solid fields, the scrim', () => {
    expect(UI.length).toBeGreaterThan(10)
    for (const file of UI) {
      expect(ui(file), file).not.toMatch(/ring-ring\/\d|focus-visible:ring-(?:3|\[3px\])/)
      expect(ui(file), file).not.toMatch(/bg-input\/\d/)
    }
    for (const file of ['input.tsx', 'textarea.tsx', 'select.tsx', 'checkbox.tsx']) {
      expect(ui(file), file).toContain('border-input bg-secondary')
    }
    for (const file of ['dialog.tsx', 'sheet.tsx']) {
      expect(ui(file), file).toContain('bg-scrim')
      expect(ui(file), file).not.toContain('bg-black/')
    }
    expect(ui('tabs.tsx')).not.toContain('text-foreground/60')
    expect(CSS).toMatch(/@apply border-border outline-ring;/)
    const pulse = /@keyframes board-pulse\s*\{[\s\S]*?\n\}/.exec(CSS)?.[0]
    expect(pulse).toMatch(/var\(--ring\)/)
    expect(pulse).not.toMatch(/var\(--primary\)/)
  })

  it('outside the kit: a native select looks like a field, and a chosen chip still shows the focus ring', () => {
    const selects = sources().filter(([path, text]) => !path.startsWith('components/ui/') && /<select\b/.test(text))
    expect(selects.length).toBeGreaterThanOrEqual(3)
    for (const [path, text] of selects) {
      expect(text, path).toContain('border border-input bg-secondary')
      expect(text, path).not.toMatch(/\bborder bg-background(?!\/)/)
    }
    // `aria-pressed:ring-*` comes later in the stylesheet than `focus-visible:ring-ring`: a chip that draws its
    // choice with a ring names the focus ring again, with both variants.
    const pressed = sources().flatMap(([path, text]) =>
      text
        .split('\n')
        .filter((line) => /aria-pressed:ring-/.test(line))
        .map((line) => [path, line] as const),
    )
    expect(pressed.length).toBeGreaterThanOrEqual(1)
    for (const [path, line] of pressed) {
      expect(line, path).toContain('aria-pressed:focus-visible:border-ring aria-pressed:focus-visible:ring-ring')
      // With the focus ring in its place, the choice moves to an inner band: the two marks show together.
      expect(line, path).toContain(
        'aria-pressed:focus-visible:inset-ring-2 aria-pressed:focus-visible:inset-ring-primary',
      )
    }
  })

  it('no link is told apart by its colour alone: `text-primary` never waits for the pointer to be underlined', () => {
    const found = sources().flatMap(([path, text]) =>
      text
        .split('\n')
        .flatMap((line, at) =>
          /\btext-primary(?![\w-])/.test(line) && /hover:underline/.test(line) ? [`${path}:${at + 1}`] : [],
        ),
    )
    expect(found).toEqual([])
  })
})

describe('the frame', () => {
  it('its sizes are variables, set once', () => {
    expect(DARK.get('--frame')).toBe('30rem')
    expect(DARK.get('--header-h')).toBe('52px')
    expect(DARK.get('--bar-h')).toBe('58px')
    expect(DARK.get('--row-h')).toBe('60px')
    // They do not change with the theme, and nothing else in the stylesheet sets them.
    for (const name of ['--frame', '--header-h', '--bar-h', '--row-h']) {
      expect(LIGHT.has(name), name).toBe(false)
      expect(CSS.match(new RegExp(`${name}:`, 'g')), name).toHaveLength(1)
    }
    // No component writes the column's or the bars' sizes by hand, not even inside a calc(): every bracketed class
    // that holds one of them is listed here, and these three are other things that happen to measure 60 px (the
    // least width of a view tab, a card's thumbnail).
    const literal = sources()
      .flatMap(([path, text]) =>
        [...text.matchAll(/[\w-]*\[[^\]\s]*\b(?:480px|30rem|52px|58px|60px)[^\]\s]*\]/g)].map(
          (match) => `${path} ${match[0]}`,
        ),
      )
      .sort()
    expect(literal).toEqual([
      'app/RowAction.tsx min-w-[60px]',
      'pages/cartas/CardPage.tsx w-[60px]',
      'pages/cartas/GroupPage.tsx w-[60px]',
    ])
  })

  it('the row’s fill, the fill of its chosen view and its shadow are literals in both themes', () => {
    expect(DARK.get('--row')).toBe('#243041')
    expect(LIGHT.get('--row')).toBe('#ffffff')
    expect(DARK.get('--row-selected')).toBe('#444f5e')
    expect(LIGHT.get('--row-selected')).toBe('#ece8e0')
    expect(DARK.get('--shadow-row')).toBe('inset 0 1px 0 var(--edge), 0 14px 30px -10px rgba(0, 0, 0, 0.65)')
    expect(LIGHT.get('--shadow-row')).toBe('0 10px 26px -10px rgba(40, 34, 20, 0.35)')
    expect(THEME_BLOCK.get('--color-row')).toBe('var(--row)')
    expect(THEME_BLOCK.get('--color-row-selected')).toBe('var(--row-selected)')
  })

  it('the app is one column on a page of the outer colour, and the window stays the scroller', () => {
    const root = /#root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(root).toMatch(/max-width:\s*var\(--frame\);/)
    expect(root).toMatch(/margin-inline:\s*auto;/)
    expect(root).toMatch(/min-height:\s*100dvh;/)
    expect(root).toMatch(/background:\s*var\(--background\);/)
    expect(CSS).toMatch(/@media \(min-width: 600px\)\s*\{\s*#root\s*\{\s*box-shadow:\s*0 0 0 1px var\(--border\);/)
    const html = /\n {2}html\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(html).toMatch(/background:\s*var\(--background-outer\);/)
    expect(html).toMatch(/scrollbar-gutter:\s*stable;/)
    expect(html).toMatch(/scroll-padding-top:\s*calc\(var\(--header-now, var\(--header-h\)\) \+ 12px\);/)
    // With the inset of the phone's own bar, as the tab bar's height and every offset measured from it.
    expect(html).toMatch(
      /scroll-padding-bottom:\s*calc\(var\(--bar-h\) \+ var\(--row-h\) \+ 24px \+ env\(safe-area-inset-bottom\)\);/,
    )
    // The body paints nothing of its own and has no height of its own: the column does.
    const body = /\n {2}body\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(body).toMatch(/@apply text-foreground;/)
    expect(body).not.toMatch(/background|min-height/)
    // No `overflow` on the column (it would unstick the header and the pages' bars).
    expect(root).not.toMatch(/overflow/)
    // The browser's bars keep the colour of the column, which is all a phone shows.
    for (const theme of THEMES) expect(tokenValue('--background', theme)).toBe(THEME_COLOR[theme])
  })

  it('the bands kept free for what takes the focus follow what is really over the page', () => {
    const rules = new Map(
      [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => [
        (rule[1] ?? '').replace(/\s+/g, ' ').trim(),
        (rule[2] ?? '').replace(/\s+/g, ' ').trim(),
      ]),
    )
    const OWN_BAR = 'main :is([data-slot="sticky-actions"], [data-slot="page-bar"])'
    // Only the tab bar over the end of the page: what is right above it is in sight, and is not kept free (a tap on
    // a label there would re-centre the screen while its control takes the focus).
    expect(rules.get(`html:not(:has([data-slot="bottom-zone"][data-row], ${OWN_BAR}))`)).toBe(
      'scroll-padding-bottom: calc(var(--bar-h) + 12px + env(safe-area-inset-bottom));',
    )
    // The header and a page's own bar cannot be scrolled out of their band: with the focus in one, it is not kept.
    expect(rules.get('html:has(#root > header:focus-within)')).toBe('scroll-padding-top: 0;')
    expect(rules.get(`html:has(${OWN_BAR}:focus-within)`)).toBe('scroll-padding-bottom: 0;')
    expect([...rules.values()].filter((body) => /scroll-padding/.test(body))).toHaveLength(4)
    // What those selectors look for is what the components write.
    expect(read('app/AppShell.tsx')).toContain("data-row={hasRow ? '' : undefined}")
    expect(read('components/StickyActions.tsx')).toContain('data-slot="sticky-actions"')
    const owners = sources()
      .filter(([, text]) => text.includes('data-slot="page-bar"'))
      .map(([path]) => path)
    expect(owners.sort()).toEqual([
      'components/replay/ReplayViewer.tsx',
      'pages/jugar/GamePage.tsx',
      'pages/jugar/PuzzlePage.tsx',
    ])
    // Each of them is a bar over the end of the page: stuck or fixed right above the tab bar.
    for (const path of owners) {
      expect(read(path), path).toMatch(
        /data-slot="page-bar"\s+className="(?:sticky|fixed inset-x-0) bottom-\[calc\(var\(--bar-h\)\+/,
      )
    }
  })

  it('one h1 per screen: only the header writes it', () => {
    expect(
      sources()
        .filter(([, text]) => /<h1\b/.test(text))
        .map(([path]) => path),
    ).toEqual(['app/AppShell.tsx'])
    expect(read('app/AppShell.tsx').match(/<h1\b/g)).toHaveLength(1)
  })

  it('with the scrollbar’s room kept, the scroll lock of a dialog adds none', () => {
    expect(CSS).toMatch(/html body\[data-scroll-locked\]\s*\{\s*margin-right:\s*0 !important;\s*\}/)
  })

  it('nothing sets a smooth scroll on the page: the router’s resets would animate', () => {
    expect(CSS).not.toMatch(/scroll-behavior:\s*smooth/)
    expect(
      sources()
        .filter(([, text]) => /behavior: 'smooth'/.test(text))
        .map(([path]) => path),
    ).toEqual([])
    expect(read('components/replay/ReplayViewer.tsx')).toContain('behavior: scrollBehavior()')
    expect(read('app/TabBar.tsx')).toContain('behavior: scrollBehavior()')
  })

  it('the fixed row is not drawn under an open dialog or sheet, and the zone loses its fade', () => {
    // The names the kit gives to what it opens.
    expect(read('components/ui/dialog.tsx')).toContain('data-slot="dialog-content"')
    expect(read('components/ui/sheet.tsx')).toContain('data-slot="sheet-content"')
    const OPEN = ':root:has(:is([data-slot="dialog-content"], [data-slot="sheet-content"])[data-state="open"])'
    const rules = new Map(
      [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => [
        (rule[1] ?? '').replace(/\s+/g, ' ').trim(),
        (rule[2] ?? '').replace(/\s+/g, ' ').trim(),
      ]),
    )
    expect(rules.get(`${OPEN} [data-slot="fixed-row"]`)).toBe('display: none;')
    expect(rules.get(`${OPEN} [data-slot="bottom-zone"]`)).toBe('padding-top: 0; background: none;')
    // A select or a menu is not a dialog: nothing else hides the row.
    expect([...rules.keys()].filter((selector) => selector.includes('[data-slot="fixed-row"]'))).toHaveLength(1)
    expect(read('app/FixedRow.tsx')).toContain('data-slot="fixed-row"')
    expect(read('app/AppShell.tsx')).toContain('data-slot="bottom-zone"')
    // The fade is the zone's only while it holds a row.
    expect(CSS).toMatch(
      /\[data-slot="bottom-zone"\]\[data-row\]\s*\{\s*padding-top:\s*30px;\s*background:\s*linear-gradient\(/,
    )
  })

  it('the layers: header 20, bottom zone 30, and the page isolated under both', () => {
    const shell = read('app/AppShell.tsx')
    expect(shell).toContain('className="sticky top-0 z-20 bg-background"')
    expect(shell).toContain('className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-(--frame)"')
    expect(shell).toMatch(/'isolate px-4 pt-1\.5 outline-none'/)
    // The zone is centred with margins, never with a transform (it would re-anchor what is fixed inside it).
    expect(shell).not.toMatch(/-translate-x-1\/2/)
    // The kit's dialogs and sheets stay above everything of the frame.
    for (const file of ['dialog.tsx', 'sheet.tsx'])
      expect(read(`components/ui/${file}`), file).toContain('fixed inset-0')
  })

  it('a bottom sheet takes the column, centred', () => {
    const sheet = read('components/ui/sheet.tsx')
    for (const utility of ['inset-x-0', 'bottom-0', 'mx-auto', 'max-w-(--frame)']) {
      expect(sheet, utility).toContain(`data-[side=bottom]:${utility} `)
    }
  })

  it('no trace of the old frame: the 768 px column and the offsets of a 56 px bar', () => {
    const left = (pattern: RegExp) =>
      sources()
        .filter(([, text]) => pattern.test(text))
        .map(([path]) => path)
    expect(left(/\bmax-w-3xl\b/)).toEqual([])
    expect(left(/\bsticky bottom-20\b/)).toEqual([])
    expect(left(/\bbottom-(?:16|20)\b/)).toEqual([])
    expect(left(/\bpt-18\b/)).toEqual([])
    // What sticks or is fixed above the tab bar measures from the bar's variable.
    for (const file of ['components/StickyActions.tsx', 'components/replay/ReplayViewer.tsx']) {
      expect(read(file), file).toContain('sticky bottom-[calc(var(--bar-h)+8px+env(safe-area-inset-bottom))]')
    }
    for (const file of ['pages/jugar/GamePage.tsx', 'pages/jugar/PuzzlePage.tsx']) {
      expect(read(file), file).toContain(
        'fixed inset-x-0 bottom-[calc(var(--bar-h)+env(safe-area-inset-bottom))] z-30 mx-auto max-w-(--frame) ',
      )
      // The offset carries the safe-area inset: the bar does not add it again.
      expect(read(file), file).not.toMatch(/bottom-\[calc[^"]*pb-safe/)
    }
    // A game's bar holds up to four buttons, which need 373 px in a line: on a 360 px phone the line wraps, or
    // «Terminar turno» would end past the edge of the screen (the bar takes the column's width, never more).
    expect(read('pages/jugar/GamePage.tsx')).toMatch(
      /<div className="flex flex-wrap items-center gap-1\.5">\s*<Button type="button" variant="outline" size="sm" onClick=\{\(\) => setOptionsOpen\(true\)\}>/,
    )
  })

  it('the four bars a page keeps in reach are `StickyActions`, with the row’s look', () => {
    const bar = read('components/StickyActions.tsx')
    for (const utility of [
      'z-20',
      'h-(--row-h)',
      'rounded-[20px]',
      'border-input',
      'bg-row',
      'shadow-(--shadow-row)',
    ]) {
      expect(bar, utility).toContain(` ${utility} `)
    }
    const users = sources()
      .filter(([path, text]) => path !== 'components/StickyActions.tsx' && /<StickyActions\b/.test(text))
      .map(([path]) => path)
    expect(users.sort()).toEqual([
      'pages/coleccion/ImportPreviewPage.tsx',
      'pages/mazos/DeckEditorPage.tsx',
      'pages/mazos/DeckImportPage.tsx',
      'pages/partidas/QuickMatchForm.tsx',
    ])
    // The row itself has the same look: the box that the row and every drawing of it take (`ROW_BOX`).
    const look = read('app/RowAction.tsx')
    expect(look).toContain(
      'h-(--row-h) items-center gap-[6px] rounded-[20px] border border-input bg-row p-[5px] shadow-(--shadow-row)',
    )
    expect(read('app/FixedRow.tsx')).toContain("className={cn('pointer-events-auto mx-[12px] mb-[8px]', ROW_BOX)}")
  })

  it('a page that keeps its own bar has no action of the frame: no source declares one and draws `StickyActions`', () => {
    const declaring = sources()
      .filter(([path, text]) => path !== 'app/pageAction.tsx' && /\busePageAction\s*\(/.test(text))
      .map(([path]) => path)
    // The pages that tell the row something of its action: these, on purpose.
    expect(declaring.sort()).toEqual(['pages/coleccion/CollectionPage.tsx', 'pages/mazos/DeckDetailPage.tsx'])
    const both = sources()
      .filter(([, text]) => /\busePageAction\s*\(/.test(text) && /<StickyActions\b/.test(text))
      .map(([path]) => path)
    expect(both).toEqual([])
  })

  it('the column is a phone at every width: no viewport variant inside it', () => {
    // Tailwind's breakpoints follow the window. They stay only where the element is relative to the window.
    const found = sources()
      .flatMap(([path, text]) =>
        [
          // `max-md:`, `min-[600px]:` and `max-[480px]:` follow the window as much as `md:` does.
          ...text.matchAll(
            /(?<=^|[\s"'`])(?:[\w-]+(?:\[[^\]\s]*\])?:)*(?:(?:max-|min-)?(?:sm|md|lg|xl|2xl)|(?:min|max)-\[[^\]\s]*\]):[\w[(*-][^\s"'`]*/gm,
          ),
        ].map((match) => `${path} ${match[0]}`),
      )
      .sort()
    expect(found).toEqual([
      'components/GlobalSearch.tsx sm:top-12',
      'components/ui/alert.tsx md:text-pretty',
      'components/ui/dialog.tsx sm:flex-row',
      'components/ui/dialog.tsx sm:justify-end',
      'components/ui/dialog.tsx sm:max-w-sm',
      'components/ui/sheet.tsx data-[side=left]:sm:max-w-sm',
      'components/ui/sheet.tsx data-[side=right]:sm:max-w-sm',
    ])
  })

  describe.each(THEMES)('WCAG AA in the %s theme', (theme) => {
    const TEXT = 4.5
    const EDGE = 3

    it('the tab bar: a tab’s label on the bar, the lit one on the bar and on its pill', () => {
      const bar = read('app/TabBar.tsx')
      expect(bar).toContain('border-t bg-card ')
      expect(bar).toContain("lit ? 'font-bold text-foreground' : 'font-semibold text-foreground-3'")
      expect(bar).toContain("lit && 'bg-surface-3 shadow-[inset_0_1px_0_var(--edge)]'")
      expect(contrast('--foreground-3', '--card', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--foreground', '--card', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--foreground', '--surface-3', theme)).toBeGreaterThanOrEqual(TEXT)
    })

    it('the fixed row: a view on the row, the chosen view on its fill, the action, the row’s edge', () => {
      // The look of the row and of its action is in `RowAction.tsx`, for the row and for the gallery's drawings.
      const look = read('app/RowAction.tsx')
      expect(look).toMatch(/export const VIEW_TAB =\s*'[^']*\btext-foreground-2\b/)
      expect(look).toContain(
        "export const VIEW_CHOSEN_IN_ROW = 'bg-row-selected font-bold text-foreground shadow-[inset_0_0_0_1.5px_var(--input)]'",
      )
      expect(look).toMatch(/const ACTION =\s*'[^']*rounded-\[15px\] bg-primary [^']*\btext-primary-foreground\b/)
      // The chosen view of the views «arriba» is the row's own.
      expect(read('app/FixedRow.tsx')).toContain("'bg-primary font-bold text-primary-foreground'")
      expect(contrast('--foreground-2', '--row', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--foreground', '--row-selected', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--primary-foreground', '--primary', theme)).toBeGreaterThanOrEqual(TEXT)
      // The edge that tells the row from the page, and from its own fill.
      expect(contrast('--input', '--background', theme)).toBeGreaterThanOrEqual(EDGE)
      expect(contrast('--input', '--row', theme)).toBeGreaterThanOrEqual(EDGE)
    })

    it('the header: the title, the way to the Menú and its dot, the skip link', () => {
      const shell = read('app/AppShell.tsx')
      // 12 px, as D and as the kit's «Volver» next to it.
      expect(shell).toMatch(/rounded-lg text-foreground-2 hover:bg-muted hover:text-foreground /)
      expect(shell).toContain('rounded-full bg-warning ring-2 ring-background')
      expect(shell).toMatch(/rounded-lg bg-primary px-4 font-semibold text-primary-foreground focus:translate-y-0/)
      expect(shell).not.toContain('rounded-xl')
      expect(contrast('--foreground', '--background', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--foreground-2', '--background', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--foreground', '--muted', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--warning', '--background', theme)).toBeGreaterThanOrEqual(EDGE)
      expect(contrast('--primary-foreground', '--primary', theme)).toBeGreaterThanOrEqual(TEXT)
    })
  })
})

describe('how much the app moves', () => {
  const LEVEL = ['--dur-1', '--dur-2', '--dur-3', '--spring']
  const SUBTLE = block(':root[data-motion="subtle"]')
  const NONE = block(':root[data-motion="none"]')
  /** Every innermost rule of the stylesheet, selector → declarations (the last one wins, as in the cascade). */
  const rules = new Map(
    [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => [
      (rule[1] ?? '').replace(/\s+/g, ' ').trim(),
      (rule[2] ?? '').replace(/\s+/g, ' ').trim(),
    ]),
  )
  /** The body of `@layer base`, braces balanced. */
  const baseLayer = (() => {
    const start = CSS.indexOf('@layer base {')
    let depth = 0
    for (let at = CSS.indexOf('{', start); at < CSS.length; at++) {
      if (CSS[at] === '{') depth += 1
      if (CSS[at] === '}') depth -= 1
      if (depth === 0) return CSS.slice(start, at + 1)
    }
    throw new Error('no «@layer base» in src/index.css')
  })()

  it('has three levels, and each sets the three durations, with their unit, and the spring', () => {
    const level = (values: Map<string, string>) => LEVEL.map((name) => values.get(name))
    // «Expresivo» is the page as index.html leaves it: the values of :root.
    expect(level(DARK)).toEqual(['140ms', '280ms', '520ms', 'cubic-bezier(0.2, 1.45, 0.35, 1)'])
    expect(level(SUBTLE)).toEqual(['90ms', '150ms', '150ms', 'ease-out'])
    // With the unit: a bare 0 inside the `animation` shorthand is read as an iteration count.
    expect(level(NONE)).toEqual(['0ms', '0ms', '0ms', 'linear'])
    // A level changes nothing else, and the theme does not change the motion.
    expect([...SUBTLE.keys()]).toEqual(LEVEL)
    expect([...NONE.keys()]).toEqual(LEVEL)
    for (const name of LEVEL) expect(LIGHT.has(name), name).toBe(false)
    for (const values of [DARK, SUBTLE, NONE]) {
      for (const name of LEVEL.slice(0, 3)) expect(values.get(name), name).toMatch(/^\d+ms$/)
    }
    // No level is told apart by anything but the attribute public/look.js and src/lib/look.ts write.
    expect(CSS.match(/\[data-motion="[a-z]+"\]/g)?.every((level) => /"(full|subtle|none)"/.test(level))).toBe(true)
    expect(read('lib/look.ts')).toContain("setAttribute('data-motion', resolveMotion(look.motion))")
  })

  it('«Ninguno» stops everything, whoever wrote it, except a spinner', () => {
    const stop = [...rules].filter(([, body]) => /animation:\s*none !important/.test(body))
    expect(stop).toHaveLength(1)
    const [selector, body] = stop[0] as [string, string]
    expect(selector.split(/\s*,\s*/)).toEqual([
      ':root[data-motion="none"] *:not(.animate-spin)',
      ':root[data-motion="none"] *:not(.animate-spin)::before',
      ':root[data-motion="none"] *:not(.animate-spin)::after',
    ])
    expect(body).toBe('animation: none !important; transition: none !important; scroll-behavior: auto !important;')
    // Each `!important` of the stylesheet says why it is there.
    const important = CSS.match(/!important/g)?.length ?? 0
    expect(important).toBe(4)
    expect(
      RAW_CSS.match(/\/\* biome-ignore lint\/complexity\/noImportantStyles: [^*]+\*\/\s*[\w-]+:[^;]*!important;/g),
    ).toHaveLength(important)
    // What is spared is feedback (something is still working), and it is the class the spinners carry.
    expect(read('components/ListState.tsx')).toContain("'size-4 animate-spin'")
    expect(read('components/ui/sonner.tsx')).toContain('animate-spin')
  })

  it('a screen fades in once: opacity only, in the base layer, and never the loading rows', () => {
    // In the layer, so a utility of the page wins; outside it the rule would beat them all.
    expect(baseLayer).toMatch(
      /\n {2}main > :not\(\[aria-busy="true"\]\)\s*\{\s*animation:\s*page-in var\(--dur-2\) linear backwards;\s*\}/,
    )
    expect(CSS.replace(baseLayer, '')).not.toMatch(/animation:[^;]*page-in/)
    expect(CSS.match(/animation:[^;]*page-in/g)).toHaveLength(1)
    const frames = /@keyframes page-in\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? ''
    expect(frames.replace(/\s+/g, ' ').trim()).toBe('from { opacity: 0; }')
    // A transform would re-anchor the fixed bars of a game and of a puzzle while it runs.
    expect(frames).not.toMatch(/transform|translate|scale|filter/)
    for (const file of ['pages/jugar/GamePage.tsx', 'pages/jugar/PuzzlePage.tsx']) {
      expect(read(file), file).toMatch(/className="fixed inset-x-0 /)
    }
    // The loading rows are what React swaps for the page when the data arrives: the fade would start again.
    expect(read('components/ListState.tsx')).toMatch(/<output [^>]*aria-busy="true"/)
  })

  it('a dialog and a sheet, and their scrims, come in with --dur-2 and leave with --dur-1', () => {
    for (const file of ['dialog.tsx', 'sheet.tsx']) {
      // The scrim and the content: the two class lists of the file that are fixed to the window.
      const fixed = [...read(`components/ui/${file}`).matchAll(/'(fixed [^']*)'/g)].map((match) =>
        (match[1] ?? '').split(' '),
      )
      expect(fixed, file).toHaveLength(2)
      for (const classes of fixed) {
        expect(classes, file).toContain('duration-(--dur-2)')
        // Shorter on the way out: the page under a closing dialog cannot be tapped until it is gone.
        expect(classes, file).toContain('data-closed:duration-(--dur-1)')
        expect(
          classes.filter((name) => /(^|:)duration-\d/.test(name)),
          file,
        ).toEqual([])
        expect(classes, file).toContain('data-open:animate-in')
        expect(classes, file).toContain('data-closed:animate-out')
      }
    }
  })

  it('the tab that becomes lit pops with «Expresivo» only, and what is pressed follows the level', () => {
    expect(
      rules.get(':root[data-motion="full"] [data-slot="tab-bar"] [aria-current="page"] [data-slot="tab-pill"]'),
    ).toBe('animation: tab-pop var(--dur-3) var(--spring);')
    expect(CSS.match(/animation:[^;]*tab-pop/g)).toHaveLength(1)
    expect(read('app/TabBar.tsx')).toContain('data-slot="tab-pill"')
    const row = read('app/RowAction.tsx')
    expect(row).toMatch(/const ACTION =\s*'[^']*transition-transform duration-\(--dur-1\) [^']*active:scale-\[\.97\]/)
    expect(row).toMatch(/const VIEW_TAB =\s*'[^']*transition-colors duration-\(--dur-2\)/)
    expect(read('components/SegmentedRadio.tsx')).toContain(
      'transition-[background-color,color] duration-(--dur-2) ease-(--ease)',
    )
  })

  it('the board with «Ninguno» is the board of a system that reduces motion', () => {
    // The media query (the last rule of each selector) and the attribute say the same.
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.board-float\s*\{/)
    expect(rules.get('.board-float')).toBe('animation: none; opacity: 1;')
    expect(rules.get('.board-banner')).toBe('animation: none; opacity: 0;')
    expect(rules.get('.board-target, .board-glow, .board-fresh')).toBe('animation: none;')
    expect(rules.get(':root[data-motion="none"] .board-float')).toBe(rules.get('.board-float'))
    expect(rules.get(':root[data-motion="none"] .board-banner')).toBe(rules.get('.board-banner'))
    expect(rules.get(':root[data-motion="none"] :is(.board-target, .board-glow, .board-fresh)')).toBe(
      'animation: none;',
    )
  })

  describe.each(THEMES)('the choices of Menú → Aspecto in the %s theme', (theme) => {
    it('a segment on its track and the chosen one on its fill pass AA; the track has an edge', () => {
      const segments = read('components/SegmentedRadio.tsx')
      expect(segments).toContain('rounded-[14px] border border-input bg-surface-3 p-0.5')
      expect(segments).toMatch(/\btext-foreground-2\b[^"]*data-\[state=checked\]:bg-primary/)
      expect(segments).toContain('data-[state=checked]:text-primary-foreground')
      expect(contrast('--foreground-2', '--surface-3', theme)).toBeGreaterThanOrEqual(4.5)
      expect(contrast('--primary-foreground', '--primary', theme)).toBeGreaterThanOrEqual(4.5)
      for (const surface of ['--background', '--surface-3']) {
        expect(contrast('--input', surface, theme), surface).toBeGreaterThanOrEqual(3)
      }
      // The focus ring is drawn outside the segment, on the track.
      expect(segments).toContain('focus-visible:ring-2 focus-visible:ring-ring')
      expect(contrast('--ring', '--surface-3', theme)).toBeGreaterThanOrEqual(3)
    })
  })
})

describe('the fonts', () => {
  const FONTS = resolve(ROOT, 'src/assets/fonts')
  const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1] ?? '')
  const GENERIC = /(^|,\s*)(sans-serif|serif|monospace|system-ui)$/

  it('every file of an @font-face is a woff2 of the app, and every font file is used', () => {
    const urls = faces.flatMap((face) => [...face.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1] ?? ''))
    expect(urls).toHaveLength(4)
    for (const url of urls) {
      // Relative to src/index.css, so Vite emits the file with its hash; never another origin (the CSP: font-src 'self').
      expect(url).toMatch(/^\.\/assets\/fonts\/[\w-]+\.woff2$/)
      expect(existsSync(resolve(ROOT, 'src', url)), url).toBe(true)
    }
    expect(urls.map((url) => url.replace('./assets/fonts/', '')).sort()).toEqual(readdirSync(FONTS).sort())
    expect(CSS).not.toMatch(/https?:\/\//)
  })

  it('a late font swaps in, and the fallback faces are local', () => {
    const remote = faces.filter((face) => face.includes('url('))
    const local = faces.filter((face) => !face.includes('url('))
    for (const face of remote) expect(face).toMatch(/font-display:\s*swap/)
    expect(local).toHaveLength(2)
    for (const face of local) expect(face).toMatch(/src:\s*local\(/)
    // The four files: the display face at 500, 600 and 700, and the variable text face.
    expect(remote.map((face) => /font-weight:\s*([^;]+);/.exec(face)?.[1]).sort()).toEqual([
      '400 700',
      '500',
      '600',
      '700',
    ])
  })

  it('every font stack ends in a generic family', () => {
    const stacks = [...THEME_BLOCK].filter(([name]) => name.startsWith('--font-'))
    expect(stacks.map(([name]) => name).sort()).toEqual(['--font-heading', '--font-mono', '--font-sans'])
    for (const [name, stack] of stacks) expect(stack, name).toMatch(GENERIC)
    // Outside @font-face (where `font-family` names the face), a declared family is one of the stacks.
    const outside = CSS.replace(/@font-face\s*\{[^}]*\}/g, '')
    for (const [, family] of outside.matchAll(/font-family:\s*([^;]+);/g)) {
      expect(family).toMatch(/^var\(--font-(heading|sans|mono)\)$/)
    }
    expect(THEME_BLOCK.get('--font-heading')).toMatch(
      /^"Barlow Semi Condensed", "TCG Narrow Fallback", "TCG Wide Fallback"/,
    )
    expect(THEME_BLOCK.get('--font-sans')).toMatch(/^"Inter",/)
  })

  it('nothing is written under 13 px with `text-xs`', () => {
    expect(THEME_BLOCK.get('--text-xs')).toBe('0.8125rem')
    expect(THEME_BLOCK.has('--text-xs--line-height')).toBe(true)
  })

  it('the service worker precaches them, and the licence goes with the build', () => {
    const config = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8')
    expect(/globPatterns:\s*\[([^\]]*)\]/.exec(config)?.[1]).toMatch(/\{[^}]*\bwoff2\b[^}]*\}/)
    const licence = readFileSync(resolve(ROOT, 'public/licenses/fonts-ofl.txt'), 'utf8')
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(licence).toContain('Copyright 2017 The Barlow Project Authors')
    expect(licence).toContain('Copyright 2020 The Inter Project Authors')
    // The OFL text itself, from its first rule of dashes: the same body as the mock-up's copy (d/fuentes/LICENCIA.txt).
    expect(
      createHash('sha256')
        .update(licence.slice(licence.indexOf('-----')))
        .digest('hex'),
    ).toBe('8cd174da2eec82d3cc49ff8151a06380a95bee3d50896183124439ce5d5da4a1')
    // It opens as a file, not as the app: the service worker does not answer /licenses/ with index.html.
    expect(config).toMatch(/navigateFallbackDenylist:\s*\[[^\]]*\/\^\\\/licenses\\\/\//)
  })
})

describe('the type of the figures and of what goes around them', () => {
  /** The `type-*` utilities of the stylesheet, in the order they are written. */
  const ROLES = [...CSS.matchAll(/@utility (type-[\w-]+) \{/g)].map((match) => match[1] ?? '')
  const role = (name: string) => block(`@utility ${name}`)
  /** A size of the stylesheet in CSS pixels (a rem is 16 px: nothing changes the size of the root). */
  function pixels(value: string | undefined): number {
    const size = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(value ?? '')
    if (!size) throw new Error(`not a size in px or rem: ${value}`)
    return Number(size[1]) * (size[2] === 'rem' ? 16 : 1)
  }

  it('eight roles, each with its face, its size, its weight and a line height of its own', () => {
    expect(
      ROLES.map((name) => [
        name,
        role(name).get('font-family'),
        role(name).get('font-size'),
        role(name).get('font-weight'),
        role(name).get('line-height'),
      ]),
    ).toEqual([
      ['type-label', 'var(--font-heading)', '13px', '700', '1.2'],
      ['type-figure-28', 'var(--font-heading)', '28px', '700', '1'],
      ['type-figure-22', 'var(--font-heading)', '22px', '700', '1'],
      ['type-figure-17', 'var(--font-heading)', '17px', '700', '1.1'],
      ['type-figure-15', 'var(--font-heading)', '15px', '700', '1.1'],
      ['type-n', 'var(--font-heading)', '14px', '500', '1.15'],
      ['type-row', 'var(--font-heading)', '16px', '600', '1.15'],
      ['type-sub', 'var(--font-sans)', '14px', '400', '1.35'],
    ])
    // Each is written once: a second block of the same name would add to the first one.
    expect(new Set(ROLES).size).toBe(ROLES.length)
  })

  it('no figure is under 14 px, and the label, the smallest of them, is not under 13 px', () => {
    expect(ROLES.length).toBeGreaterThanOrEqual(8)
    for (const name of ROLES) {
      expect(pixels(role(name).get('font-size')), name).toBeGreaterThanOrEqual(name === 'type-label' ? 13 : 14)
    }
    expect(pixels(role('type-label').get('font-size'))).toBeGreaterThanOrEqual(13)
    // The helper reads both units, and nothing else.
    expect(pixels('0.875rem')).toBe(14)
    expect(pixels('13px')).toBe(13)
    expect(() => pixels('1.2em')).toThrow()
    expect(() => pixels(undefined)).toThrow()
  })

  it('a figure is named after its size, is bold and keeps its digits in columns', () => {
    const figures = ROLES.filter((name) => name.startsWith('type-figure-'))
    expect(figures).toHaveLength(4)
    for (const name of figures) {
      expect(pixels(role(name).get('font-size')), name).toBe(Number(name.slice('type-figure-'.length)))
      expect(pixels(role(name).get('font-size')), name).toBeGreaterThanOrEqual(14)
      expect(role(name).get('font-weight'), name).toBe('700')
      expect(role(name).get('font-variant-numeric'), name).toBe('tabular-nums')
      expect(role(name).get('font-family'), name).toBe('var(--font-heading)')
    }
    expect(pixels(role('type-n').get('font-size'))).toBeGreaterThanOrEqual(14)
  })

  it('every role writes its line height, without a unit and tighter than the body’s', () => {
    const body = /\n {2}body\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    const bodyLine = Number(/line-height:\s*([\d.]+);/.exec(body)?.[1])
    expect(bodyLine).toBe(1.45)
    for (const name of ROLES) {
      const line = role(name).get('line-height') ?? ''
      expect(line, name).toMatch(/^\d(?:\.\d+)?$/)
      expect(Number(line), name).toBeGreaterThanOrEqual(1)
      expect(Number(line), name).toBeLessThan(bodyLine)
    }
  })

  it('the label is in capitals with its letters spaced, and no role brings a colour: that is the piece’s', () => {
    expect(role('type-label').get('text-transform')).toBe('uppercase')
    expect(role('type-label').get('letter-spacing')).toBe('0.08em')
    for (const name of ROLES) {
      expect(
        [...role(name).keys()].filter((property) => /color|background|shadow/.test(property)),
        name,
      ).toEqual([])
    }
  })
})

describe('the seal of a source and the marks of a figure', () => {
  const seal = read('components/figures/SourceSeal.tsx')
  const marks = read('components/figures/Marks.tsx')
  /** Where a seal or a mark is drawn: the page, a card, the head of a table. */
  const SURFACES = ['--background', '--card', '--surface-2']

  it('the seal and the marks paint only with the tokens measured below', () => {
    // M is the card's colour on a fill of the text colour (or of the second one, quiet); T and B, the text colour on
    // the surface, with an edge of the second one. The marks: amber, and «sin datos» in the third text colour.
    expect(paints(seal)).toEqual({ text: ['card', 'foreground'], graphic: ['foreground', 'foreground-2'] })
    expect(paints(marks)).toEqual({ text: ['foreground-3'], graphic: ['warning'] })
    // The letter of a seal is 13 px: text, by the rule of 4.5:1.
    expect(seal).toContain('text-[13px]')
  })

  describe.each(THEMES)('WCAG AA in the %s theme', (theme) => {
    const TEXT = 4.5
    const GRAPHIC = 3

    it('M: its letter on the fill and on the quiet fill, and each fill against what it is drawn on', () => {
      expect(contrast('--card', '--foreground', theme)).toBeGreaterThanOrEqual(TEXT)
      expect(contrast('--card', '--foreground-2', theme)).toBeGreaterThanOrEqual(TEXT)
      for (const surface of SURFACES) {
        expect(contrast('--foreground', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
        expect(contrast('--foreground-2', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
      }
    })

    it('T and B: the letter as text, the outline and the dashes as a graphic, on every surface', () => {
      for (const surface of SURFACES) {
        expect(contrast('--foreground', surface, theme), surface).toBeGreaterThanOrEqual(TEXT)
        expect(contrast('--foreground-2', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
      }
    })

    it('the marks: the amber of «orientativo» and of ▲ as a graphic, «sin datos» as text', () => {
      for (const surface of SURFACES) {
        expect(contrast('--warning', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
        expect(contrast('--foreground-3', surface, theme), surface).toBeGreaterThanOrEqual(TEXT)
      }
    })
  })
})

describe('the small charts, the figure and the block of a source', () => {
  const charts = read('components/figures/MiniCharts.tsx')
  const bar = read('components/figures/IntervalBar.tsx')
  const value = read('components/figures/FigureValue.tsx')
  const block = read('components/figures/SourceBlock.tsx')
  const legend = read('components/figures/SourceLegend.tsx')
  /** Where a chart or a block is drawn: the page, a card, the second surface (a tinted cell, the head of a table). */
  const SURFACES = ['--background', '--card', '--surface-2']
  /** A token as it is seen over a translucent one, itself over an opaque surface: the point over the band. */
  const over = (ink: string, layer: string, surface: string, theme: Theme) =>
    ratio(colorOf(ink, theme), { rgb: seenOn(colorOf(layer, theme), colorOf(surface, theme)), alpha: 1 })

  it('the charts, the figure, the block and the legend paint only with the tokens measured below', () => {
    // Two tokens are not measured because they say nothing: the ring around a point takes the surface it is drawn on
    // (`var(--chart-surface, var(--card))`), and the line over a legend only separates it.
    const charted = ['band', 'card', 'foreground', 'foreground-3', 'track', 'warning']
    expect(paints(charts)).toEqual({
      text: [],
      graphic: [...charted, 'destructive', 'draw', 'foreground-2', 'input', 'success'].sort(),
    })
    expect(paints(bar)).toEqual({ text: ['foreground-2'], graphic: charted })
    expect(paints(value)).toEqual({ text: ['foreground', 'foreground-2', 'foreground-3'], graphic: [] })
    expect(paints(block)).toEqual({ text: ['foreground', 'foreground-2', 'foreground-3'], graphic: ['input'] })
    expect(paints(legend)).toEqual({ text: ['foreground-3'], graphic: ['border'] })
  })

  describe.each(THEMES)('WCAG AA in the %s theme', (theme) => {
    const TEXT = 4.5
    const GRAPHIC = 3

    it('the band of an interval is a graphic on the page, on a card and on the second surface', () => {
      for (const surface of SURFACES) {
        expect(contrast('--band', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
      }
    })

    it('the point, the tick and the mark of a reference, on each surface; the point, over the band too', () => {
      for (const surface of SURFACES) {
        expect(contrast('--foreground', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
        expect(contrast('--foreground-3', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
        expect(contrast('--warning', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
        expect(over('--foreground', '--band', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
      }
    })

    it('the track is a rail and not a mark: it is under 3:1, and nothing is read from it alone', () => {
      for (const surface of SURFACES) {
        // D's token, as it came: a line that can be seen and that says nothing by itself.
        expect(contrast('--track', surface, theme), surface).toBeLessThan(GRAPHIC)
        expect(contrast('--track', surface, theme), surface).toBeGreaterThan(1.25)
        // What is read on it passes: the fill of a bar against a maximum (the point and the band are above).
        expect(contrast('--foreground-2', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
      }
    })

    it('the bar of a record: each tone against what it is drawn on', () => {
      for (const surface of SURFACES) {
        for (const tone of ['--success', '--destructive', '--draw', '--foreground', '--foreground-3', '--input']) {
          expect(contrast(tone, surface, theme), `${tone} on ${surface}`).toBeGreaterThanOrEqual(GRAPHIC)
        }
      }
    })

    it('what a figure and a block write: the three text colours, on each surface', () => {
      for (const surface of SURFACES) {
        for (const text of ['--foreground', '--foreground-2', '--foreground-3']) {
          expect(contrast(text, surface, theme), `${text} on ${surface}`).toBeGreaterThanOrEqual(TEXT)
        }
      }
    })

    it('the dashed edge of a source that is not available, as a graphic', () => {
      for (const surface of SURFACES) {
        expect(contrast('--input', surface, theme), surface).toBeGreaterThanOrEqual(GRAPHIC)
      }
    })
  })

  it('the band has no room: a lighter surface in the dark theme and it is no longer a graphic', () => {
    // 3.02, 3.06 and 3.01 on the page, a card and the second surface. Pinned: a change of any of the four tokens
    // that takes one of these under 3:1 has to change the band with it.
    for (const surface of SURFACES) {
      expect(contrast('--band', surface, 'dark'), surface).toBeGreaterThanOrEqual(3)
      expect(contrast('--band', surface, 'dark'), surface).toBeLessThan(3.1)
    }
    expect(contrast('--band', '--card', 'dark')).toBeCloseTo(3.06, 2)
    expect(contrast('--band', '--surface-2', 'dark')).toBeCloseTo(3.01, 1)
    expect(contrast('--band', '--card', 'light')).toBeCloseTo(3.57, 2)
    expect(contrast('--band', '--surface-2', 'light')).toBeCloseTo(3.49, 2)
    // On the third surface it does not pass in the dark theme: an interval is not drawn there.
    expect(contrast('--band', '--surface-3', 'dark')).toBeLessThan(3)
    expect(contrast('--band', '--surface-3', 'light')).toBeGreaterThanOrEqual(3)
  })

  it('the track is the same thin rail in both themes, on every surface', () => {
    for (const theme of THEMES) {
      for (const surface of [...SURFACES, '--surface-3']) {
        const seen = contrast('--track', surface, theme)
        expect(seen, `${surface} ${theme}`).toBeGreaterThan(1.25)
        expect(seen, `${surface} ${theme}`).toBeLessThan(1.6)
      }
    }
    expect(contrast('--track', '--card', 'dark')).toBeCloseTo(1.47, 2)
    expect(contrast('--track', '--card', 'light')).toBeCloseTo(1.31, 2)
  })

  it('a victory and a defeat are told apart by their hue only: the bar never says a record alone', () => {
    // Side by side the two fills are 1.3:1 at most. The numbers are written beside the bar, or it takes a label.
    for (const theme of THEMES) {
      expect(ratio(colorOf('--success', theme), colorOf('--destructive', theme))).toBeLessThan(1.5)
    }
    expect(charts).toContain(
      "{...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}",
    )
    expect(charts).toContain('title={segment.label}')
  })
})
