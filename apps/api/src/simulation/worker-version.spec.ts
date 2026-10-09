import { describe, expect, it } from 'vitest'
import { versionAtLeast } from './worker-version.js'

describe('worker versions (H-002)', () => {
  it('compares as numbers, not as text', () => {
    expect(versionAtLeast('0.2.10', '0.2.2')).toBe(true)
    expect(versionAtLeast('0.10.0', '0.2.0')).toBe(true)
    expect(versionAtLeast('1.0.0', '0.2.1')).toBe(true)
    expect(versionAtLeast('0.2.2', '0.2.2')).toBe(true)
    expect(versionAtLeast('0.2.1', '0.2.2')).toBe(false)
    expect(versionAtLeast('0.1.99', '0.2.0')).toBe(false)
  })

  it('reads a suffix and treats anything else as 0.0.0', () => {
    expect(versionAtLeast('0.2.3-dev', '0.2.2')).toBe(true)
    expect(versionAtLeast(null, '0.2.0')).toBe(false)
    expect(versionAtLeast(undefined, '0.2.0')).toBe(false)
    expect(versionAtLeast('nueva', '0.2.0')).toBe(false)
    expect(versionAtLeast('0.2', '0.2.0')).toBe(false)
  })
})
