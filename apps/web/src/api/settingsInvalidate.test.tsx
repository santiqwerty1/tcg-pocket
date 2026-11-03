import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi } from '@/test/fakeApi'
import { EMPTY_SUMMARY } from '@/test/pokemonZone'
import { pokemonZoneKey } from './pokemonZoneKey'
import { useSetSetting } from './settings'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Review of pz/import: a hand edit of the settings an import writes refreshes «where they came from» on any screen. */
describe('saving a setting', () => {
  function setup() {
    fakeApi({
      'PUT /api/settings/hourglasses': { key: 'hourglasses', value: 6 },
      'PUT /api/settings/packPoints': { key: 'packPoints', value: { A1: 6 } },
      'PUT /api/settings/ui': { key: 'ui', value: { thumbnails: true } },
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(pokemonZoneKey, EMPTY_SUMMARY)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSetSetting(), { wrapper })
    const stale = () => client.getQueryState(pokemonZoneKey)?.isInvalidated ?? false
    return { result, stale }
  }

  it('the pack hourglasses or the pack points mark the pokemon-zone summary stale', async () => {
    for (const [key, value] of [
      ['hourglasses', 6],
      ['packPoints', { A1: 6 }],
    ] as const) {
      const { result, stale } = setup()
      await result.current.mutateAsync({ key, value })
      expect(stale(), key).toBe(true)
      vi.unstubAllGlobals()
    }
  })

  it('another setting does not', async () => {
    const { result, stale } = setup()
    await result.current.mutateAsync({ key: 'ui', value: { thumbnails: true } })
    expect(stale()).toBe(false)
  })
})
