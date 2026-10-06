import { RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { isSyncRunning, useCatalogStatus, useSyncCatalog } from '@/api/catalog'
import { errorMessage } from '@/api/client'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { KeyValue, Section } from '@/components/Section'
import { Stat } from '@/components/Stat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber, shortSha } from '@/lib/format'

export function CatalogPage() {
  const status = useCatalogStatus()
  const sync = useSyncCatalog()
  const running = isSyncRunning(status.data)

  async function runSync() {
    try {
      await sync.mutateAsync({})
      toast.success('Sincronización iniciada; el estado se actualiza solo.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (status.isPending) return <LoadingRows />
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />
  const data = status.data

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Estado"
        action={
          <Button onClick={runSync} disabled={running || sync.isPending}>
            {running || sync.isPending ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
            {running ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
        }
      >
        <KeyValue
          items={[
            {
              label: 'Tracker',
              value: (
                <code className="font-mono" title={data.trackerCommit ?? ''}>
                  {shortSha(data.trackerCommit)}
                </code>
              ),
            },
            {
              label: 'Motor',
              value: (
                <code className="font-mono" title={data.engineRev ?? ''}>
                  {shortSha(data.engineRev)}
                </code>
              ),
            },
            { label: 'Sincronizado', value: formatDateTime(data.syncedAt) },
          ]}
        />
      </Section>

      {data.counts ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Cartas" value={formatNumber(data.counts.cards)} />
          <Stat label="Cartas funcionales" value={formatNumber(data.counts.groups)} />
          <Stat label="Unidades de stock" value={formatNumber(data.counts.stockUnits)} />
          <Stat label="Expansiones" value={formatNumber(data.counts.expansions)} />
          <Stat label="Sobres" value={formatNumber(data.counts.packs)} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">El catálogo todavía no se cargó: ejecutá una sincronización.</p>
      )}

      <Section title="Última sincronización">
        {data.lastSync ? (
          <div className="flex flex-col gap-2">
            <KeyValue
              items={[
                {
                  label: 'Estado',
                  value: <Badge variant={running ? 'default' : 'secondary'}>{data.lastSync.status}</Badge>,
                },
                { label: 'Inicio', value: formatDateTime(data.lastSync.startedAt) },
                { label: 'Fin', value: formatDateTime(data.lastSync.finishedAt) },
              ]}
            />
            {data.lastSync.report !== undefined && data.lastSync.report !== null ? (
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground select-none">Ver informe</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(data.lastSync.report, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nunca se sincronizó.</p>
        )}
      </Section>
    </div>
  )
}
