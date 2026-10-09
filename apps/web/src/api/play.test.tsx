import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayGame } from './play'

const GAME = {
  id: 5,
  status: 'running',
  bot: 'e2',
  botEs: 'Experto',
  seed: '1',
  engineRev: 'a'.repeat(40),
  human: { snapshot: 1, label: 'Mega-Blaziken ex', deckId: '2' },
  rival: { snapshot: 2, label: 'Hoopa ex', deckId: null, listKey: null },
  decision: null,
  log: [],
  choices: 0,
  winner: null,
  turns: null,
  finalState: null,
  replay: false,
  names: {},
  cards: {},
  workerOnline: true,
  error: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
  finishedAt: null,
}

class FakeEventSource {
  static last: FakeEventSource | null = null
  static readonly CLOSED = 2
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeEventSource.last = this
  }
  close() {
    this.closed = true
  }
}

describe('partidas contra el bot al instante (Fase 33)', () => {
  beforeEach(() => {
    FakeEventSource.last = null
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(GAME), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('takes each change the server pushes and closes the stream once the game is over', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => usePlayGame('5'), { wrapper })
    await waitFor(() => expect(result.current.data?.status).toBe('running'))
    const source = FakeEventSource.last as FakeEventSource
    expect(source.url).toBe('/api/play/5/events')
    const decision = {
      ply: 1,
      turn: 2,
      state: {},
      actions: [{ i: 0, text: 'EndTurn', action: 'EndTurn' }],
      hintAvailable: false,
      hint: null,
    }
    act(() => {
      source.onopen?.()
      source.onmessage?.({ data: JSON.stringify({ ...GAME, status: 'waiting', decision }) })
    })
    await waitFor(() => expect(result.current.data?.status).toBe('waiting'))
    expect(result.current.data?.decision?.ply).toBe(1)
    act(() => source.onmessage?.({ data: JSON.stringify({ ...GAME, status: 'done', winner: 'you', replay: false }) }))
    await waitFor(() => expect(result.current.data?.winner).toBe('you'))
    expect(source.closed).toBe(false) // the replay is still to come
    act(() => source.onmessage?.({ data: JSON.stringify({ ...GAME, status: 'done', winner: 'you', replay: true }) }))
    await waitFor(() => expect(result.current.data?.replay).toBe(true))
    expect(source.closed).toBe(true)
  })
})
