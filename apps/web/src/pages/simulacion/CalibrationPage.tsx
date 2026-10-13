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
  type WeightedRate,
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
import { formatInterval, formatRate, formatRateValue } from '@/lib/matches'
import { progressFraction } from '@/lib/simulation'
import { ProgressBar, StatusBadge } from './SimulacionPage'

const decimal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const count = new Intl.NumberFormat('es-AR')
/** Archetypes of the bank (`CALIBRATION_GAUNTLET_SIZES` of @tcg/domain): 15 is the Laboratorio's (D-029). */
const BANK_SIZES = [15, 20, 25, 30] as const

/** The lists, pairings and games a bank of `size` archetypes plays: the 3 most played bring a second list from 10 on. */
function bankCost(size: number, gamesPerPair: number) {
  const lists = size + (size >= 10 ? 3 : 0)
  const pairings = (lists * (lists - 1)) / 2
  return { lists, pairings, games: pairings * gamesPerPair }
}
const points = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

/** «ρ = 0,45 (IC 0,12–0,69; 40 cruces)». */
function formatRho(correlation: RankCorrelation | null, unit: string): string {
  if (!correlation) return 'sin datos suficientes'
  const interval = correlation.ci95
    ? `IC ${decimal.format(correlation.ci95[0])}–${decimal.format(correlation.ci95[1])}; `
    : ''
  return `ρ = ${decimal.format(correlation.rho)} (${interval}${correlation.n} ${unit})`
}

/** «55,6 % (n = 120, IC 47,2–64,0 %, orientativo)» for a weighted mean of rates. */
function formatWeighted(rate: WeightedRate | null): string {
  if (!rate) return 'sin datos'
  const parts = [`n = ${rate.games}`, `IC ${formatInterval(rate.ci95)}`]
  if (rate.orientative) parts.push('orientativo')
  return `${formatRateValue(rate.value)} (${parts.join(', ')})`
}

/** «+5,0 pts (IC −8,9 a +18,9)». */
function formatDifference(value: number | null, ci95: [number, number] | null): string {
  if (value === null) return '—'
  const interval = ci95 ? ` (IC ${points.format(ci95[0])} a ${points.format(ci95[1])})` : ''
  return `${points.format(value)} pts${interval}`
}

const absolute = (value: number) => points.format(value).replace('+', '')

function SummaryLine({ summary }: { summary: NonNullable<CalibrationSummary['summary']> }) {
  if (summary.compared === 0) {
    return <p className="text-xs text-muted-foreground">Ningún par de arquetipos con partidas de torneo suficientes.</p>
  }
  return (
    <p className="text-xs text-muted-foreground">
      Compatibles con el torneo: {summary.compatible} de {summary.compared} · diferencia media (en valor absoluto){' '}
      {summary.meanAbsDifference === null ? '—' : `${absolute(summary.meanAbsDifference)} puntos`} · orden:{' '}
      {formatRho(summary.rankCorrelation, 'puntos')}
    </p>
  )
}

export function CalibrationPage() {
  const engine = useEngineInfo()
  const calibrations = useCalibrations()
  const start = useStartCalibration()
  const [bot, setBot] = useState('e2')
  const [games, setGames] = useState('200')
  const [size, setSize] = useState('15')
  const cost = bankCost(Number(size), Number(games) || 0)
  const bots = engine.data?.bots ?? [{ code: 'e2', label: 'expectiminimax, profundidad 2' }]

  function launch() {
    const gamesPerPair = Number(games)
    if (!Number.isInteger(gamesPerPair) || gamesPerPair < 10 || gamesPerPair > 2000) {
      toast.error('Partidas por cruce: de 10 a 2.000.')
      return
    }
    start.mutate(
      { bot, gamesPerPair, size: Number(size) },
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
        <div className="grid grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-3">
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
          <Field label="Arquetipos del banco">
            <Select value={size} onValueChange={setSize}>
              <SelectTrigger className="w-full" aria-label="Arquetipos del banco">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BANK_SIZES.map((item) => (
                  <SelectItem key={item} value={String(item)}>
                    {item === 15 ? '15 (el del Laboratorio)' : item}
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
          Con {size} arquetipos son unas {cost.lists} listas (los 3 más jugados traen dos) y{' '}
          {count.format(cost.pairings)} cruces: {count.format(cost.games)} partidas. Más arquetipos comparan más pares
          con los torneos, que es lo que achica los intervalos; e3 tarda unas 4 veces lo de e2.
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
                {item.failed > 0 ? (
                  <p className="text-xs text-warning">
                    {item.failed} {item.failed === 1 ? 'cruce de listas falló' : 'cruces de listas fallaron'} en el
                    motor: el resumen es sin ellos.
                  </p>
                ) : null}
                {item.cancelled > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Se canceló con {item.cancelled} {item.cancelled === 1 ? 'cruce de listas' : 'cruces de listas'} sin
                    jugar: el resumen es sin ellos.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Compatible({ value }: { value: boolean | null }) {
  if (value === null) return <MinusIcon className="size-4 text-muted-foreground" aria-label="sin juzgar" />
  return value ? (
    <CheckIcon className="size-4 text-success" aria-label="compatibles" />
  ) : (
    <XIcon className="size-4 text-destructive" aria-label="distintos" />
  )
}

/**
 * What is missing, counted in pairings of lists (the bank may bring two lists of an archetype): a pair of archetypes
 * goes in the comparison once all the pairings of its lists are played (review of #44).
 */
function ListNotes({ view }: { view: CalibrationView }) {
  const notes = [
    view.pending > 0 ? `faltan ${view.pending} por jugar` : null,
    view.failed === 1 ? 'falló 1 en el motor' : view.failed > 1 ? `fallaron ${view.failed} en el motor` : null,
    view.cancelled > 0 ? `${view.cancelled} sin jugar (se canceló)` : null,
    view.mirrors > 0 ? `${view.mirrors} entre listas de un mismo arquetipo, que los torneos no pueden comparar` : null,
  ].filter((note) => note !== null)
  return notes.length > 0 ? <> Cruces de listas: {notes.join(' · ')}.</> : null
}

export function CalibrationReport({ view }: { view: CalibrationView }) {
  const { report } = view
  const rows = [...report.rows].sort((x, y) => Math.abs(y.difference ?? -1) - Math.abs(x.difference ?? -1))
  const archetypes = [...report.archetypes].sort((x, y) => (y.tournament?.value ?? -1) - (x.tournament?.value ?? -1))
  return (
    <>
      <Section title="Resumen">
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            Pares de arquetipos con partidas de torneo suficientes (≥ {report.minTournamentGames}): {report.compared} de{' '}
            {report.rows.length}
            {view.incompletePairs > 0
              ? ` (${view.incompletePairs} ${view.incompletePairs === 1 ? 'par más quedó' : 'pares más quedaron'} afuera: les falta algún cruce de listas)`
              : ''}
            .<ListNotes view={view} />
          </li>
          <li>
            Compatibles (la diferencia, con el error de los dos lados, puede ser 0): {report.compatible} de{' '}
            {report.compared}.
          </li>
          <li>
            Diferencia media, en valor absoluto:{' '}
            {report.meanAbsDifference === null ? '—' : `${absolute(report.meanAbsDifference)} puntos`}.
          </li>
          <li>
            Orden de los pares de arquetipos (cada uno en los dos sentidos; IC por bootstrap de arquetipos):{' '}
            {formatRho(report.rankCorrelation, 'puntos')}.
          </li>
          <li>
            Orden de los arquetipos contra el banco (IC por bootstrap de arquetipos):{' '}
            {formatRho(report.archetypeCorrelation, 'arquetipos')}.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Torneos: {view.tournaments.era}, {view.tournaments.matches} partidas de{' '}
          {view.tournaments.tournamentsWithPairings} torneos con rondas. Las dos fuentes no se mezclan: cada una con su
          n e intervalo. Todo por partida y sin empates (los del motor salen del límite de 30 turnos; se cuentan
          aparte). Las partidas de torneo se toman como independientes, así que su intervalo puede ser un poco angosto.
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
                <TableCell>
                  {row.label}
                  {row.rivals > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      {row.rivals} {row.rivals === 1 ? 'rival' : 'rivales'}
                    </span>
                  ) : null}
                </TableCell>
                {row.rivals === 0 ? (
                  <TableCell colSpan={2} className="text-muted-foreground">
                    ningún rival con {report.minTournamentGames} partidas de torneo o más
                  </TableCell>
                ) : (
                  <>
                    <TableCell>{formatWeighted(row.simulated)}</TableCell>
                    <TableCell>{formatWeighted(row.tournament)}</TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          Los dos lados sobre los mismos rivales (los que tienen {report.minTournamentGames} partidas de torneo o más),
          pesados por su cuota en el meta.
        </p>
      </Section>
      <Section title="Par por par">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Par de arquetipos</TableHead>
              <TableHead>Simulado</TableHead>
              <TableHead>Torneo</TableHead>
              <TableHead>Diferencia</TableHead>
              <TableHead>Compatibles</TableHead>
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
                <TableCell>{formatDifference(row.difference, row.differenceCi95)}</TableCell>
                <TableCell>
                  <Compatible value={row.compatible} />
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
      {calibration.data ? <CalibrationReport view={calibration.data} /> : null}
    </div>
  )
}
