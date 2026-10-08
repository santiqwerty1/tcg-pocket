/** Eventos con restricciones (Fase 16). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import { type EventInput, eventDetailSchema, eventSchema, eventsSchema } from './schemas'

export const eventKeys = {
  all: ['events'] as const,
  detail: (id: string) => ['events', 'detail', id] as const,
}

export function useEvents() {
  return useQuery({
    queryKey: eventKeys.all,
    queryFn: ({ signal }) => request('/api/events', { schema: eventsSchema, signal }),
    select: (data) => data.items,
  })
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: ({ signal }) => request(`/api/events/${encodeURIComponent(id)}`, { schema: eventDetailSchema, signal }),
  })
}

export function useCreateEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EventInput) => request('/api/events', { method: 'POST', body: input, schema: eventSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.all }),
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EventInput> }) =>
      request(`/api/events/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, schema: eventSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.all }),
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: eventKeys.all }),
  })
}
