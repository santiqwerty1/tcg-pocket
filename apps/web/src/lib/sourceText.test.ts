// Phone review (13/10/2026): a «48 %» written by hand in a screen breaks as «48⏎%» on a narrow line, and Testing
// Library's queries cannot see it (they read a no-break space as a plain one). This reads the screens' source instead.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The tests run from apps/web (jsdom's import.meta.url is not a file URL).
const SRC = resolve(process.cwd(), 'src')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** The code of a file without its block comments (kept as blank lines, so the line numbers hold). */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))

describe('the screens’ source', () => {
  it('writes no «N %» or «IC 95» with a plain space, and no line of JSX text starts with «%»', () => {
    const found: string[] = []
    for (const file of sources(SRC)) {
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, at) => {
          if (line.trim().startsWith('//')) return
          // «${n} %», «{n} %», «95 %», a JSX line break before «%», «IC 95».
          if (/[0-9}] %/.test(line) || /^\s*%/.test(line) || /IC 95/.test(line)) {
            found.push(`${relative(SRC, file)}:${at + 1}`)
          }
        })
    }
    expect(found).toEqual([])
  })

  it('writes no «n 47» by hand: the short sample comes from `formatSampleShort`', () => {
    // The same mistake that «N %» was: «n {games}» in a screen breaks as «n⏎47» on a narrow cell and writes 14179
    // without its point. The letter alone (not the end of «con» or «en»), a space of any kind, and then a digit or
    // what a value is written with; or a string that ends in «n » and is added to the number, or a space of JSX.
    const SHORT_SAMPLE =
      /(?<![\p{L}\p{N}_$])n(?:(?: |&nbsp;|\\u00a0|\u00a0)(?:\d|\$?\{|['"`]\s*\+)|\{\s*['"`](?: |\\u00a0|\u00a0)['"`]\s*\})/u
    // In JSX, in a template (with the space as it is or written as its escape) and with the number itself; added to
    // a string, and with the space of JSX between the letter and the number.
    for (const written of [
      'n {games}',
      'n&nbsp;{games}',
      `n \${games}`,
      `n\\u00a0\${games}`,
      'n 47',
      'n\u00a047',
      "{'n ' + formatCount(games)}",
      '{"n\u00a0" + games}',
      "n{' '}{formatCount(games)}",
      'n{" "}{games}',
    ]) {
      expect(SHORT_SAMPLE.test(written), written).toBe(true)
    }
    for (const other of [
      'en {days} días',
      'con {count} cartas',
      'un 5',
      `n = \${games}`,
      'n = 47',
      'return n }',
      "{'en ' + days}",
      "en{' '}{days}",
      "n{' = '}{games}",
    ]) {
      expect(SHORT_SAMPLE.test(other), other).toBe(false)
    }
    const found: string[] = []
    for (const file of sources(SRC)) {
      const path = relative(SRC, file).split(sep).join('/')
      // The helper itself is the one place that writes it.
      if (path === 'lib/matches.ts') continue
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, at) => {
          if (line.trim().startsWith('//')) return
          if (SHORT_SAMPLE.test(line)) found.push(`${path}:${at + 1}`)
        })
    }
    expect(found).toEqual([])
    expect(readFileSync(resolve(SRC, 'lib/matches.ts'), 'utf8')).toMatch(/return `n\\u00a0\$\{formatNumber\(games\)\}`/)
  })

  it('sends nobody to «Más → …»: that screen is the Menú now', () => {
    // Texts and comments alike: both name the place a reader will look for.
    expect(
      sources(SRC)
        .filter((file) => /Más\s*→/.test(readFileSync(file, 'utf8')))
        .map((file) => relative(SRC, file)),
    ).toEqual([])
  })
})
