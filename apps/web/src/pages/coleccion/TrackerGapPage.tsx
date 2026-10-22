import { CircleAlertIcon, DownloadIcon, RefreshCwIcon } from 'lucide-react'
import { Link } from 'react-router'
import { isApiError, saveBlob } from '@/api/client'
import { type TrackerGap, type TrackerGapRow, useTrackerGap } from '@/api/dotgg'
import { ErrorState, Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Stat } from '@/components/Stat'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatNumber, plural } from '@/lib/format'

/** Consecutive rows of one expansion (the API sends them in catalog order). */
function byExpansion(rows: readonly TrackerGapRow[]): { expansion: string; rows: TrackerGapRow[] }[] {
  const groups: { expansion: string; rows: TrackerGapRow[] }[] = []
  for (const row of rows) {
    const last = groups[groups.length - 1]
    if (last && last.expansion === row.expansionId) last.rows.push(row)
    else groups.push({ expansion: row.expansionId, rows: [row] })
  }
  return groups
}

function signed(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value)
}

const SKELETONS = ['a', 'b', 'c', 'd']

/**
 * T-020, «Tracker al día»: the tracker against the game (ptcgpocket.gg, read now), card by card, and the file that
 * brings the tracker up to date. Nothing in the app changes here.
 */
export function TrackerGapPage() {
  const gap = useTrackerGap()
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Compara tu colección del juego (ptcgpocket.gg, leída ahora) con la del tracker, carta por carta, para que el
        tracker ofrezca intercambios con los números de verdad. Acá no cambia nada de la app.
      </p>
      {gap.isPending ? (
        <output aria-busy="true" aria-label="Leyendo las colecciones" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Leyendo ptcgpocket.gg y el tracker…
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SKELETONS.map((id) => (
              <Skeleton key={id} className="h-20" />
            ))}
          </div>
        </output>
      ) : gap.isError ? (
        <>
          <ErrorState error={gap.error} onRetry={() => gap.refetch()} />
          {isApiError(gap.error) && ['dotgg_not_configured', 'tracker_friend_id'].includes(gap.error.code) ? (
            <Link to="/mas/ajustes" className="text-sm underline">
              Ir a Más → Ajustes de la app
            </Link>
          ) : null}
        </>
      ) : (
        <GapView gap={gap.data} refreshing={gap.isFetching} onRefresh={() => void gap.refetch()} />
      )}
    </div>
  )
}

function GapView({ gap, refreshing, onRefresh }: { gap: TrackerGap; refreshing: boolean; onRefresh: () => void }) {
  const s = gap.summary
  const groups = byExpansion(gap.rows)
  const file = gap.trackerFile
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Leído {formatDateTime(gap.checkedAt)}</span>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
          Volver a comparar
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Cartas que difieren" value={formatNumber(s.cards)} />
        <Stat
          label={s.copiesMissing === 1 ? 'Le falta al tracker' : 'Le faltan al tracker'}
          value={plural(s.copiesMissing, 'copia', 'copias')}
          hint={`en ${plural(s.cardsMissing, 'carta', 'cartas')}`}
        />
        <Stat
          label={s.copiesExtra === 1 ? 'Le sobra al tracker' : 'Le sobran al tracker'}
          value={plural(s.copiesExtra, 'copia', 'copias')}
          hint={`en ${plural(s.cardsExtra, 'carta', 'cartas')}`}
        />
        <Stat label="Juego" value={formatNumber(s.gameCopies)} hint="copias en ptcgpocket.gg" />
        <Stat label="Tracker" value={formatNumber(s.trackerCopies)} hint="copias en el tracker" />
      </div>

      {gap.warnings.length > 0 ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>No se compara todo</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {gap.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {s.cards === 0 ? (
        <p className="rounded-lg border px-3 py-2 text-sm">
          El tracker está al día con el juego: no hay nada que cambiar.
        </p>
      ) : null}

      {file ? (
        <Section title="Archivo para el tracker">
          <Button
            size="lg"
            onClick={() => saveBlob(new Blob([file.content], { type: 'text/csv;charset=utf-8' }), file.fileName)}
          >
            <DownloadIcon data-icon="inline-start" />
            Archivo para el tracker
          </Button>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>
              Bajá el archivo: trae solo las {plural(file.rows, 'carta que difiere', 'cartas que difieren')}, con el
              número del juego.
            </li>
            <li>
              En el tracker (tcgpocketcollectiontracker.com), con tu sesión iniciada, abrí el menú de tu cuenta →
              Import/Export, pestaña Import, y arrastrá el archivo (o tocá el recuadro y elegilo). El aviso dice que
              reemplaza la colección, pero solo cambian las cartas del archivo.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Una carta que queda en 0 sigue marcada como registrada si el tracker ya la tenía así.
          </p>
        </Section>
      ) : null}

      {groups.length > 0 ? (
        <Section title={`Diferencias (${formatNumber(s.cards)})`}>
          {groups.map((group, index) => (
            <details key={group.expansion} open={groups.length <= 3 || index === 0} className="rounded-lg border">
              <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-3 py-2 font-medium select-none">
                <span className="font-mono">{group.expansion}</span>
                <span className="text-sm text-muted-foreground">{plural(group.rows.length, 'carta', 'cartas')}</span>
              </summary>
              <ul className="divide-y border-t">
                {group.rows.map((row) => (
                  <li key={row.stockCardId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{row.nameEs}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {row.cardIds.join(', ')} · {row.rarity}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular">
                      <span className="block">
                        tracker {formatNumber(row.tracker)} → juego {formatNumber(row.game)}
                      </span>
                      <span className={row.delta > 0 ? 'block text-xs' : 'block text-xs text-muted-foreground'}>
                        {signed(row.delta)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </Section>
      ) : null}

      {gap.unmatchedGame.length > 0 ? (
        <Section title={`Cartas del juego que el catálogo no tiene (${formatNumber(gap.unmatchedGame.length)})`}>
          <ul className="divide-y rounded-lg border">
            {gap.unmatchedGame.map((row) => (
              <li key={`${row.set}-${row.number}`} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{row.name || 'Sin nombre'}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {row.set}-{row.number}
                  </span>
                </span>
                <span className="shrink-0 tabular">{plural(row.copies, 'copia', 'copias')}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}
