/**
 * Copia en la nube (Fase 39): the daily copy also goes to a bucket outside Supabase (Tigris on Fly). Here: whether it
 * is set up, the last upload and «Subir ahora».
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, CloudUploadIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { backupKeys } from '@/api/backup'
import { errorMessage, request } from '@/api/client'
import { Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'

const resultSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  key: z.string().nullable(),
  error: z.string().nullable(),
  kept: z.number().nullable(),
})
const statusSchema = z.object({ enabled: z.boolean(), last: resultSchema.nullable() })
const uploadSchema = z.object({ result: resultSchema })
const offsiteKey = ['backup', 'offsite'] as const

export function BackupOffsiteSection() {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: offsiteKey,
    queryFn: ({ signal }) => request('/api/backup/offsite', { schema: statusSchema, signal }),
  })
  const upload = useMutation({
    mutationFn: () => request('/api/backup/offsite', { method: 'POST', schema: uploadSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(offsiteKey, { enabled: true, last: data.result })
      void queryClient.invalidateQueries({ queryKey: backupKeys.blobs })
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      if (data.result.ok) toast.success('Copia subida a la nube')
      else toast.error('No se pudo subir la copia')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const enabled = status.data?.enabled ?? false
  const last = status.data?.last ?? null

  return (
    <Section
      title="Copia en la nube"
      action={
        enabled ? (
          <Button variant="outline" size="sm" onClick={() => upload.mutate()} disabled={upload.isPending}>
            {upload.isPending ? <Spinner /> : <CloudUploadIcon data-icon="inline-start" />}
            Subir ahora
          </Button>
        ) : null
      }
    >
      <p className="text-sm text-muted-foreground">
        {enabled
          ? 'Después de la copia de las 04:00 se sube otra igual fuera de Supabase (quedan las últimas 30). Si se perdiera la base, se restaura desde ahí.'
          : 'Todavía no está configurada: falta crear el bucket (flyctl storage create). Mientras tanto, la copia queda solo en la base.'}
      </p>
      {enabled && last === null && status.isSuccess ? <p className="text-sm">Todavía no se subió ninguna.</p> : null}
      {last ? (
        <div className="flex items-start gap-2 rounded-lg border p-3 text-sm" role="status">
          {last.ok ? (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {last.ok ? 'Subida' : 'Falló'} · {formatDateTime(last.at)}
            </p>
            <p className="break-words text-muted-foreground">
              {last.ok ? `${last.kept ?? 0} copias en la nube.` : (last.error ?? 'Error desconocido.')}
            </p>
          </div>
        </div>
      ) : null}
    </Section>
  )
}
