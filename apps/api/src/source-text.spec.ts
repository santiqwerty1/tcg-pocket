// The texts the server sends (alerts, notes, errors, MCP) and its comments name screens of the app. «Más» became the
// Menú, and Simulación and «Jugar contra un bot» are views of Pruebas: this reads the sources so none goes back.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const API = join(import.meta.dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('the server’s source', () => {
  it('sends nobody to «Más → …»: that screen is the Menú now', () => {
    // Texts and comments alike, the e2e tests and the README too: all name the place a reader will look for.
    const files = [...sources(join(API, 'src')), ...sources(join(API, 'test')), join(API, 'README.md')]
    expect(files.length).toBeGreaterThan(100)
    expect(
      files
        // This file names the old text in its own title.
        .filter((file) => file !== import.meta.filename && /Más\s*→/.test(readFileSync(file, 'utf8')))
        .map((file) => relative(API, file)),
    ).toEqual([])
  })
})
