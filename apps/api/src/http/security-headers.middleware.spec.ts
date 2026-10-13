import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, ENGINE_WORKER_SCRIPT } from './security-headers.middleware.js'

describe('content security policy', () => {
  it('never allows eval, except on the pages of the deckgym replay viewer (D-014)', () => {
    expect(contentSecurityPolicy()).toContain("script-src 'self';")
    expect(contentSecurityPolicy()).not.toContain("'unsafe-eval'")
    expect(contentSecurityPolicy('abc')).toContain("script-src 'self' 'nonce-abc';")
    expect(contentSecurityPolicy(undefined, { allowEval: true })).toContain("script-src 'self' 'unsafe-eval';")
  })

  it('lets only the engine of the browser compile WebAssembly (T-015, review of #86)', () => {
    expect(contentSecurityPolicy()).not.toContain("'wasm-unsafe-eval'")
    expect(contentSecurityPolicy(undefined, { allowWasm: true })).toContain("script-src 'self' 'wasm-unsafe-eval';")
    expect(contentSecurityPolicy()).toContain("worker-src 'self'")
    expect(ENGINE_WORKER_SCRIPT.test('/assets/engine.worker-ByOFcqr-.js')).toBe(true)
    for (const other of [
      '/assets/index-ByOFcqr-.js',
      '/assets/engine.worker-ByOFcqr-.js.map',
      '/engine/engine-0123456789ab.js',
      '/x/assets/engine.worker-abc.js',
      '/assets/engine.worker-a/b.js',
    ]) {
      expect(ENGINE_WORKER_SCRIPT.test(other)).toBe(false)
    }
  })
})
