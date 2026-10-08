/**
 * One test or search of the Laboratorio (T-008): each list with its meta score (win rate weighted by the share of each
 * archetype of the bank, with n and interval), its pairings, the cards it changes from the starting list and how new
 * it is against the era's tournament lists. A search also shows its rounds and the confirmation round. Bots play.
 */
import { ChevronDownIcon, FlaskConicalIcon, SaveIcon, XCircleIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateDeck } from '@/api/decks'
import { useLabJob, useLabTest } from '@/api/lab'
import type { LabDeck, LabJob, MetaScore, SelectableEnergy } from '@/api/schemas'
import { useCancelSimulation } from '@/api/simulations'
import { EnergyChips } from '@/components/EnergyChip'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RateDetails } from '@/components/RateSummary'
import { KeyValue, Section } from '@/components/Section'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatNumber, shortSha } from '@/lib/format'
import { formatInterval, formatRateValue } from '@/lib/matches'
import { formatDuration, isActive, progressFraction } from '@/lib/simulation'
import { cn } from '@/lib/utils'
import { ProgressBar, StatusBadge } from '../simulacion/SimulacionPage'
import { ChangeLine } from './LaboratorioPage'

const ROLE_LABEL: Record<LabDeck['role'], string> = {
  best: 'Mejor encontrada',
  base: 'Lista de partida',
  variant: 'Variante',
  deck: 'Mazo probado',
}

function ScoreLine({ score, label }: { score: MetaScore | null; label?: string }) {
  if (!score) return <span className="text-sm text-muted-foreground">sin datos todavía</span>
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      <span className="text-lg font-semibold tabular">{formatRateValue(score.value)}</span>
      <span className="text-xs text-muted-foreground tabular">
        n = {formatNumber(score.games)} · IC {formatInterval(score.ci95)}
        {score.coverage < 0.999 ? ` · ${Math.round(score.coverage * 100)} % del banco` : ''}
      </span>
    </span>
  )
}

function NoveltyBadge({ deck }: { deck: LabDeck }) {
  const { novelty } = deck
  const title =
    novelty.swaps === null
      ? 'La era no tiene listas para comparar'
      : `A ${novelty.swaps} ${novelty.swaps === 1 ? 'cambio' : 'cambios'} de una lista de ${novelty.closestArchetype ?? 'sin arquetipo'}; ${novelty.nearbyLists} listas de la era a 6 cambios o menos`
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn(
        novelty.kind === 'new' && 'border-primary text-primary',
        novelty.kind === 'played' && 'text-muted-foreground',
      )}
    >
      {novelty.label}
      {novelty.kind === 'known' && novelty.swaps !== null ? ` (${novelty.swaps})` : ''}
    </Badge>
  )
}

function DeckRow({ deck, job, defaultOpen }: { deck: LabDeck; job: LabJob; defaultOpen: boolean }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(defaultOpen)
  const createDeck = useCreateDeck()
  const test = useLabTest()
  const rivals = new Map(job.rivals.map((rival) => [rival.snapshot, rival]))
  const energies = deck.energies as SelectableEnergy[]
  const cards = deck.cards.map((card) => ({ cardId: card.cardId, count: card.count }))
  const headline = deck.confirm?.score ? deck.confirm.score : deck.search.score

  async function save() {
    try {
      const created = await createDeck.mutateAsync({
        name: deck.label,
        energies,
        cards,
        tags: ['laboratorio'],
        notes: `Del laboratorio, simulación #${job.job.id}: ${deck.confirm?.text ?? deck.search.text}. Juegan bots.`,
      })
      toast.success('Mazo guardado')
      navigate(`/mazos/${created.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function retest() {
    try {
      const created = await test.mutateAsync({
        decks: [{ cards, energies, name: deck.label }],
        size: job.size,
        era: job.era,
        gamesPerRival: 200,
      })
      toast.success(`Prueba #${created.id} en cola`)
      navigate(`/laboratorio/${created.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={deck.role === 'best' ? 'default' : 'secondary'}>{ROLE_LABEL[deck.role]}</Badge>
        <NoveltyBadge deck={deck} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{deck.label}</span>
      </div>
      {deck.confirm ? (
        <div className="flex flex-col gap-0.5">
          <ScoreLine score={deck.confirm.score} label="confirmación" />
          <ScoreLine score={deck.search.score} label="en la búsqueda" />
        </div>
      ) : (
        <ScoreLine score={headline} />
      )}
      {deck.changes && (deck.changes.add.length > 0 || deck.changes.remove.length > 0) ? (
        <div className="text-xs">
          <ChangeLine add={deck.changes.add} remove={deck.changes.remove} />
        </div>
      ) : null}
      <button
        type="button"
        className="flex items-center gap-1 self-start text-xs text-primary hover:underline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ChevronDownIcon className={cn('size-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        {open ? 'Ocultar detalle' : 'Rivales y lista'}
      </button>
      {open ? (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1 text-sm">
            {deck.perRival.map((row) => {
              const rival = rivals.get(row.rival)
              return (
                <li key={row.rival} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="min-w-0 sm:flex-1 sm:truncate">
                    {rival?.archetypeName ?? row.rival}
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · peso {formatRateValue((rival?.weight ?? 0) * 100)}
                    </span>
                  </span>
                  {row.rate ? (
                    <span className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground tabular">{formatRateValue(row.rate.value)}</span>{' '}
                      <RateDetails record={row.record} rate={row.rate} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">sin partidas</span>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex flex-col gap-1">
            <EnergyChips energies={energies} />
            <p className="text-sm">{deck.cards.map((card) => `${card.count} ${card.nameEs}`).join(', ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {deck.deckId ? (
              <Button asChild variant="outline" size="sm">
                <Link to={`/mazos/${deck.deckId}`}>Ver el mazo</Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={createDeck.isPending}
                onClick={() => void save()}
              >
                <SaveIcon aria-hidden="true" />
                Guardar como mazo
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={test.isPending} onClick={() => void retest()}>
              <FlaskConicalIcon aria-hidden="true" />
              Probar con 200 partidas
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

function ExploreSummary({ job }: { job: LabJob }) {
  const explore = job.explore
  if (!explore) return null
  const label = new Map(job.decks.map((deck) => [deck.snapshot, deck.label]))
  const phase = { search: 'buscando', confirm: 'confirmando', done: 'terminada' }[explore.phase]
  return (
    <Section title="Búsqueda">
      <KeyValue
        items={[
          { label: 'Estado', value: `${phase}${explore.stopReasonEs ? ` (${explore.stopReasonEs})` : ''}` },
          { label: 'Cartas que entran', value: explore.poolEs },
          {
            label: 'Por ronda',
            value: `${explore.config.variantsPerRound} variantes · ${explore.config.gamesPerRival} partidas por rival`,
          },
          {
            label: 'Paradas',
            value: `${explore.config.maxRounds} rondas como máximo, o ${explore.config.patience} seguidas sin mejora`,
          },
          ...(explore.locked.length > 0
            ? [{ label: 'No se tocan', value: explore.locked.map((card) => card.nameEs).join(', ') }]
            : []),
        ]}
      />
      <ol className="flex flex-col gap-1 text-sm">
        {explore.rounds.map((round) => (
          <li key={round.index} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{round.kind === 'search' ? `Ronda ${round.index + 1}` : 'Confirmación'}</span>
            <span className="text-muted-foreground">
              {round.kind === 'confirm'
                ? `lista de partida y la mejor encontrada, ${explore.config.confirmGames} partidas por rival`
                : !round.decided
                  ? `${round.candidates.length} variantes jugando`
                  : round.accepted !== null
                    ? `ganó ${label.get(round.accepted) ?? round.accepted}`
                    : `${round.candidates.length} variantes, ninguna mejoró a la mejor`}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  )
}

export function LabJobPage() {
  const { id = '' } = useParams()
  const lab = useLabJob(id)
  const cancel = useCancelSimulation()
  if (lab.isLoading) return <LoadingRows rows={5} />
  if (lab.isError || !lab.data) return <ErrorState error={lab.error} onRetry={() => void lab.refetch()} />
  const data = lab.data
  const job = data.job
  const active = isActive(job.status)
  const variants = data.decks.filter((deck) => deck.role === 'variant')
  const main = data.decks.filter((deck) => deck.role !== 'variant')
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-semibold">{job.label}</h1>
          <StatusBadge status={job.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          #{job.id} · {data.mode === 'test' ? 'Prueba contra el meta' : 'Búsqueda de variantes'} · era {data.era} ·{' '}
          {data.size} arquetipos · {job.playersEs[0]} vs {job.playersEs[1]} · semilla {job.baseSeed} · motor{' '}
          {shortSha(job.engineRev)}
        </p>
        {active ? (
          <div className="flex flex-col gap-1">
            <ProgressBar fraction={progressFraction(job)} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-1 tabular">
                {formatNumber(job.progress.gamesDone)} de {formatNumber(job.progress.totalGames)} partidas
                {job.progress.etaSeconds !== null ? ` · faltan ~${formatDuration(job.progress.etaSeconds)}` : ''}
                {data.mode === 'explore' ? ' (de esta ronda en adelante se suman más)' : ''}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(job.id, {
                    onSuccess: () => void lab.refetch(),
                    onError: (error) => toast.error(errorMessage(error)),
                  })
                }
              >
                <XCircleIcon aria-hidden="true" />
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
        {job.error ? <p className="text-sm text-destructive">{job.error}</p> : null}
      </div>
      <Alert>
        <FlaskConicalIcon aria-hidden="true" />
        <AlertDescription>
          {data.note} El puntaje es el % de victorias contra cada arquetipo del banco, ponderado por su cuota en la era.
        </AlertDescription>
      </Alert>
      <ExploreSummary job={data} />
      <Section title={data.mode === 'test' ? 'Resultado' : 'Listas'}>
        <ul className="divide-y rounded-lg border">
          {main.map((deck, at) => (
            <DeckRow key={deck.snapshot} deck={deck} job={data} defaultOpen={at === 0 && data.mode === 'test'} />
          ))}
        </ul>
      </Section>
      {variants.length > 0 ? (
        <Section title={`Variantes probadas (${variants.length})`}>
          <p className="text-xs text-muted-foreground">
            Cada una con las partidas de su ronda: pocas partidas, intervalos anchos. Las que parecen mejores pero no
            ganaron con claridad pueden ser suerte.
          </p>
          <ul className="divide-y rounded-lg border">
            {variants.map((deck) => (
              <DeckRow key={deck.snapshot} deck={deck} job={data} defaultOpen={false} />
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Banco del meta">
        <ul className="divide-y rounded-lg border text-sm">
          {data.rivals.map((rival) => (
            <li key={rival.listKey} className="flex items-baseline gap-2 px-3 py-2">
              <Link to={`/torneos/listas/${rival.listKey}`} className="min-w-0 flex-1 truncate hover:underline">
                {rival.archetypeName}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {formatRateValue(rival.share)} · peso {formatRateValue(rival.weight * 100)}
              </span>
            </li>
          ))}
        </ul>
        <Link to={`/simulacion/${job.id}`} className="text-xs text-primary hover:underline">
          Ver la simulación completa (cruces, semillas, chunks)
        </Link>
      </Section>
    </div>
  )
}
