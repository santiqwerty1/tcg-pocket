/**
 * Calibración contra torneos (R-012): the meta bank of the Laboratorio played against itself by a chosen bot, next
 * to what the same archetypes did against each other in tournaments of the era. Simulation and tournaments stay
 * apart: each with its own rate, n and interval; the report only says how often and how well they agree.
 */
import { ArrowLeftIcon, CheckIcon, MinusIcon, PlayIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import {
  type CalibrationSummary,
  type CalibrationView,
  type RankCorrelation,
  useCalibration,
  useCalibrations,
  useStartCalibration,
} from '@/api/calibration'
import { errorMessage } from '@/api/client'
import { useEngineInfo } from '@/api/simulations'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, shortSha } from '@/lib/format'
import { formatRate, formatRateValue } from '@/lib/matches'
import { progressFraction } from '@/lib/simulation'
import { ProgressBar, StatusBadge } from './SimulacionPage'

const decimal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const points = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

/** «ρ = 0,45 (IC 0,12–0,69; 40 cruces)». */
function formatRho(correlation: RankCorrelation | null, unit: string): string {
  if (!correlation) return 'sin datos suficientes'
  const interval = correlation.ci95
    ? `IC ${decimal.format(correlation.ci95[0])}–${decimal.format(correlation.ci95[1])}; `
    : ''
  return `ρ = ${decimal.format(correlation.rho)} (${interval}${correlation.n} ${unit})`
}

function SummaryLine({ summary }: { summary: NonNullable<CalibrationSummary['summary']> }) {
  if (summary.compared === 0) {
    return <p className="text-xs text-muted-foreground">Ningún cruce con partidas de torneo suficientes.</p>
  }
  return (
    <p className="text-xs text-muted-foreground">
      Dentro del intervalo de torneo: {summary.inside} de {summary.compared} · diferencia media{' '}
      {summary.meanAbsDifference === null ? '—' : `${points.format(summary.meanAbsDifference).replace('+', '')} puntos`}{' '}
      · orden: {formatRho(summary.rankCorrelation, 'cruces')}
    </p>
  )
}

export function CalibrationPage() {
  const engine = useEngineInfo()
  const calibrations = useCalibrations()
  const start = useStartCalibration()
  const [bot, setBot] = useState('e2')
  const [games, setGames] = useState('200')
  const bots = engine.data?.bots ?? [{ code: 'e2', label: 'expectiminimax, profundidad 2' }]

  function launch() {
    const gamesPerPair = Number(games)
    if (!Number.isInteger(gamesPerPair) || gamesPerPair < 10 || gamesPerPair > 2000) {
      toast.error('Partidas por cruce: de 10 a 2.000.')
      return
    }
    start.mutate(
      { bot, gamesPerPair },
      {
        onSuccess: (job) => toast.success(`Calibración encolada (simulación #${job.id})`),
        onError: (error) => toast.error(errorMessage(error)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Calibración contra torneos"
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/simulacion">
              <ArrowLeftIcon data-icon="inline-start" />
              Simulaciones
            </Link>
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Juega el banco del meta (las listas que usa el Laboratorio) entre sí con el bot que elijas y lo pone, cruce
          por cruce, al lado de lo que hicieron esos arquetipos en los torneos de la era. Sirve para ver cuánto se
          parece cada bot a la gente antes de confiar en sus números.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Field label="Bot (los dos lados)">
            <Select value={bot} onValueChange={setBot}>
              <SelectTrigger className="w-full" aria-label="Bot">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bots.map((item) => (
                  <SelectItem key={item.code} value={item.code}>
                    {item.code} · {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Partidas por cruce" htmlFor="calibration-games">
            <Input
              id="calibration-games"
              inputMode="numeric"
              value={games}
              onChange={(event) => setGames(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
        <div>
          <Button onClick={launch} disabled={start.isPending}>
            <PlayIcon data-icon="inline-start" />
            Calibrar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Con 15 listas son 105 cruces: con 200 partidas por cruce, 21.000 partidas (unos minutos del worker con e2).
        </p>
      </Section>
      <Section title="Calibraciones">
        {calibrations.isPending ? (
          <LoadingRows />
        ) : calibrations.isError ? (
          <ErrorState error={calibrations.error} onRetry={() => calibrations.refetch()} />
        ) : calibrations.data.length === 0 ? (
          <EmptyState
            title="Sin calibraciones todavía"
            description="Elegí un bot y tocá «Calibrar»: el worker de la PC juega el banco y acá aparece la comparación."
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {calibrations.data.map((item) => (
              <li key={item.id} className="flex flex-col gap-1.5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/simulacion/calibracion/${item.id}`} className="font-medium text-primary hover:underline">
                    {item.botEs}
                  </Link>
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-muted-foreground">
                    {item.era} · {item.lists} listas · {item.gamesPerPair} por cruce · motor {shortSha(item.engineRev)}{' '}
                    · {formatDateTime(item.createdAt)}
                  </span>
                </div>
                {item.status === 'queued' || item.status === 'running' ? (
                  <ProgressBar fraction={progressFraction(item)} />
                ) : null}
                {item.summary ? <SummaryLine summary={item.summary} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Inside({ value }: { value: boolean | null }) {
  if (value === null) return <MinusIcon className="size-4 text-muted-foreground" aria-label="sin juzgar" />
  return value ? (
    <CheckIcon className="size-4 text-success" aria-label="dentro" />
  ) : (
    <XIcon className="size-4 text-destructive" aria-label="fuera" />
  )
}

function Report({ view }: { view: CalibrationView }) {
  const { report } = view
  const rows = [...report.rows].sort((x, y) => Math.abs(y.difference ?? -1) - Math.abs(x.difference ?? -1))
  const archetypes = [...report.archetypes].sort((x, y) => (y.tournament ?? -1) - (x.tournament ?? -1))
  return (
    <>
      <Section title="Resumen">
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            Cruces con partidas de torneo suficientes (≥ {report.minTournamentGames}): {report.compared} de{' '}
            {report.rows.length}
            {view.pending > 0 ? ` (faltan ${view.pending} por jugar)` : ''}.
          </li>
          <li>
            El simulado cae dentro del intervalo del torneo en {report.inside} de {report.compared}.
          </li>
          <li>
            Diferencia media:{' '}
            {report.meanAbsDifference === null
              ? '—'
              : `${points.format(report.meanAbsDifference).replace('+', '')} puntos`}
            .
          </li>
          <li>Orden de los cruces: {formatRho(report.rankCorrelation, 'cruces')}.</li>
          <li>Orden de los arquetipos contra el banco: {formatRho(report.archetypeCorrelation, 'arquetipos')}.</li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Torneos: {view.tournaments.era}, {view.tournaments.matches} partidas de{' '}
          {view.tournaments.tournamentsWithPairings} torneos con rondas. Las dos fuentes no se mezclan: cada una con su
          n e intervalo. Todo por partida y sin empates (los del motor salen del límite de 30 turnos; se cuentan
          aparte).
        </p>
      </Section>
      <Section title="Arquetipos contra el resto del banco">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Arquetipo</TableHead>
              <TableHead>Simulado</TableHead>
              <TableHead>Torneo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {archetypes.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.label}</TableCell>
                <TableCell>{row.simulated === null ? '—' : formatRateValue(row.simulated)}</TableCell>
                <TableCell>
                  {row.tournament === null
                    ? `menos de ${report.minTournamentGames} partidas por cruce`
                    : `${formatRateValue(row.tournament)} (${row.rivalsWithData} rivales)`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">Promedios pesados por la cuota de cada rival en el meta.</p>
      </Section>
      <Section title="Cruce por cruce">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cruce</TableHead>
              <TableHead>Simulado</TableHead>
              <TableHead>Torneo</TableHead>
              <TableHead>Diferencia</TableHead>
              <TableHead>Dentro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.a}|${row.b}`}>
                <TableCell>
                  {row.labelA} <span className="text-muted-foreground">vs</span> {row.labelB}
                </TableCell>
                <TableCell>
                  {formatRate(row.simulated)}
                  {row.ties > 0 ? <span className="text-xs text-muted-foreground"> · {row.ties} empates</span> : null}
                </TableCell>
                <TableCell>{formatRate(row.tournament)}</TableCell>
                <TableCell>{row.difference === null ? '—' : `${points.format(row.difference)} pts`}</TableCell>
                <TableCell>
                  <Inside value={row.inside} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  )
}

export function CalibrationDetailPage() {
  const { id = '' } = useParams()
  const calibration = useCalibration(id)
  return (
    <div className="flex flex-col gap-4">
      <Section
        title={calibration.data ? calibration.data.job.label : 'Calibración'}
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/simulacion/calibracion">
              <ArrowLeftIcon data-icon="inline-start" />
              Calibraciones
            </Link>
          </Button>
        }
      >
        {calibration.isPending ? (
          <LoadingRows />
        ) : calibration.isError ? (
          <ErrorState error={calibration.error} onRetry={() => calibration.refetch()} />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status={calibration.data.job.status} />
            <span className="text-muted-foreground">
              {calibration.data.job.botEs} · {calibration.data.job.era} · {calibration.data.job.lists} listas ·{' '}
              {calibration.data.job.gamesPerPair} por cruce · motor {shortSha(calibration.data.job.engineRev)}
            </span>
            <Link to={`/simulacion/${calibration.data.job.id}`} className="text-primary hover:underline">
              Ver la simulación #{calibration.data.job.id}
            </Link>
          </div>
        )}
      </Section>
      {calibration.data ? <Report view={calibration.data} /> : null}
    </div>
  )
}
