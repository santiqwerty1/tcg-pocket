import { vi } from 'vitest'

export interface FakeCall {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

type Answer = unknown | ((call: FakeCall) => unknown)

/**
 * A `fetch` stub keyed by «METHOD /path?query» or, failing that, «METHOD /path». Unknown routes answer 503 with the API's error shape, which the
 * pages show as an error state, so a screen test only lists the calls it cares about.
 */
export function fakeApi(routes: Record<string, Answer>) {
  const calls: FakeCall[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://app')
    const method = (init?.method ?? 'GET').toUpperCase()
    const call: FakeCall = { method, path: url.pathname, query: url.searchParams, body: init?.body }
    calls.push(call)
    const answer = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`]
    if (answer === undefined) {
      return new Response(JSON.stringify({ error: { code: 'offline', message: 'sin API' } }), { status: 503 })
    }
    const value = typeof answer === 'function' ? (answer as (call: FakeCall) => unknown)(call) : answer
    // A Response is answered as is (an error status, e.g. a 409).
    if (value instanceof Response) return value
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}
