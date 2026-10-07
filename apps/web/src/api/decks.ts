import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, requestText } from './client'
import {
  commitDecksResponseSchema,
  type DeckExportFormat,
  type DeckImportFormat,
  type DeckInput,
  deckDetailSchema,
  decksByCardResponseSchema,
  decksResponseSchema,
  importDecksResponseSchema,
  type SelectableEnergy,
  validateResponseSchema,
} from './schemas'

export const deckKeys = {
  all: ['decks'] as const,
  list: (params: DecksParams) => ['decks', 'list', params] as const,
  detail: (id: string) => ['decks', id] as const,
  byCard: (groupId: string) => ['decks', 'by-card', groupId] as const,
}

export interface DecksParams {
  tag?: string
  archived?: boolean
  builtInGame?: boolean
}

async function invalidateDecks(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: deckKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['groups'] }),
    queryClient.invalidateQueries({ queryKey: ['cards'] }),
    // Deck names, archiving and revisions show up in the match picker, lists and statistics.
    queryClient.invalidateQueries({ queryKey: ['matches'] }),
  ])
}

export function useDecks(params: DecksParams = {}) {
  return useQuery({
    queryKey: deckKeys.list(params),
    queryFn: ({ signal }) =>
      request('/api/decks', {
        query: {
          tag: params.tag || undefined,
          archived: params.archived === undefined ? undefined : params.archived,
          builtInGame: params.builtInGame === undefined ? undefined : params.builtInGame,
        },
        schema: decksResponseSchema,
        signal,
      }),
    select: (data) => data.items,
  })
}

export function useDeck(id: string | undefined) {
  return useQuery({
    queryKey: deckKeys.detail(id ?? ''),
    queryFn: ({ signal }) =>
      request(`/api/decks/${encodeURIComponent(id ?? '')}`, { schema: deckDetailSchema, signal }),
    enabled: Boolean(id),
  })
}

export function useDecksByCard(groupId: string | undefined) {
  return useQuery({
    queryKey: deckKeys.byCard(groupId ?? ''),
    queryFn: ({ signal }) =>
      request(`/api/decks/by-card/${encodeURIComponent(groupId ?? '')}`, { schema: decksByCardResponseSchema, signal }),
    enabled: Boolean(groupId),
    select: (data) => data.items,
  })
}

export function useCreateDeck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DeckInput) => request('/api/decks', { method: 'POST', body, schema: deckDetailSchema }),
    onSuccess: () => invalidateDecks(queryClient),
  })
}

export type DeckPatch = Partial<DeckInput> & { builtInGame?: boolean; archived?: boolean; note?: string }

export function useUpdateDeck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: DeckPatch }) =>
      request(`/api/decks/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, schema: deckDetailSchema }),
    onSuccess: (deck) => {
      queryClient.setQueryData(deckKeys.detail(deck.id), deck)
      return invalidateDecks(queryClient)
    },
  })
}

export function useDeleteDeck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request(`/api/decks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidateDecks(queryClient),
  })
}

export function useDuplicateDeck() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      request(`/api/decks/${encodeURIComponent(id)}/duplicate`, {
        method: 'POST',
        body: name ? { name } : {},
        schema: deckDetailSchema,
      }),
    onSuccess: () => invalidateDecks(queryClient),
  })
}

export function useRestoreRevision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, number }: { id: string; number: number }) =>
      request(`/api/decks/${encodeURIComponent(id)}/revisions/${number}/restore`, {
        method: 'POST',
        schema: deckDetailSchema,
      }),
    onSuccess: (deck) => {
      queryClient.setQueryData(deckKeys.detail(deck.id), deck)
      return invalidateDecks(queryClient)
    },
  })
}

export function fetchDeckExport(id: string, format: DeckExportFormat): Promise<string> {
  return requestText(`/api/decks/${encodeURIComponent(id)}/export`, { format })
}

export const EXPORT_EXTENSION: Record<DeckExportFormat, string> = {
  spanish: 'txt',
  deckgym: 'txt',
  limitless: 'txt',
  json: 'json',
}

export interface ValidateBody {
  text?: string
  format?: 'spanish' | 'limitless' | 'json' | 'auto'
  cards?: { cardId: string; count: number }[]
  energies?: SelectableEnergy[]
}

export function useValidateDeck() {
  return useMutation({
    mutationFn: (body: ValidateBody) =>
      request('/api/decks/validate', { method: 'POST', body, schema: validateResponseSchema }),
  })
}

export function useImportDecks() {
  return useMutation({
    mutationFn: (body: { text: string; format?: DeckImportFormat }) =>
      request('/api/decks/import', { method: 'POST', body, schema: importDecksResponseSchema }),
  })
}

export function useCommitDecks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (decks: DeckInput[]) =>
      request('/api/decks/import/commit', { method: 'POST', body: { decks }, schema: commitDecksResponseSchema }),
    onSuccess: () => invalidateDecks(queryClient),
  })
}
