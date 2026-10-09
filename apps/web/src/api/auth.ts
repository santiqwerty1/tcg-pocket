import { useMutation, useQuery } from '@tanstack/react-query'
import { request } from './client'
import { meSchema } from './schemas'
import { resetClientAndLogin } from './session'

export const authKeys = {
  me: ['auth', 'me'] as const,
}

export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: ({ signal }) => request('/api/auth/me', { schema: meSchema, signal }),
    staleTime: 5 * 60_000,
  })
}

export function useLogout() {
  return useMutation({
    mutationFn: () => request('/api/auth/logout', { method: 'POST' }),
    // Whether or not the API answered, the local caches and the service worker go and the browser lands on /login.
    onSettled: () => resetClientAndLogin('logout'),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      request('/api/auth/password', { method: 'POST', body }),
  })
}
