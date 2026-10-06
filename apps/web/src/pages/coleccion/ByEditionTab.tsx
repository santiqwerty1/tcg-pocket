import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCollectionStock, usePatchStock, useResolveAdjustment } from '@/api/collection'
import type { ActiveAdjustment, StockItem, StockPatchResult } from '@/api/schemas'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ExpansionSelect } from '@/components/ExpansionSelect'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { SearchBox } from '@/components/SearchBox'
import { CardCode } from '@/components/Section'
import { Stepper } from '@/components/Stepper'
import { Thumb } from '@/components/Thumb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatNumber } from '@/lib/format'
import { useDebouncedValue } from '@/lib/useDebounce'
import { cn } from '@/lib/utils'

export function describeStockPatch(result: StockPatchResult): string {
  const before = result.before?.amountOwned ?? 0
  const base = `${result.stockCardId}: ${before} → ${result.after.amountOwned}${result.after.collected ? ' · coleccionada' : ''}`
  const twins = result.affectedTwinIds.filter((id) => id !== result.stockCardId)
  return twins.length > 0 ? `${base} · también ${twins.join(', ')}` : base
}

interface PendingAdjustment {
  adjustment: ActiveAdjustment
  cardName: string
}

/** Collection by edition: owned copies per stock unit with inline +/− and the collected flag. */
export function ByEditionTab() {
  const [query, setQuery] = useState('')
  const [expansion, setExpansion] = useState<string | undefined>(undefined)
  const [onlyOwned, setOnlyOwned] = useState(false)
  const q = useDebouncedValue(query, 250)
  const stock = useCollectionStock({ q, ...(expansion ? { expansion } : {}), onlyOwned })
  const patch = usePatchStock()
  const resolve = useResolveAdjustment()
  const [pendingAdjustment, setPendingAdjustment] = useState<PendingAdjustment | null>(null)

  const items = stock.data?.pages.flatMap((page) => page.items) ?? []
  const total = stock.data?.pages[0]?.total

  async function change(item: StockItem, body: { amountOwned?: number; collected?: boolean }) {
    try {
      const result = await patch.mutateAsync({ cardId: item.card.id, ...body })
      toast.success(describeStockPatch(result))
      if (result.activeAdjustment)
        setPendingAdjustment({ adjustment: result.activeAdjustment, cardName: item.card.nameEs })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function retireAdjustment() {
    if (!pendingAdjustment) return
    try {
      await resolve.mutateAsync({ id: pendingAdjustment.adjustment.id, resolution: 'manual_edit' })
      toast.success('Ajuste retirado')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPendingAdjustment(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      <SearchBox value={query} onChange={setQuery} placeholder="Nombre o código (A1-1)…" />
      <div className="flex flex-wrap items-center gap-3">
        <ExpansionSelect value={expansion} onChange={setExpansion} className="min-w-44" />
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={onlyOwned} onCheckedChange={setOnlyOwned} />
          Solo las que tengo
        </Label>
        {total !== undefined ? (
          <span className="ml-auto text-sm text-muted-foreground tabular">{formatNumber(total)} ediciones</span>
        ) : null}
      </div>

      {stock.isPending ? <LoadingRows /> : null}
      {stock.isError ? <ErrorState error={stock.error} onRetry={() => stock.refetch()} /> : null}
      {stock.data && items.length === 0 ? <EmptyState title="Ninguna edición coincide" /> : null}

      {items.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => {
            const busy = patch.isPending && patch.variables?.cardId === item.card.id
            const twins = item.twinCardIds.filter((id) => id !== item.card.id)
            return (
              <li key={item.card.id} className="flex items-center gap-3 px-3 py-2">
                <Thumb src={item.card.imageUrl} alt="" />
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate font-medium', item.owned === 0 && 'text-muted-foreground')}>
                    {item.card.nameEs}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <CardCode id={item.card.id} /> · {item.card.rarity}
                    {twins.length > 0 ? <> · gemelas: {twins.join(', ')}</> : null}
                  </div>
                  <Label className="mt-1 flex min-h-8 items-center gap-2 text-xs">
                    <Checkbox
                      checked={item.collected}
                      disabled={busy}
                      onCheckedChange={(checked) => change(item, { collected: checked === true })}
                      aria-label={`${item.card.nameEs} coleccionada`}
                    />
                    coleccionada
                  </Label>
                </div>
                <Stepper
                  value={item.owned}
                  min={0}
                  disabled={busy}
                  label={`copias de ${item.card.nameEs} ${item.card.id}`}
                  onChange={(next) => change(item, { amountOwned: next })}
                />
              </li>
            )
          })}
        </ul>
      ) : null}

      {stock.hasNextPage ? (
        <Button variant="outline" onClick={() => stock.fetchNextPage()} disabled={stock.isFetchingNextPage}>
          {stock.isFetchingNextPage ? <Spinner /> : null}
          Cargar más
        </Button>
      ) : null}

      <ConfirmDialog
        open={pendingAdjustment !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAdjustment(null)
        }}
        title="Este grupo tiene un ajuste manual"
        description={
          pendingAdjustment
            ? `${pendingAdjustment.cardName} tiene un ajuste de ${pendingAdjustment.adjustment.playableCopies} copias («${pendingAdjustment.adjustment.reason}»). ¿Lo retirás para que valga lo que acabás de editar?`
            : null
        }
        confirmLabel="Retirar el ajuste"
        cancelLabel="Dejarlo"
        pending={resolve.isPending}
        onConfirm={retireAdjustment}
      />
    </div>
  )
}
