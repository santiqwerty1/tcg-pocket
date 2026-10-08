/**
 * Tournament settings (Fase 5): the era table (release dates; Deluxe packs do not open an era), the minimum size of a
 * tournament, the sync with Limitless and what it found that the catalog does not know yet.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { SetReleaseInfo } from '@/api/schemas'
import { useSetSetting, useSettings } from '@/api/settings'
import {
  useSaveSetRelease,
  useSetReleases,
  useStartSync,
  useTournamentEvents,
  useTournamentStatus,
  useUnknownCards,
} from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ago, formatCount, formatDayEs } from '@/lib/tournaments'

function SetRow({ set, onSave }: { set: SetReleaseInfo; onSave: (set: SetReleaseInfo) => void }) {
  return (
    <li className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 px-3 py-1.5 text-sm">
      <span className="font-mono">{set.code}</span>
      <div className="min-w-0">
        <div className="truncate">{set.nameEs ?? set.nameEn}</div>
        <Input
          type="date"
          aria-label={`Lanzamiento de ${set.code}`}
          className="h-8 w-40"
          defaultValue={set.releaseDate}
          onBlur={(event) => {
            if (event.target.value && event.target.value !== set.releaseDate) {
              onSave({ ...set, releaseDate: event.target.value })
            }
          }}
        />
      </div>
      <Label className="flex items-center gap-1.5 text-xs font-normal">
        <Switch
          checked={set.opensEra}
          aria-label={`${set.code} abre era`}
          onCheckedChange={(opensEra) => onSave({ ...set, opensEra })}
        />
        era
      </Label>
    </li>
  )
}

function NewSet({ onSave }: { onSave: (set: SetReleaseInfo) => void }) {
  const [code, setCode] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const ready = /^[A-Za-z0-9-]{1,8}$/.test(code) && nameEn.trim() !== '' && releaseDate !== ''
  return (
    <form
      className="grid grid-cols-[5rem_1fr] gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        onSave({ code, nameEn: nameEn.trim(), nameEs: null, releaseDate, opensEra: true })
        setCode('')
        setNameEn('')
        setReleaseDate('')
      }}
    >
      <Input
        aria-label="Código del set"
        placeholder="B5"
        value={code}
        onChange={(e) => setCode(e.target.value.trim())}
      />
      <Input
        aria-label="Nombre en inglés"
        placeholder="Nombre en inglés"
        value={nameEn}
        onChange={(e) => setNameEn(e.target.value)}
      />
      <Input
        type="date"
        aria-label="Fecha de lanzamiento"
        value={releaseDate}
        onChange={(e) => setReleaseDate(e.target.value)}
      />
      <Button type="submit" variant="outline" disabled={!ready}>
        Agregar set
      </Button>
    </form>
  )
}

export function TorneosAjustesPage() {
  const status = useTournamentStatus()
  const sets = useSetReleases()
  const saveSet = useSaveSetRelease()
  const settings = useSettings()
  const setSetting = useSetSetting()
  const startSync = useStartSync()
  const [showDetails, setShowDetails] = useState(false)
  const events = useTournamentEvents({}, showDetails)
  const unknown = useUnknownCards({}, showDetails)
  const savedMin = typeof settings.data?.minPlayers === 'number' ? settings.data.minPlayers : null
  const [minPlayers, setMinPlayers] = useState<string | null>(null)

  async function save(set: SetReleaseInfo) {
    try {
      await saveSet.mutateAsync(set)
      toast.success(`${set.code} guardado: las eras se recalculan.`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function sync(backfillDays?: number) {
    try {
      const result = (await startSync.mutateAsync(backfillDays)) as { started?: boolean } | undefined
      toast.success(result?.started === false ? 'Ya hay una sincronización en curso.' : 'Sincronización iniciada.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Sincronización con Limitless">
        {status.isPending ? <LoadingRows rows={2} /> : null}
        {status.isError ? <ErrorState error={status.error} onRetry={() => status.refetch()} /> : null}
        {status.data ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">
              {formatCount(status.data.sync.counts.complete)} torneos bajados ·{' '}
              {formatCount(status.data.sync.counts.listed)} pendientes o chicos ·{' '}
              {formatCount(status.data.sync.counts.excluded)} excluidos (reglas caseras, sin listas, bans) ·{' '}
              {formatCount(status.data.sync.counts.failed + status.data.sync.counts.incomplete)} para reintentar.
              {status.data.sync.newestTournament
                ? ` El más nuevo es del ${formatDayEs(status.data.sync.newestTournament)}.`
                : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              {status.data.sync.callsInWindow} llamadas en los últimos 5 minutos (tope propio: 40; Limitless permite
              50).
              {status.data.sync.lastRun
                ? ` Última corrida ${ago(status.data.sync.lastRun.startedAt)}: ${status.data.sync.lastRun.calls} llamadas, ${status.data.sync.lastRun.tournamentsDone} torneos.`
                : ''}
              {status.data.sync.enabled
                ? ' Corre sola cada 6 horas.'
                : ' La sincronización automática está apagada en este entorno.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => sync()} disabled={status.data.sync.running}>
                Sincronizar ahora
              </Button>
              <Button size="sm" variant="outline" onClick={() => sync(120)} disabled={status.data.sync.running}>
                Bajar 120 días
              </Button>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Torneos que cuentan">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="min-players" className="text-sm">
              Jugadores mínimos por torneo
            </Label>
            <Input
              id="min-players"
              inputMode="numeric"
              className="w-28"
              value={minPlayers ?? String(savedMin ?? status.data?.minPlayers ?? 12)}
              onChange={(event) => setMinPlayers(event.target.value.replace(/\D/g, ''))}
            />
          </div>
          <Button
            variant="outline"
            disabled={minPlayers === null || minPlayers === '' || Number(minPlayers) < 1}
            onClick={() => {
              setSetting.mutate(
                { key: 'minPlayers', value: Number(minPlayers) },
                {
                  onSuccess: () => {
                    toast.success(
                      'Guardado. Si bajaste el mínimo, la próxima sincronización baja los torneos más chicos.',
                    )
                    setMinPlayers(null)
                    void status.refetch()
                  },
                },
              )
            }}
          >
            Guardar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          12 reproduce los torneos que Limitless muestra para cada era. Los torneos CUSTOM (reglas caseras), sin listas
          o con cartas prohibidas no cuentan nunca.
        </p>
      </Section>

      <Section title="Tabla de eras">
        <p className="text-xs text-muted-foreground">
          La era de un torneo es el último set que abre era lanzado hasta su fecha (en UTC). Los Deluxe no abren era.
          Cuando salga un set, agregalo con su fecha.
        </p>
        {sets.isPending ? <LoadingRows rows={4} /> : null}
        {sets.isError ? <ErrorState error={sets.error} onRetry={() => sets.refetch()} /> : null}
        <NewSet onSave={save} />
        <ul className="divide-y rounded-lg border">
          {(sets.data ?? []).map((set) => (
            <SetRow key={`${set.code}:${set.releaseDate}:${set.opensEra}`} set={set} onSave={save} />
          ))}
        </ul>
      </Section>

      <Section title="Detalle de la era vigente">
        {!showDetails ? (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setShowDetails(true)}>
            Ver torneos y cartas desconocidas
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">
                Cartas que el catálogo no conoce ({unknown.data?.cards.length ?? '…'})
              </h3>
              {unknown.data && unknown.data.cards.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ninguna: todas las cartas de las listas están en el catálogo.
                </p>
              ) : (
                <ul className="divide-y rounded-lg border text-sm">
                  {(unknown.data?.cards ?? []).map((card) => (
                    <li key={card.ref} className="flex gap-2 px-3 py-1.5">
                      <code className="font-mono text-xs">{card.ref}</code>
                      <span className="min-w-0 flex-1 truncate">{card.name}</span>
                      <span className="text-xs text-muted-foreground">{card.occurrences}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Torneos ({events.data?.rows.length ?? '…'})</h3>
              <ul className="divide-y rounded-lg border text-sm">
                {(events.data?.rows ?? []).map((row) => (
                  <li key={row.id} className="flex flex-col gap-0.5 px-3 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <a
                        href={`https://play.limitlesstcg.com/tournament/${row.id}/standings`}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        {row.name}
                      </a>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDayEs(row.date)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.players} jugadores · {row.lists} listas
                      {row.organizerName ? ` · ${row.organizerName}` : ''}
                      {row.conflict ? ` · cartas de ${row.conflict} (¿pre-release?)` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
