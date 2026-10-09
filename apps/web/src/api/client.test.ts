import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError, buildUrl, request, setUnauthenticatedHandler } from './client'
import { _resetForTests, clearClientCaches } from './session'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('buildUrl', () => {
  it('drops empty and undefined params and encodes the rest', () => {
    expect(buildUrl('/api/cards', { q: 'Mega Mawile', lang: undefined, limit: 20, missingOnly: '' })).toBe(
      '/api/cards?q=Mega+Mawile&limit=20',
    )
    expect(buildUrl('/api/decks')).toBe('/api/decks')
  })
})

describe('request', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const onUnauthenticated = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    onUnauthenticated.mockReset()
    setUnauthenticatedHandler(onUnauthenticated)
    _resetForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses JSON and validates it with the schema', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [{ id: 'B2-113' }] }))
    const data = await request('/api/x', { schema: z.object({ items: z.array(z.object({ id: z.string() })) }) })
    expect(data.items[0]?.id).toBe('B2-113')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/x')
    expect(init.credentials).toBe('same-origin')
  })

  it('maps the contract error shape to ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'built_in_game_limit', message: 'Ya tenés 25 mazos armados.', details: { limit: 25 } } },
        409,
      ),
    )
    const error = await request('/api/decks/1', { method: 'PATCH', body: { builtInGame: true } }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(409)
    expect(apiError.code).toBe('built_in_game_limit')
    expect(apiError.message).toBe('Ya tenés 25 mazos armados.')
    expect(apiError.details).toEqual({ limit: 25 })
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it("maps Nest's default error body too", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ statusCode: 400, message: ['name must not be empty'], error: 'Bad Request' }, 400),
    )
    const error = (await request('/api/decks', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('bad_request')
    expect(error.message).toBe('name must not be empty')
  })

  it('on 401 runs the unauthenticated handler and throws', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'unauthenticated', message: 'Necesitás iniciar sesión.' } }, 401),
    )
    const error = (await request('/api/auth/me').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('unauthenticated')
    expect(error.status).toBe(401)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it('returns undefined on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(request('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('sends JSON bodies and leaves FormData alone', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await request('/api/a', { method: 'POST', body: { a: 1 } })
    const [, jsonInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(jsonInit.body).toBe('{"a":1}')
    expect((jsonInit.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    const form = new FormData()
    form.append('file', new Blob(['Id,CardName']), 'x.csv')
    await request('/api/b', { method: 'POST', body: form })
    const [, formInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(formInit.body).toBe(form)
    expect((formInit.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('rejects responses that do not match the schema', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: 'nope' }))
    const error = (await request('/api/x', { schema: z.object({ items: z.array(z.string()) }) }).catch(
      (e: unknown) => e,
    )) as ApiError
    expect(error.code).toBe('invalid_response')
    expect(error.message).toContain('/api/x')
    expect(error.message).toContain('items')
  })

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const error = (await request('/api/x').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('network')
    expect(error.status).toBe(0)
  })
})

describe('clearClientCaches', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes every cache and unregisters every service worker', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: async () => ['workbox-precache-v2', 'other'],
      delete: async (key: string) => {
        deleted.push(key)
        return true
      },
    })
    const unregister = vi.fn(async () => true)
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] } })
    await clearClientCaches()
    expect(deleted).toEqual(['workbox-precache-v2', 'other'])
    expect(unregister).toHaveBeenCalledTimes(2)
  })

  it('keeps the service worker, its caches and what was shared when the session only expired (P-012)', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: async () => ['workbox-precache-v2', 'shared-files'],
      delete: async (key: string) => {
        deleted.push(key)
        return true
      },
    })
    const unregister = vi.fn(async () => true)
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [{ unregister }] } })
    localStorage.setItem('tcg.match-suggestions', '{}')
    await clearClientCaches('expired')
    expect(deleted).toEqual([])
    expect(unregister).not.toHaveBeenCalled()
    expect(localStorage.getItem('tcg.match-suggestions')).toBeNull()
  })

  it('keeps what was shared even when logging out', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: async () => ['workbox-precache-v2', 'shared-files'],
      delete: async (key: string) => {
        deleted.push(key)
        return true
      },
    })
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [] } })
    await clearClientCaches('logout')
    expect(deleted).toEqual(['workbox-precache-v2'])
  })
})
