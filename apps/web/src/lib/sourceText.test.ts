// Phone review (13/10/2026): a «48 %» written by hand in a screen breaks as «48⏎%» on a narrow line, and Testing
// Library's queries cannot see it (they read a no-break space as a plain one). This reads the screens' source instead.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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
})
