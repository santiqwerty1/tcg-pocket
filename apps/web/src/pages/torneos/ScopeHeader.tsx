/**
 * Era and format of the tournament screens, with what the numbers stand on: tournaments, lists, the era mean (the
 * baseline, not 50 %), the state of the sync and the warnings (likely new era, pre-release lists, unknown cards).
 */
import { RefreshCwIcon, SettingsIcon, TriangleAlertIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { TournamentFormat, TournamentScope, TournamentStatus } from '@/api/schemas'
import type { TournamentScopeParams } from '@/api/tournaments'
import { RateDetails } from '@/components/RateSummary'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatRateValue } from '@/lib/matches'
import { ago, FORMAT_LABEL, formatCount, formatDayEs } from '@/lib/tournaments'

export function ScopePicker({
  status,
  scope,
  onChange,
}: {
  status: TournamentStatus
  scope: TournamentScopeParams
  onChange: (scope: TournamentScopeParams) => void
}) {
  const current = status.currentEra?.code
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
      <Select
        value={scope.era ?? current ?? ''}
        onValueChange={(era) => onChange({ ...scope, era: era === current ? undefined : era })}
      >
        <SelectTrigger aria-label="Era" className="w-full min-w-0 [&>span]:truncate">
          <SelectValue placeholder="Era" />
        </SelectTrigger>
        <SelectContent>
          {status.eras.map((era) => (
            <SelectItem key={era.code} value={era.code}>
              {era.code} · {era.nameEs}
              {era.current ? ' (vigente)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={scope.format ?? 'STANDARD'}
        onValueChange={(format) =>
          onChange({ ...scope, format: format === 'NOEX' ? 'NOEX' : (undefined as TournamentFormat | undefined) })
        }
      >
        <SelectTrigger aria-label="Formato" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="STANDARD">{FORMAT_LABEL.STANDARD}</SelectItem>
          <SelectItem value="NOEX">{FORMAT_LABEL.NOEX}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

/** «B4a · Ambición del Team Rocket · desde 27/8/2026 · 154 torneos · 12.223 listas · media 46,7 %». */
export function ScopeSummary({ scope }: { scope: TournamentScope }) {
  const { era } = scope
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-sm">
      <div>
        <span className="font-medium">
          {era.code} · {era.nameEs}
        </span>
        <span className="text-muted-foreground">
          {' '}
          · desde el {formatDayEs(era.from)}
          {era.to ? ` hasta el ${formatDayEs(era.to)}` : ''} · {FORMAT_LABEL[scope.format]} · torneos de{' '}
          {scope.minPlayers} jugadores o más
        </span>
      </div>
      <div className="text-muted-foreground">
        {formatCount(scope.tournaments)} {scope.tournaments === 1 ? 'torneo' : 'torneos'} · {formatCount(scope.lists)}{' '}
        {scope.lists === 1 ? 'lista' : 'listas'}
      </div>
      {scope.mean.rate ? (
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          <div>
            Media de la era:{' '}
            <span className="font-semibold text-foreground">{formatRateValue(scope.mean.rate.value)}</span>
          </div>
          <RateDetails record={scope.mean.record} rate={scope.mean.rate} />
          <div>
            Cuenta empates y abandonos: un mazo por encima de la media rinde más que el promedio, aunque esté debajo de
            50 %.
          </div>
        </div>
      ) : null}
      {scope.conflicts.length > 0 ? (
        <div className="flex gap-1.5 text-xs text-warning">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {scope.conflicts.length === 1 ? '1 torneo trae' : `${scope.conflicts.length} torneos traen`} cartas de un set
          posterior a su fecha ({[...new Set(scope.conflicts.map((c) => c.set))].join(', ')}): ¿falta un set en la tabla
          de eras?
        </div>
      ) : null}
      {scope.unknownCards > 0 ? (
        <div className="text-xs text-warning">
          {scope.unknownCards} cartas de las listas todavía no están en el catálogo: esas listas no cuentan por carta
          funcional.
        </div>
      ) : null}
    </div>
  )
}

export function SyncLine({
  status,
  onSync,
  syncing,
}: {
  status: TournamentStatus
  onSync: () => void
  syncing: boolean
}) {
  const { sync } = status
  const progress = sync.progress
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      {status.newEra?.likely ? (
        <div className="flex gap-1.5 text-warning">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Era nueva probable: pasaron {status.newEra.days} días desde {status.newEra.lastRelease} (
          {formatDayEs(status.newEra.releaseDate)}). Si salió un set, cargalo en la tabla de eras.
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span>
          {progress
            ? `Sincronizando con Limitless: ${progress.done} de ${progress.pending} torneos (${progress.calls} llamadas)${progress.current ? ` · ${progress.current}` : ''}`
            : sync.lastRun
              ? `Última sincronización ${ago(sync.lastRun.finishedAt ?? sync.lastRun.startedAt)} (${sync.lastRun.status === 'done' ? 'completa' : sync.lastRun.status === 'failed' ? `falló: ${sync.lastRun.error ?? ''}` : 'cortada, sigue en la próxima'})`
              : 'Todavía no se sincronizó con Limitless.'}
          {sync.enabled ? ' · automática cada 6 h' : ''}
        </span>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onSync} disabled={sync.running || syncing}>
            <RefreshCwIcon data-icon="inline-start" className={sync.running ? 'animate-spin' : undefined} />
            {sync.running ? 'En curso' : 'Sincronizar'}
          </Button>
          <Button size="icon-sm" variant="ghost" asChild aria-label="Ajustes de torneos">
            <Link to="/torneos/ajustes">
              <SettingsIcon />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
