import { describe, expect, it } from 'vitest'
import { catalogSyncOrigins, catalogSyncRequest, describeSyncRequest } from './catalog-sync-args.js'

const PINS = { catalogCommit: 'a'.repeat(40), engineRev: 'e'.repeat(40) }
const LOADED = 'b'.repeat(40)

describe('catalog:sync arguments (Fase 40)', () => {
  it('without --commit: the loaded commit, never back to the configured pin; guarded', () => {
    expect(catalogSyncRequest({ fromFixtures: false, confirm: false }, PINS, LOADED)).toEqual({
      trackerCommit: LOADED,
      engineRev: PINS.engineRev,
      source: 'github',
      guard: true,
      confirm: false,
    })
  })

  it('before the first sync: the configured pin', () => {
    expect(catalogSyncRequest({ fromFixtures: true, confirm: false }, PINS, null)).toMatchObject({
      trackerCommit: PINS.catalogCommit,
      source: 'fixtures',
    })
  })

  it('--commit, --engine-rev and --confirm as given', () => {
    const commit = 'c'.repeat(40)
    const engineRev = 'd'.repeat(40)
    expect(catalogSyncRequest({ commit, engineRev, fromFixtures: false, confirm: true }, PINS, LOADED)).toMatchObject({
      trackerCommit: commit,
      engineRev,
      guard: true,
      confirm: true,
    })
  })
})

describe('catalog:sync says what it will use (19/10/2026)', () => {
  const commit = 'c'.repeat(40)
  const engineRev = 'd'.repeat(40)

  it('where each sha comes from', () => {
    expect(catalogSyncOrigins({ fromFixtures: false, confirm: false }, LOADED, false)).toEqual({
      trackerCommit: 'loaded',
      engineRev: 'default',
    })
    expect(catalogSyncOrigins({ fromFixtures: false, confirm: false }, null, true)).toEqual({
      trackerCommit: 'pin',
      engineRev: 'env',
    })
    expect(catalogSyncOrigins({ commit, engineRev, fromFixtures: false, confirm: false }, LOADED, true)).toEqual({
      trackerCommit: 'flag',
      engineRev: 'flag',
    })
  })

  it('the line names the build, both short shas and their origins', () => {
    const args = { fromFixtures: false, confirm: false }
    const request = catalogSyncRequest(args, PINS, LOADED)
    expect(describeSyncRequest(request, catalogSyncOrigins(args, LOADED, false), '1.0.0')).toBe(
      "catalog:sync 1.0.0: tracker bbbbbbb (the loaded catalog), engine eeeeeee (this build's DEFAULT_ENGINE_REV)",
    )
    expect(
      describeSyncRequest(catalogSyncRequest(args, PINS, null), catalogSyncOrigins(args, null, true), '1.0.0'),
    ).toBe('catalog:sync 1.0.0: tracker aaaaaaa (CATALOG_COMMIT), engine eeeeeee (ENGINE_REV in the environment)')
    const flags = { commit, engineRev, fromFixtures: false, confirm: true }
    expect(
      describeSyncRequest(catalogSyncRequest(flags, PINS, LOADED), catalogSyncOrigins(flags, LOADED, true), 'abc'),
    ).toBe('catalog:sync abc: tracker ccccccc (--commit), engine ddddddd (--engine-rev)')
  })
})
