import { CircleAlertIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { ImportChange, ImportPreview } from '@/api/schemas'
import { Section } from '@/components/Section'
import { Stat } from '@/components/Stat'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber, plural } from '@/lib/format'

/** `A1-1` → `A1`, `P-A-23` → `P-A`. */
export function expansionOf(cardId: string): string {
  const cut = cardId.lastIndexOf('-')
  return cut > 0 ? cardId.slice(0, cut) : cardId
}

export interface ChangeGroup {
  expansion: string
  changes: ImportChange[]
}

/** Keeps the API order (expansion/number) and groups consecutive changes by expansion. */
export function groupChangesByExpansion(changes: readonly ImportChange[]): ChangeGroup[] {
  const groups: ChangeGroup[] = []
  for (const change of changes) {
    const expansion = expansionOf(change.stockCardId)
    const last = groups[groups.length - 1]
    if (last && last.expansion === expansion) last.changes.push(change)
    else groups.push({ expansion, changes: [change] })
  }
  return groups
}

export function describeChange(change: ImportChange): string {
  const after = change.after.amountOwned
  // A unit the collection did not have yet: the count says it all.
  if (change.before === null) return `0 → ${after} · nueva`
  const before = change.before.amountOwned
  const parts: string[] = []
  if (before !== after) parts.push(`${before} → ${after}`)
  if (change.before.collected !== change.after.collected) {
    parts.push(change.after.collected ? 'ahora coleccionada' : 'ya no coleccionada')
  }
  return parts.length > 0 ? parts.join(' · ') : 'sin cambios'
}

function signed(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value)
}

export interface ImportPreviewViewProps {
  preview: ImportPreview
  /** Optional: «retirar» button for adjustments that already match the CSV (resolution `csv_matches`). */
  onResolveAdjustment?: (adjustmentId: string) => void
  resolvingId?: string | null
}

export function ImportPreviewView({ preview, onResolveAdjustment, resolvingId }: ImportPreviewViewProps) {
  const groups = groupChangesByExpansion(preview.changes)
  const hasBlockingErrors = preview.errors.length > 0 || preview.twinConflicts.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="text-sm text-muted-foreground">
        {preview.fileName ?? 'CSV pegado'} · {formatDateTime(preview.importedAt)}
        {preview.bom !== undefined ? ` · ${preview.bom ? 'con BOM' : 'sin BOM'}` : ''}
        {preview.lineEnding ? ` · ${preview.lineEnding}` : ''}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Filas" value={formatNumber(preview.rowCount)} />
        <Stat label="Suma ingenua" value={formatNumber(preview.naiveTotal)} hint="sumando las gemelas dos veces" />
        <Stat
          label="Copias (deduplicadas)"
          value={formatNumber(preview.dedupTotal)}
          hint="una vez por unidad de stock"
        />
        <Stat label="Unidades que cambian" value={formatNumber(preview.summary.unitsChanged)} />
        <Stat label="Copias" value={signed(preview.summary.copiesDelta)} hint="diferencia neta" />
        <Stat label="Unidades nuevas" value={formatNumber(preview.summary.newUnits)} />
        <Stat label="Unidades a cero" value={formatNumber(preview.summary.zeroedUnits)} />
        <Stat label="«Coleccionada» cambia" value={formatNumber(preview.summary.collectedChanged)} />
      </div>

      {preview.errors.length > 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{plural(preview.errors.length, 'error en el archivo', 'errores en el archivo')}</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {preview.errors.map((error) => (
                <li key={`${error.line ?? '-'}:${error.code}:${error.message}`}>
                  {error.line !== null ? <span className="font-mono text-xs">línea {error.line}: </span> : null}
                  {error.message} <span className="font-mono text-xs">({error.code})</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {preview.unknownIds.length > 0 ? (
        <Section title={`Ids desconocidos (${preview.unknownIds.length})`}>
          <p className="text-sm text-muted-foreground">
            El catálogo no tiene estas cartas; quizá haga falta sincronizarlo. Se ignoran al aplicar.
          </p>
          <div className="flex flex-wrap gap-1">
            {preview.unknownIds.map((id) => (
              <Badge key={id} variant="outline" className="font-mono">
                {id}
              </Badge>
            ))}
          </div>
        </Section>
      ) : null}

      {preview.twinConflicts.length > 0 ? (
        <Section title={`Gemelas con valores distintos (${preview.twinConflicts.length})`}>
          <p className="text-sm text-muted-foreground">
            Dos filas de la misma unidad de stock traen cantidades distintas. Corregí el archivo en el tracker antes de
            aplicar.
          </p>
          <ul className="flex flex-col gap-2">
            {preview.twinConflicts.map((conflict) => (
              <li key={conflict.stockCardId} className="rounded-lg border p-2 text-sm">
                <div className="font-mono font-medium">{conflict.stockCardId}</div>
                <ul className="text-muted-foreground">
                  {conflict.rows.map((row) => (
                    <li key={`${row.cardId}-${row.line}`} className="font-mono text-xs">
                      línea {row.line}: {row.cardId} = {row.amountOwned}
                      {row.collected ? ' ✓' : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {preview.adjustmentsMatching.length > 0 ? (
        <Section title="Ajustes que ya coinciden">
          <p className="text-sm text-muted-foreground">
            El CSV ya trae las copias que fijaba el ajuste. Si lo retirás, vale el stock importado.
          </p>
          <ul className="divide-y rounded-lg border">
            {preview.adjustmentsMatching.map((item) => (
              <li key={item.adjustmentId} className="flex min-h-12 items-center gap-2 px-3 py-2 text-sm">
                <Link
                  to={`/grupos/${encodeURIComponent(item.groupId)}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {item.nameEs}
                </Link>
                <span className="text-muted-foreground tabular">ajuste {item.playableCopies}</span>
                {onResolveAdjustment ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolvingId === item.adjustmentId}
                    onClick={() => onResolveAdjustment(item.adjustmentId)}
                  >
                    Retirar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {preview.adjustmentsHidingChange.length > 0 ? (
        <Section title="Ajustes que esconden un cambio">
          <p className="text-sm text-muted-foreground">
            La suma del stock cambió pero el ajuste sigue pisándola. Revisalos después de aplicar.
          </p>
          <ul className="divide-y rounded-lg border">
            {preview.adjustmentsHidingChange.map((item) => (
              <li key={item.adjustmentId} className="flex min-h-12 items-center gap-2 px-3 py-2 text-sm">
                <Link
                  to={`/grupos/${encodeURIComponent(item.groupId)}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {item.nameEs}
                </Link>
                <span className="text-muted-foreground tabular">
                  stock {item.sumBefore} → {item.sumAfter} · ajuste {item.playableCopies}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={`Cambios (${formatNumber(preview.changes.length)})`}>
        {preview.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">El CSV coincide con la colección: no hay nada que aplicar.</p>
        ) : null}
        {groups.map((group, index) => (
          <details key={group.expansion} open={groups.length <= 3 || index === 0} className="rounded-lg border">
            <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-3 py-2 font-medium select-none">
              <span className="font-mono">{group.expansion}</span>
              <span className="text-sm text-muted-foreground">{plural(group.changes.length, 'cambio', 'cambios')}</span>
            </summary>
            <ul className="divide-y border-t">
              {group.changes.map((change) => (
                <li key={change.stockCardId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{change.nameEs}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {change.cardIds.join(', ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular">{describeChange(change)}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </Section>

      {hasBlockingErrors ? (
        <p className="text-sm text-destructive">
          Hay errores en el archivo: corregilo y volvé a subirlo antes de aplicar.
        </p>
      ) : null}
    </div>
  )
}
