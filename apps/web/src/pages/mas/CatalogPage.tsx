import { DownloadCloudIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  type CatalogPreview,
  isSyncRunning,
  useCatalogLatest,
  useCatalogStatus,
  usePreviewCatalog,
  useSyncCatalog,
} from '@/api/catalog'
import { errorMessage } from '@/api/client'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { KeyValue, Section } from '@/components/Section'
import { Stat } from '@/components/Stat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber, shortSha } from '@/lib/format'

/** What applying a commit would change: new sets and cards, what the engine plays, what leaves, what to review. */
function PreviewPanel({
  preview,
  applying,
  onApply,
}: {
  preview: CatalogPreview
  applying: boolean
  onApply: (confirm: boolean) => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const added = preview.diff?.added ?? preview.counts.cards
  const review = (preview.remap?.notes ?? []).filter((note) => note.review)
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm">
      <p className="font-medium">
        Commit <code className="font-mono">{shortSha(preview.trackerCommit)}</code>
        {preview.diffEmpty
          ? preview.trackerCommit === preview.current
            ? ': nada cambia.'
            : ': las cartas no cambian, pero puede traer imágenes, misiones o sobres nuevos.'
          : ''}
      </p>
      {preview.expansionsAdded.length > 0 ? (
        <ul className="list-disc pl-5">
          {preview.expansionsAdded.map((expansion) => (
            <li key={expansion.id}>
              Set nuevo <span className="font-mono">{expansion.id}</span> · {expansion.nameEs} (
              {formatNumber(expansion.cards)} cartas)
            </li>
          ))}
        </ul>
      ) : null}
      {preview.diff ? (
        <p className="text-muted-foreground">
          {formatNumber(preview.diff.added)} cartas nuevas · {formatNumber(preview.diff.removed)} salen ·{' '}
          {formatNumber(preview.diff.stockChanged + preview.diff.groupChanged)} cambian de unidad o de carta funcional ·{' '}
          {formatNumber(preview.diff.nameChanged)} nombres.
        </p>
      ) : null}
      {added > 0 ? (
        <p>
          El motor juega {formatNumber(preview.engine.plays)} de las {formatNumber(added)} cartas nuevas
          {preview.engine.incomplete > 0 ? ` (${formatNumber(preview.engine.incomplete)} a medias)` : ''}
          {preview.engine.unknown > 0 ? `; ${formatNumber(preview.engine.unknown)} no las conoce todavía` : ''}
          {preview.engine.engineRev ? '' : ' (todavía ningún worker informó qué cartas juega)'}.
        </p>
      ) : null}
      {preview.removed.length > 0 ? (
        <p className="text-muted-foreground">
          Salen: {preview.removed.map((card) => card.nameEs).join(', ')}
          {(preview.diff?.removed ?? 0) > preview.removed.length ? '…' : ''}
        </p>
      ) : null}
      {review.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">Para revisar en tu colección y tus mazos</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {review.slice(0, 10).map((note) => (
              <li key={note.text}>{note.text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {preview.destructive ? (
        <label className="flex items-start gap-2 rounded-lg bg-destructive/10 p-2 text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {preview.older
              ? 'Es un commit anterior al cargado: volver atrás puede sacar cartas de la colección y de los mazos.'
              : 'Esta actualización saca cartas de la colección o de los mazos, o deja cosas para revisar.'}{' '}
            <input
              type="checkbox"
              className="align-middle"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              aria-label="Entiendo, aplicarla igual"
            />{' '}
            Entiendo, aplicarla igual.
          </span>
        </label>
      ) : null}
      {!preview.diffEmpty || preview.trackerCommit !== preview.current ? (
        <Button onClick={() => onApply(preview.destructive)} disabled={applying || (preview.destructive && !confirmed)}>
          {applying ? <Spinner /> : null}
          Aplicar
        </Button>
      ) : null}
    </div>
  )
}

export function CatalogPage() {
  const status = useCatalogStatus()
  const sync = useSyncCatalog()
  const running = isSyncRunning(status.data)
  const [checking, setChecking] = useState(false)
  const latest = useCatalogLatest(checking)
  const preview = usePreviewCatalog()

  async function runSync() {
    try {
      await sync.mutateAsync({})
      toast.success('Sincronización iniciada; el estado se actualiza solo.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function showPreview(commit?: string) {
    try {
      await preview.mutateAsync(commit ? { commit } : {})
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function apply(confirm: boolean) {
    if (!preview.data) return
    try {
      await sync.mutateAsync({ commit: preview.data.trackerCommit, engineRev: preview.data.engineRev, confirm })
      preview.reset()
      setChecking(false)
      toast.success('Actualización iniciada; el estado se actualiza solo.')
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

      <Section
        title="Día de expansión"
        action={
          <Button variant="outline" onClick={() => setChecking(true)} disabled={latest.isFetching}>
            {latest.isFetching ? <Spinner /> : <DownloadCloudIcon data-icon="inline-start" />}
            Buscar novedades
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Cuando sale un set: «Actualizar al último del tracker» muestra qué cambia antes de aplicarlo (cartas nuevas,
          qué juega el motor y qué pasa con tu colección y tus mazos). Después, Torneos → Ajustes propone la fila del
          set para la tabla de eras. «Sincronizar», arriba, vuelve a cargar el mismo commit.
        </p>
        {latest.data?.error ? <p className="text-sm text-destructive">{latest.data.error}</p> : null}
        {latest.data?.latest ? (
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
            <p className="flex-1">
              Último del tracker: <code className="font-mono">{shortSha(latest.data.latest.sha)}</code>
              {latest.data.latest.date ? ` (${formatDateTime(latest.data.latest.date)})` : ''}
              {latest.data.comparison?.status === 'identical'
                ? ' · el catálogo está al día.'
                : latest.data.comparison?.status === 'ahead'
                  ? ` · ${formatNumber(latest.data.comparison.aheadBy)} commits más nuevos que el cargado.`
                  : ''}
            </p>
            {latest.data.comparison?.status !== 'identical' ? (
              <Button onClick={() => showPreview(latest.data?.latest?.sha)} disabled={preview.isPending || running}>
                {preview.isPending ? <Spinner /> : null}
                Actualizar al último del tracker
              </Button>
            ) : null}
          </div>
        ) : null}
        {preview.data ? (
          <PreviewPanel preview={preview.data} applying={sync.isPending || running} onApply={apply} />
        ) : null}
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
