/**
 * Prueba del backup (Fase 35): the 1st of each month at 04:30 the server makes a copy, restores it inside a
 * transaction, checks it gives back exactly the same data and undoes it. Here: the last result and «Probar ahora».
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2Icon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { backupKeys } from '@/api/backup'
import { errorMessage, request } from '@/api/client'
import { Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'

const drillSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  blobId: z.string().nullable(),
  sizeBytes: z.number(),
  counts: z.record(z.string(), z.number()).nullable(),
  differences: z.array(z.string()),
  ms: z.number(),
  error: z.string().nullable(),
})
const responseSchema = z.object({ drill: drillSchema.nullable() })
const drillKey = ['backup', 'drill'] as const

export function BackupDrillSection() {
  const queryClient = useQueryClient()
  const last = useQuery({
    queryKey: drillKey,
    queryFn: ({ signal }) => request('/api/backup/drill', { schema: responseSchema, signal }),
    select: (data) => data.drill,
  })
  const run = useMutation({
    mutationFn: () => request('/api/backup/drill', { method: 'POST', schema: responseSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(drillKey, data)
      void queryClient.invalidateQueries({ queryKey: backupKeys.blobs })
      void queryClient.invalidateQueries({ queryKey: ['alerts'] })
      if (data.drill?.ok) toast.success('El backup se restauró bien (y se deshizo)')
      else toast.error('La prueba del backup falló')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const drill = last.data

  return (
    <Section
      title="Prueba de restauración"
      action={
        <Button variant="outline" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? <Spinner /> : <ShieldCheckIcon data-icon="inline-start" />}
          Probar ahora
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        El 1 de cada mes a las 04:30 se hace una copia, se restaura en una transacción, se compara con el archivo y se
        deshace: tus datos no cambian. Si falla, aparece en Avisos.
      </p>
      {drill === null ? <p className="text-sm">Todavía no se probó.</p> : null}
      {drill ? (
        <div className="flex items-start gap-2 rounded-lg border p-3 text-sm" role="status">
          {drill.ok ? (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {drill.ok ? 'Bien' : 'Falló'} · {formatDateTime(drill.at)}
            </p>
            <p className="text-muted-foreground">
              {drill.ok
                ? `Copia de ${formatBytes(drill.sizeBytes)}: ${drill.counts?.decks ?? 0} mazos, ${drill.counts?.matches ?? 0} partidas y ${formatNumber(drill.counts?.stock ?? 0)} cartas de la colección volvieron iguales (${(drill.ms / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} s).`
                : (drill.error ?? `Al restaurarla cambió: ${drill.differences.join(', ')}.`)}
            </p>
          </div>
        </div>
      ) : null}
    </Section>
  )
}
