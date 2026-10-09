import { describe, expect, it } from 'vitest'
import { catalogSyncRequest } from './catalog-sync-args.js'

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
