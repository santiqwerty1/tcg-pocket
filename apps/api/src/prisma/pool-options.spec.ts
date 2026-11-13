import { describe, expect, it } from 'vitest'
import { poolOptions } from './pool-options.js'

describe('poolOptions', () => {
  it('keeps one connection for good and the others a minute idle, so bursts every 15–20 s reuse them', () => {
    expect(poolOptions('postgresql://u:p@127.0.0.1:5433/tcg')).toEqual({
      connectionString: 'postgresql://u:p@127.0.0.1:5433/tcg',
      max: 8,
      min: 1,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 15_000,
    })
  })
})
