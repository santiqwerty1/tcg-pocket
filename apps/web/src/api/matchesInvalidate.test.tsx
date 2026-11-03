import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendPending } from '@/components/OfflineSync'
import { queueMatch } from '@/lib/offlineMatches'
import { fakeApi } from '@/test/fakeApi'
import { EMPTY_SUMMARY } from '@/test/pokemonZone'
import { useCreateMatch, useDeleteMatch, useUpdateMatch } from './matches'
import { pokemonZoneKey } from './pokemonZone'
import { useSheetImportApply } from './sheetImport'

/**
 * Codex on #170: pokemon-zone's «Según el juego» counts the matches logged, so every way a match is saved, edited,
 * deleted or brought in marks that summary stale too.
 */
const MATCH = {
  id: '7',
  deck: { id: '1', name: 'Mazo', archived: false },
  deckRevision: 1,
  result: 'win',
  opponent: null,
  opponentCards: [],
  wentFirst: null,
  mode: 'competitive',
  note: '',
  playedAt: '2026-11-02T12:00:00.000Z',
  source: 'ui',
  createdAt: '2026-11-02T12:00:00.000Z',
  updatedAt: '2026-11-02T12:00:00.000Z',
}

const APPLIED = {
  imported: [{ row: 2, matchId: '7' }],
  ranks: 0,
  counts: {
    rows: 1,
    new: 1,
    inApp: 0,
    duplicate: 0,
    possibleDuplicate: 0,
    picked: 0,
    unmapped: 0,
    errors: 0,
    warnings: 0,
    write: 1,
    ranks: 0,
  },
  columnK: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup() {
  fakeApi({
    'POST /api/matches': MATCH,
    'PATCH /api/matches/7': MATCH,
    'DELETE /api/matches/7': new Response(null, { status: 204 }),
    'POST /api/matches/import': APPLIED,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(pokemonZoneKey, EMPTY_SUMMARY)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const stale = () => client.getQueryState(pokemonZoneKey)?.isInvalidated ?? false
  return { client, wrapper, stale }
}

describe('a match that changes marks pokemon-zone stale (Codex on #170)', () => {
  it('saving one', async () => {
    const { wrapper, stale } = setup()
    const { result } = renderHook(() => useCreateMatch(), { wrapper })
    expect(stale()).toBe(false)
    await result.current.mutateAsync({ deckId: '1', result: 'win', mode: 'competitive' })
    await waitFor(() => expect(stale()).toBe(true))
  })

  it('editing one', async () => {
    const { wrapper, stale } = setup()
    const { result } = renderHook(() => useUpdateMatch(), { wrapper })
    await result.current.mutateAsync({ id: '7', patch: { mode: 'casual' } })
    await waitFor(() => expect(stale()).toBe(true))
  })

  it('deleting one', async () => {
    const { wrapper, stale } = setup()
    const { result } = renderHook(() => useDeleteMatch(), { wrapper })
    await result.current.mutateAsync('7')
    await waitFor(() => expect(stale()).toBe(true))
  })

  it('importing the sheet', async () => {
    const { wrapper, stale } = setup()
    const { result } = renderHook(() => useSheetImportApply(), { wrapper })
    await result.current.mutateAsync({ text: 'x', deckMap: {}, mode: 'competitive', include: [], fingerprint: 'f' })
    await waitFor(() => expect(stale()).toBe(true))
  })

  it('sending what was saved without signal', async () => {
    const { client, stale } = setup()
    queueMatch({
      clientRef: '0f1e2d3c-4b5a-4968-8776-655443322110',
      body: { deckId: '1', result: 'win', mode: 'competitive' },
      label: 'Victoria con Mazo',
      savedAt: Date.now(),
    })
    expect(await sendPending(client)).toBe(1)
    expect(stale()).toBe(true)
  })
})
