import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './security-headers.middleware.js'

describe('content security policy', () => {
  it('never allows eval, except on the pages of the deckgym replay viewer (D-014)', () => {
    expect(contentSecurityPolicy()).toContain("script-src 'self' 'wasm-unsafe-eval';")
    expect(contentSecurityPolicy()).not.toContain("'unsafe-eval'")
    expect(contentSecurityPolicy('abc')).toContain("script-src 'self' 'nonce-abc' 'wasm-unsafe-eval';")
    expect(contentSecurityPolicy(undefined, { allowEval: true })).toContain(
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';",
    )
  })

  it('lets the engine of the browser compile WebAssembly (T-015)', () => {
    expect(contentSecurityPolicy()).toContain("'wasm-unsafe-eval'")
    expect(contentSecurityPolicy()).toContain("worker-src 'self'")
  })
})
