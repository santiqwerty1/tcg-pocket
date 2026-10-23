import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogInputError } from '@tcg/domain'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIXTURES_DIR,
  ENGINE_PATH,
  type FetchLike,
  FIXTURE_PATHS,
  fetchCatalogSources,
  TRACKER_PATHS,
} from './catalog-sources.js'

const PINS = { trackerCommit: 'a'.repeat(40), engineRev: 'b'.repeat(40) }
const ENGINE = [{ Pokemon: { id: 'A1 001', name: 'Bulbasaur', stage: 0, hp: 70, energy_type: 'Grass', rarity: '◊' } }]

/** The tracker's files from the fixtures, with some replaced; missions and the image manifest answer 404. */
function fakeFetch(
  replace: Partial<Record<keyof typeof TRACKER_PATHS, string>> = {},
  engine: unknown = ENGINE,
): FetchLike {
  const byPath = new Map<string, string>()
  for (const [key, path] of Object.entries(TRACKER_PATHS) as [keyof typeof TRACKER_PATHS, string][]) {
    byPath.set(path, replace[key] ?? readFileSync(join(DEFAULT_FIXTURES_DIR, FIXTURE_PATHS[key]), 'utf8'))
  }
  return async (url) => {
    const text = url.endsWith(`/${ENGINE_PATH}`)
      ? JSON.stringify(engine)
      : [...byPath].find(([path]) => url.endsWith(`/${path}`))?.[1]
    return text === undefined
      ? { ok: false, status: 404, text: async () => '' }
      : { ok: true, status: 200, text: async () => text }
  }
}

describe('fetchCatalogSources: data the catalog cannot read is a CatalogInputError (422 in the preview)', () => {
  it('reads the fixtures through the fake download', async () => {
    const sources = await fetchCatalogSources(PINS, fakeFetch())
    expect(sources.input.engineCards).toEqual([expect.objectContaining({ id: 'A1 001', energyType: 'Grass' })])
  })

  it('a types/index.ts without expansionIds, read for the missions before the build (Codex on #151)', async () => {
    const error = await fetchCatalogSources(
      PINS,
      fakeFetch({ typesIndex: 'export const other = [] as const\n' }),
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CatalogInputError)
    expect((error as Error).message).toMatch(
      /^types\/index\.ts: expansionIds: declaration 'export const expansionIds' not found/,
    )
  })

  it('a translation or a locale table that is not JSON names the file', async () => {
    const translation = await fetchCatalogSources(PINS, fakeFetch({ pokemonTranslations: '{ nope' })).catch(
      (caught: unknown) => caught,
    )
    expect(translation).toBeInstanceOf(CatalogInputError)
    expect((translation as Error).message).toContain(`${TRACKER_PATHS.pokemonTranslations}: invalid JSON`)
    const locale = await fetchCatalogSources(PINS, fakeFetch({ esSets: '[' })).catch((caught: unknown) => caught)
    expect(locale).toBeInstanceOf(CatalogInputError)
    expect((locale as Error).message).toContain(`${TRACKER_PATHS.esSets}: invalid JSON`)
  })

  it('an engine type outside its list names deckgym and the card', async () => {
    const engine = [{ Pokemon: { ...ENGINE[0]?.Pokemon, energy_type: 'Fire', energy_types: ['Grass'] } }]
    const error = await fetchCatalogSources(PINS, fakeFetch({}, engine)).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CatalogInputError)
    expect((error as Error).message).toBe('deckgym database.json: A1 001: energy_type Fire is not in energy_types')
  })
})
