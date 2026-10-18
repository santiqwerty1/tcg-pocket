import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import {
  type ChatChannel,
  type ChatRoom,
  chatMovedResponseSchema,
  chatParticipantSchema,
  chatParticipantsResponseSchema,
  createdTokenSchema,
  type TokenKind,
  tokensResponseSchema,
} from './schemas'

export const tokenKeys = {
  list: ['tokens'] as const,
  chatParticipants: ['chat-participants'] as const,
  chatMoved: ['chat-moved'] as const,
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

/** D-021: who takes part in the session chat (Más → Tokens de API). */
export function useChatParticipants() {
  return useQuery({
    queryKey: tokenKeys.chatParticipants,
    queryFn: ({ signal }) => request('/api/chat/participants', { schema: chatParticipantsResponseSchema, signal }),
    select: (data) => data.items,
  })
}

export function useSaveChatParticipant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; channel: ChatChannel; rooms?: ChatRoom[] }) =>
      request('/api/chat/participants', { method: 'PUT', body, schema: chatParticipantSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenKeys.chatParticipants }),
  })
}

export function useRemoveChatParticipant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => request(`/api/chat/participants/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenKeys.chatParticipants }),
  })
}

/** D-030 (T1b): the rooms of the chat moved to the hub, and whether the old connector is forwarded. */
export function useChatMoved() {
  return useQuery({
    queryKey: tokenKeys.chatMoved,
    queryFn: ({ signal }) => request('/api/chat/moved', { schema: chatMovedResponseSchema, signal }),
  })
}

export function useSetChatMoved() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ room, url }: { room: ChatRoom; url: string }) =>
      request(`/api/chat/moved/${room}`, { method: 'PUT', body: { url } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenKeys.chatMoved }),
  })
}

export function useClearChatMoved() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (room: ChatRoom) => request(`/api/chat/moved/${room}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokenKeys.chatMoved }),
  })
}
