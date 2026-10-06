import { FileTextIcon, UploadIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateImport, useImports } from '@/api/collection'
import type { ImportListItem } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber } from '@/lib/format'

const STATUS_LABEL: Record<ImportListItem['status'], string> = {
  pending: 'pendiente',
  applied: 'aplicado',
  discarded: 'descartado',
}

export function ImportPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const create = useCreateImport()
  const imports = useImports()

  async function upload() {
    if (!file) return
    try {
      const preview = await create.mutateAsync(file)
      navigate(`/coleccion/importar/${encodeURIComponent(preview.id)}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

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
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <FileTextIcon data-icon="inline-start" />
            {file ? 'Cambiar archivo' : 'Elegir archivo CSV'}
          </Button>
          {file ? (
            <span className="text-sm">
              {file.name}{' '}
              <span className="text-muted-foreground">({formatNumber(Math.round(file.size / 1024))} KB)</span>
            </span>
          ) : null}
        </div>
        <Button onClick={upload} disabled={!file || create.isPending} size="lg">
          {create.isPending ? <Spinner /> : <UploadIcon data-icon="inline-start" />}
          Subir y ver el diff
        </Button>
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
