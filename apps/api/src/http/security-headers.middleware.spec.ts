import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './security-headers.middleware.js'

describe('content security policy', () => {
  it('never allows eval, except on the pages of the deckgym replay viewer (D-014)', () => {
    expect(contentSecurityPolicy()).toContain("script-src 'self';")
    expect(contentSecurityPolicy()).not.toContain('unsafe-eval')
    expect(contentSecurityPolicy('abc')).toContain("script-src 'self' 'nonce-abc';")
    expect(contentSecurityPolicy(undefined, { allowEval: true })).toContain("script-src 'self' 'unsafe-eval';")
  })
})
