import { QueryClient } from '@tanstack/react-query'
import { isApiError } from './client'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Client errors (401, 404, 409…) never get better by retrying; network and 5xx get one more try.
          if (isApiError(error) && error.status > 0 && error.status < 500) return false
          return failureCount < 1
        },
      },
      mutations: { retry: false },
    },
  })
}

export const queryClient = createQueryClient()
