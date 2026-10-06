import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { downloadFile, request } from './client'
import { backupBlobsSchema, backupDryRunSchema, backupReplaceSchema } from './schemas'

export const backupKeys = {
  blobs: ['backup', 'blobs'] as const,
}

export function exportBackup(): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return downloadFile('/api/backup/export', `tcgpocket-backup-${stamp}.json.gz`)
}

function backupForm(file: File): FormData {
  const form = new FormData()
  form.append('file', file, file.name)
  return form
}

export function useBackupDryRun() {
  return useMutation({
    mutationFn: (file: File) =>
      request('/api/backup/import', {
        method: 'POST',
        query: { mode: 'dry-run' },
        body: backupForm(file),
        schema: backupDryRunSchema,
      }),
  })
}

export function useBackupReplace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) =>
      request('/api/backup/import', {
        method: 'POST',
        query: { mode: 'replace' },
        body: backupForm(file),
        schema: backupReplaceSchema,
      }),
    // Everything may have changed: drop every cache.
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useBackupBlobs() {
  return useQuery({
    queryKey: backupKeys.blobs,
    queryFn: ({ signal }) => request('/api/backup/blobs', { schema: backupBlobsSchema, signal }),
    select: (data) => data.items,
  })
}

export function downloadBackupBlob(id: string, createdAt: string): Promise<string> {
  const stamp = createdAt.slice(0, 10).replace(/-/g, '')
  return downloadFile(`/api/backup/blobs/${encodeURIComponent(id)}`, `tcgpocket-backup-${stamp}.json.gz`)
}
