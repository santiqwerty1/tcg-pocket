/**
 * H-008 (Fase 36): the closed lists the app copies by hand from @tcg/domain have to stay equal to the domain's — the
 * domain lets a value through the catalog sync and the app would then refuse every screen with that card.
 */
import { describe, expect, it } from 'vitest'
import {
  RARITIES as DOMAIN_RARITIES,
  SELECTABLE_ENERGIES as DOMAIN_SELECTABLE,
  ENERGY_TYPES,
} from '../../../../packages/domain/src/catalog/types'
import { DEFAULT_BOT as DOMAIN_DEFAULT_BOT } from '../../../../packages/domain/src/simulation/jobs'
import { DEFAULT_BOT } from '../lib/simulation'
import { cardTypeSchema, energyTypeSchema, evolutionTypeSchema, RARITIES, SELECTABLE_ENERGIES } from './schemas'

describe('the app’s copies of the domain lists (H-008)', () => {
  it('match the domain exactly', () => {
    expect([...SELECTABLE_ENERGIES]).toEqual([...DOMAIN_SELECTABLE])
    expect([...energyTypeSchema.options].sort()).toEqual([...ENERGY_TYPES].sort())
    expect([...RARITIES]).toEqual([...DOMAIN_RARITIES])
    expect([...cardTypeSchema.options]).toEqual(['pokemon', 'trainer'])
    expect([...evolutionTypeSchema.options]).toEqual([
      'basic',
      'stage1',
      'stage2',
      'supporter',
      'item',
      'tool',
      'stadium',
    ])
  })

  it('the bot by default is the domain’s (D-029: g2 since 23/10/2026)', () => {
    expect(DEFAULT_BOT).toBe(DOMAIN_DEFAULT_BOT)
    expect(DEFAULT_BOT).toBe('g2')
  })
})
