import { describe, expect, it } from 'vitest'
import {
  canBatch,
  canPlayFairBots,
  canPlayPerGame,
  ENGINE_FEATURES,
  hasEngineFeature,
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
    expect(ENGINE_FEATURES).toEqual(['perGame', 'batch', 'fairBots'])
    expect(canBatch({ version: '0.2.7', engineFeatures: ['perGame', 'batch'] })).toBe(true)
    expect(canBatch({ version: '0.2.7', cliVersion: '0.9.0' })).toBe(false)
    expect(canPlayFairBots({ engineFeatures: ['fairBots'] })).toBe(true)
    expect(canPlayFairBots({ cliVersion: '0.2.1' })).toBe(false)
    expect(hasEngineFeature({ engineFeatures: null }, 'perGame')).toBe(false)
  })
})
