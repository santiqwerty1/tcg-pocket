// The theme is CSS, and vitest runs without it (`css: false`): this reads src/index.css as text instead. It checks
// that every colour utility has a value in the two themes, that the pairs the app writes text with pass WCAG AA, and
// that the fonts are files of the app that the service worker keeps.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_COLOR } from '@/lib/look'

// The tests run from apps/web (jsdom's import.meta.url is not a file URL).
const ROOT = process.cwd()
const CSS = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const THEMES = ['dark', 'light'] as const
type Theme = (typeof THEMES)[number]
const SRC = resolve(ROOT, 'src')
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8')

/** Every source of the app that is not a test, as [path from src, text]. */
function sources(dir = SRC): [string, string][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): [string, string][] => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [[relative(SRC, path), readFileSync(path, 'utf8')]]
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
      for (const text of ['--foreground', '--muted-foreground', '--destructive', '--success', '--warning']) {
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
