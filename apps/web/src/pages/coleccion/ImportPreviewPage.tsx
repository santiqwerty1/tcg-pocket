import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useApplyImport, useDiscardImport, useImport, useResolveAdjustment } from '@/api/collection'
import { useApplyDotgg } from '@/api/dotgg'
import { useApplyTracker } from '@/api/trackerSync'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber } from '@/lib/format'
import { ImportPreviewView } from './ImportPreviewView'

/** «Bajan 20 copias de las 100 actuales.», with the singular and the thousands separator. */
function dropText(removed: number, current: number): string {
  const drop = removed === 1 ? 'Baja 1 copia' : `Bajan ${formatNumber(removed)} copias`
  const of = current === 1 ? 'de la única actual' : `de las ${formatNumber(current)} actuales`
  return `${drop} ${of}.`
}

export function ImportPreviewPage() {
  const { importId } = useParams()
  const navigate = useNavigate()
  const preview = useImport(importId)
  const apply = useApplyImport()
  const trackerApply = useApplyTracker()
  const dotggApply = useApplyDotgg()
  const discard = useDiscardImport()
  const resolve = useResolveAdjustment()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  if (preview.isPending) return <LoadingRows />
  if (preview.isError) return <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
  const data = preview.data
  const blocked = data.errors.length > 0 || data.twinConflicts.length > 0
  const applier = data.source === 'tracker' ? trackerApply : data.source === 'dotgg' ? dotggApply : apply
  const review = data.tracker ?? data.dotgg

  async function applyImport() {
    if (!importId) return
    try {
      const result = await applier.mutateAsync(importId)
      toast.success(
        result.summary ? `Import aplicado: ${result.summary.unitsChanged} unidades cambiaron` : 'Import aplicado',
      )
      navigate('/coleccion')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setConfirmApply(false)
    }
  }

  async function discardImport() {
    if (!importId) return
    try {
      await discard.mutateAsync(importId)
      toast.success('Import descartado')
      navigate('/coleccion/importar')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setConfirmDiscard(false)
    }
  }

  async function resolveAdjustment(adjustmentId: string) {
    setResolvingId(adjustmentId)
    try {
      await resolve.mutateAsync({ id: adjustmentId, resolution: 'csv_matches' })
      toast.success('Ajuste retirado')
      await preview.refetch()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {data.status !== 'pending' ? (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary">{data.status === 'applied' ? 'aplicado' : 'descartado'}</Badge>
          {data.appliedAt ? <span className="text-muted-foreground">{formatDateTime(data.appliedAt)}</span> : null}
        </div>
      ) : null}

      <ImportPreviewView
        preview={data}
        {...(data.status === 'pending' && data.source === 'csv'
          ? { onResolveAdjustment: resolveAdjustment, resolvingId }
          : {})}
      />

      {data.status === 'pending' ? (
        <div className="sticky bottom-20 z-20 flex gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur">
          <Button
            className="flex-1"
            size="lg"
            onClick={() => (review?.requiresReview ? setConfirmApply(true) : void applyImport())}
            disabled={blocked || applier.isPending}
          >
            {applier.isPending ? <Spinner /> : null}
            Aplicar
          </Button>
          <Button variant="outline" size="lg" onClick={() => setConfirmDiscard(true)} disabled={discard.isPending}>
            Descartar
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmApply}
        onOpenChange={setConfirmApply}
        title={data.source === 'dotgg' ? '¿Aplicar los cambios de ptcgpocket.gg?' : '¿Aplicar los cambios del tracker?'}
        description={`${dropText(review?.removedCopies ?? 0, review?.currentCopies ?? 0)} ${review?.reviewReasons?.join(' ') ?? 'Revisá los cambios antes de confirmar.'}`}
        confirmLabel="Aplicar cambios"
        destructive
        pending={applier.isPending}
        onConfirm={applyImport}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="¿Descartar este import?"
        description="El archivo queda en el historial como descartado y la colección no cambia."
        confirmLabel="Descartar"
        destructive
        pending={discard.isPending}
        onConfirm={discardImport}
      />
    </div>
  )
}
