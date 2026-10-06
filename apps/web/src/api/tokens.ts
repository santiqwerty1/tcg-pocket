import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import { createdTokenSchema, type TokenKind, tokensResponseSchema } from './schemas'

export const tokenKeys = {
  list: ['tokens'] as const,
}

export function useTokens() {
  return useQuery({
    queryKey: tokenKeys.list,
    queryFn: ({ signal }) => request('/api/tokens', { schema: tokensResponseSchema, signal }),
    select: (data) => data.items,
  })
}

export interface TokenInput {
  name: string
  kind: TokenKind
  scopes: string[]
}

export function useCreateToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TokenInput) => request('/api/tokens', { method: 'POST', body, schema: createdTokenSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenKeys.list }),
  })
}

export function useRevokeToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request(`/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenKeys.list }),
  })
}
