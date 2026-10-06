import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient as defaultClient } from '@/api/queryClient'

export function Providers({
  children,
  queryClient = defaultClient,
}: {
  children: ReactNode
  queryClient?: QueryClient
}) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
