import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { isStream } from '../app.js'
import { gunzipJson } from './gunzip.js'

describe('H-015: inflating with a ceiling, and what is never compressed', () => {
  it('reads a gzipped JSON and refuses one that inflates past the ceiling', () => {
    expect(gunzipJson(gzipSync(Buffer.from(JSON.stringify({ steps: [1, 2] }))))).toEqual({ steps: [1, 2] })
    // 2 MB of zeros gzip to ~2 KB: past a 1 MB ceiling it throws instead of inflating it all.
    const bomb = gzipSync(Buffer.alloc(2 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(10_000)
    expect(() => gunzipJson(bomb, 1024 * 1024)).toThrow(RangeError)
  })

  it('server-sent events and the MCP endpoint are streams', () => {
    expect(isStream({ path: '/api/play/12/events', headers: {} })).toBe(true)
    expect(isStream({ path: '/api/simulations/3/events', headers: {} })).toBe(true)
    expect(isStream({ path: '/api/mcp', headers: {} })).toBe(true)
    expect(isStream({ path: '/api/anything', headers: { accept: 'text/event-stream' } })).toBe(true)
    expect(isStream({ path: '/api/decks', headers: { accept: 'application/json' } })).toBe(false)
  })
})
