import type { Request, Response } from 'express'
import { describe, expect, it } from 'vitest'
import type { Env } from '../config/env.js'
import {
  contentSecurityPolicy,
  ENGINE_WORKER_SCRIPT,
  SecurityHeadersMiddleware,
} from './security-headers.middleware.js'

/** The policy the middleware sets on a response to `url`. */
function policyFor(url: string): string {
  const headers = new Map<string, string>()
  const res = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as Response
  new SecurityHeadersMiddleware({ cookieSecure: false } as Env).use({ originalUrl: url } as Request, res, () => {})
  return headers.get('Content-Security-Policy') ?? ''
}

describe('security headers middleware', () => {
  it('gives only the response of the engine worker the right to compile WebAssembly (review of #86)', () => {
    expect(policyFor('/assets/engine.worker-ByOFcqr-.js')).toContain("'wasm-unsafe-eval'")
    expect(policyFor('/assets/engine.worker-ByOFcqr-.js?v=1')).toContain("'wasm-unsafe-eval'")
    for (const url of ['/', '/jugar/3', '/assets/index-ByOFcqr-.js', '/engine/engine-0123456789ab.js', '/viewer/']) {
      expect(policyFor(url), url).not.toContain("'wasm-unsafe-eval'")
    }
    expect(policyFor('/viewer/index.html')).toContain("'unsafe-eval'")
  })
})

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
