import { describe, expect, it } from 'vitest'
import {
  canBatch,
  canPlayEtBot,
  canPlayFairBots,
  canPlayGBots,
  canPlayPerGame,
  ENGINE_FEATURES,
  gamesRevOf,
  hasEngineFeature,
  saidGamesRev,
  versionAtLeast,
} from '../../src/simulation/index.js'

describe('what a worker can play', () => {
  it('versions are compared as numbers; text that is not a version counts as 0.0.0', () => {
    expect(versionAtLeast('0.2.10', '0.2.2')).toBe(true)
    expect(versionAtLeast('0.10.0', '0.2.0')).toBe(true)
    expect(versionAtLeast('0.2.4', '0.2.5')).toBe(false)
    expect(versionAtLeast('0.2.5', '0.2.5')).toBe(true)
    expect(versionAtLeast('0.3.0-dev', '0.2.5')).toBe(true)
    expect(versionAtLeast(undefined, '0.0.1')).toBe(false)
    expect(versionAtLeast('dev', '0.0.0')).toBe(true)
  })

  it('perGame: a worker from 0.2.5 on and an engine with the feature, or engine-cli 0.2.0 before features', () => {
    expect(canPlayPerGame({ version: '0.2.6', cliVersion: '0.2.1', engineFeatures: ['perGame'] })).toBe(true)
    // An engine of #8 (0.2.0, no features list) behind a worker of 0.2.5 or 0.2.6.
    expect(canPlayPerGame({ version: '0.2.5', cliVersion: '0.2.0' })).toBe(true)
    expect(canPlayPerGame({ version: '0.2.6', cliVersion: '0.2.0', engineFeatures: [] })).toBe(true)
    // An old worker drops the flag; an old engine ignores it; an engine that lists features without it lacks it.
    expect(canPlayPerGame({ version: '0.2.4', cliVersion: '0.2.1', engineFeatures: ['perGame'] })).toBe(false)
    expect(canPlayPerGame({ version: '0.2.5', cliVersion: '0.1.0' })).toBe(false)
    expect(canPlayPerGame({ version: '0.2.6', cliVersion: '0.9.0', engineFeatures: ['batch'] })).toBe(false)
    expect(canPlayPerGame({})).toBe(false)
  })

  it('batch and the f bots count only when the engine lists them', () => {
    expect(ENGINE_FEATURES).toEqual(['perGame', 'batch', 'fairBots', 'etBot', 'gBots'])
    expect(canBatch({ version: '0.2.7', engineFeatures: ['perGame', 'batch'] })).toBe(true)
    expect(canBatch({ version: '0.2.7', cliVersion: '0.9.0' })).toBe(false)
    expect(canPlayFairBots({ engineFeatures: ['fairBots'] })).toBe(true)
    expect(canPlayFairBots({ cliVersion: '0.2.1' })).toBe(false)
    // H-051: «et» only with an engine that says it can (engine-cli 0.3.5 on).
    expect(canPlayEtBot({ engineFeatures: ['perGame', 'batch', 'fairBots', 'etBot'] })).toBe(true)
    expect(canPlayEtBot({ engineFeatures: ['perGame', 'batch', 'fairBots'] })).toBe(false)
    expect(canPlayEtBot({ cliVersion: '0.3.5' })).toBe(false)
    expect(hasEngineFeature({ engineFeatures: null }, 'perGame')).toBe(false)
  })

  it('the g bots need «gBots» and the g of engine-cli 0.3.16, not an earlier one (T-021)', () => {
    const features = ['perGame', 'batch', 'fairBots', 'etBot', 'gBots']
    expect(canPlayGBots({ engineFeatures: features, cliVersion: '0.3.16' })).toBe(true)
    expect(canPlayGBots({ engineFeatures: features, cliVersion: '0.3.20' })).toBe(true)
    // engine-cli 0.3.13–0.3.15 list «gBots» with an earlier g: their games and these would mix in one job.
    expect(canPlayGBots({ engineFeatures: features, cliVersion: '0.3.15' })).toBe(false)
    expect(canPlayGBots({ engineFeatures: features })).toBe(false)
    expect(canPlayGBots({ engineFeatures: ['perGame', 'batch', 'fairBots', 'etBot'], cliVersion: '0.3.16' })).toBe(
      false,
    )
  })
})

describe('saidGamesRev (review of #68)', () => {
  it('what the engine said, its version otherwise, and nothing when it said neither', () => {
    expect(saidGamesRev({ gamesRev: 2 })).toBe(2)
    expect(saidGamesRev({ cliVersion: '0.3.5' })).toBe(1)
    expect(saidGamesRev({ cliVersion: '0.3.2' })).toBe(0)
    expect(saidGamesRev({})).toBeNull()
    expect(saidGamesRev({ gamesRev: null, cliVersion: null })).toBeNull()
  })
})

describe('gamesRevOf (phase 42)', () => {
  it('is what the engine says, or 1 from engine-cli 0.3.3 on and 0 before', () => {
    expect(gamesRevOf({ gamesRev: 2, cliVersion: '0.3.6' })).toBe(2)
    expect(gamesRevOf({ cliVersion: '0.3.4' })).toBe(1)
    expect(gamesRevOf({ cliVersion: '0.3.4+e75c2df7116106aa' })).toBe(1)
    expect(gamesRevOf({ cliVersion: '0.3.3' })).toBe(1)
    expect(gamesRevOf({ cliVersion: '0.3.2' })).toBe(0)
    expect(gamesRevOf({})).toBe(0)
    expect(gamesRevOf({ gamesRev: -1, cliVersion: '0.3.4' })).toBe(1)
  })
})
