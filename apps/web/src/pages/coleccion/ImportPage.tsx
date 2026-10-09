import { FileTextIcon, UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateImport, useImports } from '@/api/collection'
import type { ImportListItem } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber } from '@/lib/format'
import { forgetSharedFile, sharedFile } from '@/lib/shared'

const STATUS_LABEL: Record<ImportListItem['status'], string> = {
  pending: 'pendiente',
  applied: 'aplicado',
  discarded: 'descartado',
}

export function ImportPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const shared = params.get('compartido') === '1'
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const create = useCreateImport()
  const imports = useImports()

  // A CSV shared from another app (manifest `share_target`) that has not been imported yet.
  const [waiting, setWaiting] = useState<File | null>(null)

  // Fase 41: choosing the file is enough — it goes up and the diff opens (nothing changes until it is applied).
  async function upload(chosen: File, fromShare = false) {
    setFile(chosen)
    try {
      const preview = await create.mutateAsync(chosen)
      if (fromShare) await forgetSharedFile()
      // A share replaces its `?compartido=1` entry: back from the diff does not re-run an import already used.
      navigate(`/coleccion/importar/${encodeURIComponent(preview.id)}`, { replace: fromShare })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  // Coming from «Compartir» it goes up at once; otherwise a waiting share is offered (e.g. after logging in again).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per visit, not on every render.
  useEffect(() => {
    let cancelled = false
    void sharedFile().then((found) => {
      if (cancelled || !found) {
        if (!cancelled && shared) toast.error('No llegó ningún archivo compartido. Elegilo acá.')
        return
      }
      if (shared) void upload(found, true)
      else setWaiting(found)
    })
    return () => {
      cancelled = true
    }
  }, [shared])

  return (
    <div className="flex flex-col gap-6">
      <Section title="Subir el CSV del tracker">
        <p className="text-sm text-muted-foreground">
          Elegí la exportación de TCG Pocket Collection Tracker (<code>tcgcollectiontracterexport.csv</code>). Primero
          vas a ver el diff contra la colección actual; nada cambia hasta que lo apliques.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Archivo CSV"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            event.target.value = ''
            if (chosen) void upload(chosen)
          }}
        />
        {waiting ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
            <span className="min-w-0 flex-1">
              Compartiste <span className="font-medium">{waiting.name}</span> y todavía no se importó.
            </span>
            <Button size="sm" onClick={() => void upload(waiting, true)} disabled={create.isPending}>
              Subirlo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setWaiting(null)
                void forgetSharedFile()
              }}
            >
              Descartar
            </Button>
          </div>
        ) : null}
        <Button size="lg" onClick={() => inputRef.current?.click()} disabled={create.isPending}>
          {create.isPending ? <Spinner /> : <UploadIcon data-icon="inline-start" />}
          {create.isPending ? 'Subiendo…' : 'Elegir el CSV y ver el diff'}
        </Button>
        {file ? (
          <p className="flex items-center gap-1.5 text-sm">
            <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {file.name} <span className="text-muted-foreground">({formatNumber(Math.round(file.size / 1024))} KB)</span>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Desde el celu también podés compartir el archivo con la app desde Archivos o desde el tracker.
        </p>
      </Section>

      <Section title="Historial de imports">
        {imports.isPending ? <LoadingRows rows={3} /> : null}
        {imports.isError ? <ErrorState error={imports.error} onRetry={() => imports.refetch()} /> : null}
        {imports.data && imports.data.length === 0 ? <EmptyState title="Todavía no importaste ningún CSV" /> : null}
        {imports.data && imports.data.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {imports.data.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/coleccion/importar/${encodeURIComponent(item.id)}`}
                  className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.fileName ?? 'CSV pegado'}</span>
                    <span className="block text-xs text-muted-foreground tabular">
                      {formatDateTime(item.importedAt)} · {formatNumber(item.rowCount)} filas ·{' '}
                      {formatNumber(item.naiveTotal)} → {formatNumber(item.dedupTotal)} copias
                      {item.summary ? ` · ${formatNumber(item.summary.unitsChanged)} cambios` : ''}
                    </span>
                  </span>
                  <Badge
                    variant={
                      item.status === 'pending' ? 'default' : item.status === 'applied' ? 'secondary' : 'outline'
                    }
                  >
                    {STATUS_LABEL[item.status]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
    </div>
  )
}
