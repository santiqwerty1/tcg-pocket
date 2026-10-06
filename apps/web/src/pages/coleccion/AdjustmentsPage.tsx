import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { useGroup } from '@/api/catalog'
import { errorMessage } from '@/api/client'
import { useAdjustments, useConvertAdjustment, useCreateAdjustment, useResolveAdjustment } from '@/api/collection'
import type { CollectionAdjustment } from '@/api/schemas'
import { CardSearch } from '@/components/CardSearch'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Stepper } from '@/components/Stepper'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface PickedGroup {
  id: string
  nameEs: string
}

export function AdjustmentsPage() {
  const [params, setParams] = useSearchParams()
  const adjustments = useAdjustments(true)
  const create = useCreateAdjustment()
  const resolve = useResolveAdjustment()
  const [picked, setPicked] = useState<PickedGroup | null>(null)
  const [copies, setCopies] = useState(0)
  const [reason, setReason] = useState('')
  const [converting, setConverting] = useState<CollectionAdjustment | null>(null)
  const [retiring, setRetiring] = useState<CollectionAdjustment | null>(null)

  // `/coleccion/ajustes?grupo=B2-113` arrives from a card page with the group preselected.
  const presetGroupId = params.get('grupo') ?? undefined
  const preset = useGroup(presetGroupId)
  useEffect(() => {
    if (preset.data && !picked) {
      setPicked({ id: preset.data.id, nameEs: preset.data.nameEs })
      setCopies(preset.data.playable)
    }
  }, [preset.data, picked])

  const pickedGroup = useGroup(picked?.id)
  useEffect(() => {
    if (pickedGroup.data && picked && pickedGroup.data.id === picked.id) setCopies(pickedGroup.data.playable)
  }, [pickedGroup.data, picked])

  async function submit() {
    if (!picked) return
    try {
      await create.mutateAsync({ functionalGroupId: picked.id, playableCopies: copies, reason: reason.trim() })
      toast.success(`Ajuste creado: ${picked.nameEs} = ${copies}`)
      setPicked(null)
      setReason('')
      if (presetGroupId) setParams({}, { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function retire() {
    if (!retiring) return
    try {
      await resolve.mutateAsync({ id: retiring.id, resolution: 'user' })
      toast.success('Ajuste retirado')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRetiring(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Nuevo ajuste">
        <p className="text-sm text-muted-foreground">
          Un ajuste fija las copias jugables de una carta funcional por encima de lo que dice el CSV (por ejemplo, 2
          Latias aunque el tracker diga 3). No se exporta; podés convertirlo en edición manual más adelante.
        </p>
        {picked ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{picked.nameEs}</div>
                <div className="text-xs text-muted-foreground">
                  <code className="font-mono">{picked.id}</code>
                  {pickedGroup.data
                    ? ` · stock ${pickedGroup.data.fromStock} · jugables ${pickedGroup.data.playable}`
                    : ''}
                  {pickedGroup.data?.adjustment ? ' · ya tiene un ajuste activo' : ''}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Cambiar
              </Button>
            </div>
            <Field label="Copias jugables">
              <Stepper value={copies} onChange={setCopies} min={0} label="copias jugables" />
            </Field>
            <Field label="Motivo" htmlFor="adjustment-reason">
              <Input
                id="adjustment-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Tengo 2 y 2, el tracker dice 3 y 1"
              />
            </Field>
            <Button onClick={submit} disabled={create.isPending || reason.trim().length === 0}>
              {create.isPending ? <Spinner /> : null}
              Crear ajuste
            </Button>
          </div>
        ) : (
          <CardSearch
            placeholder="Buscá la carta funcional…"
            onPick={(hit) => {
              setPicked({ id: hit.group.id, nameEs: hit.group.nameEs })
            }}
          />
        )}
      </Section>

      <Section title="Ajustes activos">
        {adjustments.isPending ? <LoadingRows rows={3} /> : null}
        {adjustments.isError ? <ErrorState error={adjustments.error} onRetry={() => adjustments.refetch()} /> : null}
        {adjustments.data && adjustments.data.length === 0 ? <EmptyState title="No hay ajustes activos" /> : null}
        {adjustments.data && adjustments.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {adjustments.data.map((adjustment) => (
              <li key={adjustment.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to={`/grupos/${encodeURIComponent(adjustment.functionalGroupId)}`}
                      className="font-medium hover:underline"
                    >
                      {adjustment.nameEs ?? adjustment.functionalGroupId}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      <code className="font-mono">{adjustment.functionalGroupId}</code> ·{' '}
                      {formatDateTime(adjustment.createdAt)}
                    </div>
                    <div className="text-sm">{adjustment.reason}</div>
                  </div>
                  <div className="text-2xl font-semibold tabular" title="copias jugables">
                    {adjustment.playableCopies}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConverting(adjustment)}>
                    Convertir en edición manual
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRetiring(adjustment)}>
                    Retirar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null)
        }}
        title="¿Retirar el ajuste?"
        description={
          retiring ? `${retiring.nameEs ?? retiring.functionalGroupId} vuelve a valer lo que suma el stock.` : null
        }
        confirmLabel="Retirar"
        pending={resolve.isPending}
        onConfirm={retire}
      />

      {converting ? <ConvertDialog adjustment={converting} onClose={() => setConverting(null)} /> : null}
    </div>
  )
}

/** Picks the edition that absorbs the difference so the tracker CSV also ends up corrected (DECISIONES 0.16). */
function ConvertDialog({ adjustment, onClose }: { adjustment: CollectionAdjustment; onClose: () => void }) {
  const group = useGroup(adjustment.functionalGroupId)
  const convert = useConvertAdjustment()
  const [target, setTarget] = useState<string | null>(null)
  const delta = group.data ? adjustment.playableCopies - group.data.fromStock : null

  async function submit() {
    if (!target) return
    try {
      await convert.mutateAsync({ id: adjustment.id, targetCardId: target })
      toast.success('Ajuste convertido en edición manual')
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convertir en edición manual</DialogTitle>
          <DialogDescription>
            {group.data
              ? `El stock suma ${group.data.fromStock} y el ajuste fija ${adjustment.playableCopies}: elegí a qué edición se le ${delta !== null && delta < 0 ? 'resta' : 'suma'} la diferencia (${delta ?? '…'}).`
              : 'Cargando el grupo…'}
          </DialogDescription>
        </DialogHeader>
        {group.isError ? <ErrorState error={group.error} /> : null}
        {group.data ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="sr-only">Edición destino</legend>
            {group.data.editions.map((edition) => (
              <label
                key={edition.card.id}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm',
                  target === edition.card.id ? 'border-primary bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name="convert-target"
                  value={edition.card.id}
                  checked={target === edition.card.id}
                  onChange={() => setTarget(edition.card.id)}
                  className="size-5 accent-primary"
                />
                <code className="font-mono">{edition.card.id}</code>
                <span className="text-muted-foreground">{edition.card.rarity}</span>
                <span className="ml-auto tabular">{edition.owned} en stock</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!target || convert.isPending}>
            {convert.isPending ? <Spinner /> : null}
            Convertir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
