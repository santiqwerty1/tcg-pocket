import { DownloadIcon, FileTextIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { downloadBackupBlob, exportBackup, useBackupBlobs, useBackupDryRun, useBackupReplace } from '@/api/backup'
import { errorMessage } from '@/api/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { KeyValue, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDateTime, shortSha } from '@/lib/format'

function DiffTree({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <span className="tabular">{String(value)}</span>
  if (Array.isArray(value)) return <span className="tabular">{value.length} elementos</span>
  const entries = Object.entries(value as Record<string, unknown>)
  return (
    <ul className="ml-3 flex flex-col gap-0.5 border-l pl-2">
      {entries.map(([key, child]) => (
        <li key={key} className="text-sm">
          <span className="text-muted-foreground">{key}: </span>
          <DiffTree value={child} />
        </li>
      ))}
    </ul>
  )
}

export function BackupPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [exporting, setExporting] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const dryRun = useBackupDryRun()
  const replace = useBackupReplace()
  const blobs = useBackupBlobs()

  async function doExport() {
    setExporting(true)
    try {
      const name = await exportBackup()
      toast.success(`Descargado ${name}`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  async function preview() {
    if (!file) return
    try {
      await dryRun.mutateAsync(file)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function doReplace() {
    if (!file) return
    try {
      const result = await replace.mutateAsync(file)
      toast.success('Copia restaurada')
      dryRun.reset()
      setFile(null)
      console.info('backup replace counts', result.counts)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setConfirmReplace(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Exportar">
        <p className="text-sm text-muted-foreground">
          Todo lo tuyo en un archivo: colección, ajustes, mazos, configuración. Sin contraseña ni secretos.
        </p>
        <Button onClick={doExport} disabled={exporting} size="lg">
          {exporting ? <Spinner /> : <DownloadIcon data-icon="inline-start" />}
          Descargar copia de seguridad
        </Button>
      </Section>

      <Section title="Restaurar">
        <p className="text-sm text-muted-foreground">
          Primero una vista previa (no cambia nada); después «Reemplazar todo» borra los datos actuales y carga los del
          archivo en una sola transacción.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".gz,.json,application/gzip,application/json"
          className="sr-only"
          aria-label="Archivo de copia de seguridad"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            dryRun.reset()
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <FileTextIcon data-icon="inline-start" />
            {file ? 'Cambiar archivo' : 'Elegir archivo'}
          </Button>
          {file ? (
            <span className="text-sm">
              {file.name} <span className="text-muted-foreground">({formatBytes(file.size)})</span>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={preview} disabled={!file || dryRun.isPending}>
            {dryRun.isPending ? <Spinner /> : null}
            Vista previa
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirmReplace(true)}
            disabled={!file || !dryRun.data || replace.isPending}
          >
            {replace.isPending ? <Spinner /> : null}
            Reemplazar todo
          </Button>
        </div>
        {dryRun.isError ? <ErrorState error={dryRun.error} /> : null}
        {dryRun.data ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <KeyValue
              items={[
                { label: 'Esquema', value: String(dryRun.data.schemaVersion) },
                { label: 'Catálogo', value: <code className="font-mono">{shortSha(dryRun.data.catalogCommit)}</code> },
              ]}
            />
            <div className="text-sm font-medium">Diferencias</div>
            <DiffTree value={dryRun.data.diff} />
          </div>
        ) : null}
      </Section>

      <Section title="Copias diarias guardadas">
        {blobs.isPending ? <LoadingRows rows={3} /> : null}
        {blobs.isError ? <ErrorState error={blobs.error} onRetry={() => blobs.refetch()} /> : null}
        {blobs.data && blobs.data.length === 0 ? <EmptyState title="Todavía no hay copias diarias" /> : null}
        {blobs.data && blobs.data.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {blobs.data.map((blob) => (
              <li key={blob.id} className="flex min-h-12 items-center gap-2 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{formatDateTime(blob.createdAt)}</span>
                <span className="text-muted-foreground tabular">{formatBytes(blob.sizeBytes)}</span>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label="Descargar"
                  onClick={() =>
                    downloadBackupBlob(blob.id, blob.createdAt).catch((error) => toast.error(errorMessage(error)))
                  }
                >
                  <DownloadIcon />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <ConfirmDialog
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        title="¿Reemplazar todos los datos?"
        description="Se borran la colección, los ajustes, los mazos y la configuración actuales y se cargan los del archivo. No se puede deshacer (salvo con otra copia)."
        confirmLabel="Reemplazar todo"
        destructive
        pending={replace.isPending}
        onConfirm={doReplace}
      />
    </div>
  )
}
