/**
 * One test or search of the Laboratorio (T-008): each list with its meta score (win rate weighted by the share of each
 * archetype of the bank, with n and interval), its pairings, the cards it changes from the starting list and how new
 * it is against the era's tournament lists. A search also shows its rounds and the confirmation round. Bots play.
 */
import {
  ChevronDownIcon,
  CircleHelpIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  SaveIcon,
  SparklesIcon,
  SquareIcon,
  XCircleIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateDeck, useDeck, useUpdateDeck } from '@/api/decks'
import { useAddLabCandidate, useLabJob, useLabJobs, useLabTest, useStopLabSearch } from '@/api/lab'
import type { LabDeck, LabJob, MetaScore, SelectableEnergy } from '@/api/schemas'
import { useCancelSimulation } from '@/api/simulations'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EnergyChips } from '@/components/EnergyChip'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RateDetails } from '@/components/RateSummary'
import { KeyValue, Section } from '@/components/Section'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatNumber, PERCENT, shortSha } from '@/lib/format'
import { formatInterval, formatRate, formatRateValue } from '@/lib/matches'
import { formatDuration, isActive, progressFraction } from '@/lib/simulation'
import { cn } from '@/lib/utils'
import { ProgressBar, StatusBadge } from '../simulacion/SimulacionPage'
import { ChangeLine, IncludeNotes } from './LaboratorioPage'

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
        n = {formatNumber(score.games)} · IC&nbsp;{formatInterval(score.ci95)}
        {score.coverage < 0.999 ? ` · ${Math.round(score.coverage * 100)}${PERCENT} del banco` : ''}
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

/** Same cards (by edition) and energies, in any order. */
function sameList(
  a: { cards: { cardId: string; count: number }[]; energies: string[] },
  b: { cards: { cardId: string; count: number }[]; energies: string[] },
): boolean {
  const key = (list: typeof a) =>
    `${list.cards
      .map((card) => `${card.cardId}×${card.count}`)
      .sort()
      .join(',')}|${[...list.energies].sort().join(',')}`
  return key(a) === key(b)
}

/**
 * «Actualizar el mazo original» (pedido del 8/10/2026): the search started from a saved deck and this list is a
 * variant of it. Saves it as a new revision of that deck (the old one stays in Revisiones, one tap to restore).
 */
function UpdateOriginal({ deck, job, size }: { deck: LabDeck; job: LabJob; size: 'sm' | 'default' }) {
  const base = job.decks.find((item) => item.role === 'base')
  const original = useDeck(base?.deckId ?? undefined)
  const update = useUpdateDeck()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  if (!base?.deckId || deck.role === 'base' || deck.role === 'deck') return null
  const target = {
    cards: deck.cards.map((card) => ({ cardId: card.cardId, count: card.count })),
    energies: deck.energies,
  }
  const current = original.data
    ? {
        cards: original.data.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count })),
        energies: original.data.energies,
      }
    : null
  if (current && sameList(current, target)) {
    return <span className="self-center text-xs text-muted-foreground">El mazo ya tiene esta lista.</span>
  }
  const changedSince =
    current !== null &&
    !sameList(current, {
      cards: base.cards.map((card) => ({ cardId: card.cardId, count: card.count })),
      energies: base.energies,
    })
  const score = deck.confirm?.text ?? deck.search.text
  // Review of #49: while the replay with another bot plays, the dialog says so.
  const robustness = job.explore?.robustness
  const replaying =
    robustness && ['pending', 'queued', 'running'].includes(robustness.status) && deck.role === 'best'
      ? robustness
      : null

  async function apply() {
    if (!base?.deckId) return
    try {
      await update.mutateAsync({
        id: base.deckId,
        patch: {
          cards: target.cards,
          energies: target.energies as SelectableEnergy[],
          note: `Laboratorio #${job.job.id}: ${score}`.slice(0, 500),
        },
      })
      toast.success('Mazo actualizado: la lista anterior queda en Revisiones')
      navigate(`/mazos/${base.deckId}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={size === 'default' ? 'default' : 'outline'}
        size={size}
        onClick={() => setConfirm(true)}
      >
        <RefreshCwIcon aria-hidden="true" />
        Actualizar el mazo original
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`¿Actualizar «${original.data?.name ?? base.label}»?`}
        description={
          <span className="flex flex-col gap-2">
            {deck.changes ? <ChangeLine add={deck.changes.add} remove={deck.changes.remove} /> : null}
            <span>
              Se guarda como una revisión nueva del mazo con la nota «Laboratorio #{job.job.id}». La lista anterior
              queda en Revisiones y se restaura con un toque.
            </span>
            {changedSince ? (
              <span className="text-warning">
                El mazo cambió desde que empezó la búsqueda: esos cambios también se reemplazan.
              </span>
            ) : null}
            {replaying ? (
              <span className="text-warning">
                La confirmación con {replaying.bot} todavía se está jugando: si querés saber si la mejora depende del
                bot, esperá a que termine.
              </span>
            ) : null}
            {job.explore?.robustness?.robustness === 'bot_sensitive' ? (
              <span className="text-warning">
                Con {job.explore.robustness.bot} salió peor: probala en el juego antes.
              </span>
            ) : null}
          </span>
        }
        confirmLabel="Actualizar"
        pending={update.isPending}
        onConfirm={() => void apply()}
      />
    </>
  )
}

/**
 * When a finished search found a list: at the top, with the button, only if the confirmation backs it (H-010);
 * otherwise, that it was not clear.
 */
function FoundBetter({ job }: { job: LabJob }) {
  if (job.mode !== 'explore' || job.explore?.phase !== 'done') return null
  const best = job.decks.find((deck) => deck.role === 'best')
  const base = job.decks.find((deck) => deck.role === 'base')
  if (!best || !base || best.snapshot === base.snapshot) return null
  const confirmation = job.explore.confirmation
  if (confirmation && confirmation.verdict !== 'better') {
    return (
      <Alert>
        <CircleHelpIcon aria-hidden="true" />
        <AlertDescription>
          La búsqueda eligió «{best.label}», pero {confirmation.verdictEs}: {confirmation.differenceText} contra la
          lista de partida, con partidas nuevas. Antes de cambiar el mazo, probala con más partidas.
        </AlertDescription>
      </Alert>
    )
  }
  if (!base.deckId) return null
  return (
    <Alert>
      <SparklesIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-2">
        <span>
          Encontró una versión mejor de «{base.label}»: {best.confirm?.text ?? best.search.text}
          {base.confirm ? ` (la de partida: ${base.confirm.text})` : ''}
          {confirmation ? `; ${confirmation.differenceText}` : ''}.
          {job.explore.robustness?.robustnessEs ? ` ${capitalize(job.explore.robustness.robustnessEs)}.` : ''}
        </span>
        <span className="flex flex-wrap gap-2">
          <UpdateOriginal deck={best} job={job} size="default" />
        </span>
      </AlertDescription>
    </Alert>
  )
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

type RobustnessView = NonNullable<NonNullable<LabJob['explore']>['robustness']>

/** Fase 42: the confirmation played again with a stronger bot, in each of its states (review of #49). */
function RobustnessLine({ robustness }: { robustness: RobustnessView }) {
  const link =
    robustness.jobId === null ? null : (
      <>
        {' '}
        <Link to={`/laboratorio/${robustness.jobId}`} className="underline">
          #{robustness.jobId}
        </Link>
      </>
    )
  if (robustness.robustnessEs) {
    return (
      <p className="text-sm">
        Con {robustness.bot}: {robustness.differenceText}. {capitalize(robustness.robustnessEs)}.{link}
      </p>
    )
  }
  if (robustness.status === 'failed' || robustness.status === 'cancelled') {
    return (
      <p className="text-sm text-muted-foreground">
        La confirmación con {robustness.bot} {robustness.status === 'failed' ? 'falló' : 'se canceló'}: el resultado
        queda sin esa marca.{link}
      </p>
    )
  }
  if (robustness.status === 'pending') {
    return (
      <p className="text-sm text-muted-foreground">
        La confirmación con {robustness.bot} está por encolarse
        {robustness.error ? ` (no se pudo todavía: ${robustness.error}; se reintenta sola)` : ''}.
      </p>
    )
  }
  return (
    <p className="text-sm text-muted-foreground">
      Se está confirmando con {robustness.bot}, un bot más fuerte:{link}
    </p>
  )
}

/** «x de y» as a whole percentage, or «—» without games. */
function share(part: number, total: number): string {
  return total > 0 ? `${Math.round((100 * part) / total)}${PERCENT}` : '—'
}

/**
 * T-017 A2: what the games say beyond the rate, every rival together. «Sin Pokémon en juego» high means it runs out of
 * Pokémon (few Basics, or the bot does not evolve); a low Stage 2 share, that its evolutions rarely come out.
 */
function GamesLine({ games }: { games: NonNullable<LabDeck['games']> }) {
  const losses = games.losses.points + games.losses.noPokemon
  return (
    <p className="text-xs text-muted-foreground">
      Empezando: {formatRate(games.firstRate)} · yendo segundo: {formatRate(games.secondRate)}
      {losses > 0
        ? ` · derrotas: ${share(games.losses.points, losses)} por puntos, ${share(games.losses.noPokemon, losses)} sin Pokémon en juego`
        : ''}
      {games.ties.turnLimit > 0 ? ` · ${games.ties.turnLimit} empates por el límite de turnos` : ''}
      {games.hasStage2 ? ` · llegó a Fase 2 en el ${share(games.stages[2], games.games)} de las partidas` : ''}
      {games.games < games.total
        ? ` (detalle de ${formatNumber(games.games)} de ${formatNumber(games.total)} partidas)`
        : ''}
      .
    </p>
  )
}

/** «%» with one decimal at most. */
function percent(value: number): string {
  return `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })}${PERCENT}`
}

/** T-017 E1/E2: why each card that came in was proposed, and «te falta» when the collection lacks copies. */
function WhyLine({ why }: { why: LabDeck['why'] }) {
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {why.map((card) => (
        <li key={card.cardId}>
          Entra {card.nameEs}
          {card.asked
            ? ', que pediste probar'
            : card.eraShare !== null && card.archetypeShare !== null
              ? `: la juega el ${percent(card.eraShare)} de las listas de la era y el ${percent(card.archetypeShare)} de las de su arquetipo`
              : ''}
          {card.missing > 0 ? (
            <span className="text-warning">
              {' '}
              · te falta {card.missing} {card.missing === 1 ? 'copia' : 'copias'}
            </span>
          ) : null}
          .
        </li>
      ))}
    </ul>
  )
}

function DeckRow({ deck, job, defaultOpen }: { deck: LabDeck; job: LabJob; defaultOpen: boolean }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(defaultOpen)
  const createDeck = useCreateDeck()
  const test = useLabTest()
  const add = useAddLabCandidate()
  // Searches in play (other than this one) of the same era, where this list can join the next round.
  const searches = (useLabJobs().data ?? []).filter(
    (item) =>
      item.mode === 'explore' &&
      (item.status === 'queued' || item.status === 'running') &&
      item.phase === 'search' &&
      item.id !== job.job.id &&
      item.era === job.era,
  )
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
        {deck.bringsBlindSpot ? (
          <Badge
            variant="outline"
            title="Trae una carta que el bot juega mal o que el motor aproxima: probala en el juego antes de confiar en el número."
          >
            carta con punto ciego
          </Badge>
        ) : null}
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
      {deck.vsParent ? (
        <p className="text-xs text-muted-foreground">
          {deck.vsParent.measuredIn === 'verify'
            ? 'En la verificación, con partidas nuevas, contra la mejor de entonces: '
            : 'Contra la mejor de su ronda: '}
          {deck.vsParent.text}
          {deck.vsParent.complete && deck.vsParent.paired ? ', partida por partida' : ''}
          {deck.vsParent.selectionText ? ` (en la ronda que la eligió: ${deck.vsParent.selectionText})` : ''}.
        </p>
      ) : null}
      {deck.energyChange ? (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Zona de Energía: <EnergyChips energies={deck.energyChange.from as SelectableEnergy[]} /> →{' '}
          <EnergyChips energies={deck.energyChange.to as SelectableEnergy[]} />
        </p>
      ) : null}
      {deck.why.length > 0 ? <WhyLine why={deck.why} /> : null}
      {deck.games ? <GamesLine games={deck.games} /> : null}
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
                      {rival?.second ? ' · segunda lista' : ''} · peso {formatRateValue((rival?.weight ?? 0) * 100)}
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
            {deck.blindSpots.length > 0 ? (
              <ul className="text-xs text-muted-foreground">
                {deck.blindSpots.map((card) => (
                  <li key={card.cardId}>
                    {card.nameEs}: {card.reasons.join('; ')}.
                  </li>
                ))}
              </ul>
            ) : null}
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
            <UpdateOriginal deck={deck} job={job} size="sm" />
            <Button type="button" variant="outline" size="sm" disabled={test.isPending} onClick={() => void retest()}>
              <FlaskConicalIcon aria-hidden="true" />
              Probar con 200 partidas
            </Button>
            {/* T-017 E4: a new search from this list, or this list in a search in play. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                navigate('/laboratorio', {
                  state: {
                    exploreFrom: { cards, energies, name: deck.label },
                    // Review of #64: the same bank (size and objective) as the job it comes from.
                    size: job.size,
                    objective:
                      job.objective.kind === 'rival'
                        ? { objective: 'rival', archetypeId: job.objective.archetypeId }
                        : { objective: job.objective.kind },
                  },
                })
              }
            >
              <SparklesIcon aria-hidden="true" />
              Buscar variantes desde esta
            </Button>
            {searches.map((search) => (
              <Button
                key={search.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={add.isPending}
                onClick={() =>
                  add.mutate(
                    { id: search.id, deck: { cards, energies, name: deck.label } },
                    {
                      onSuccess: () => toast.success(`Se juega en la próxima ronda de la búsqueda #${search.id}`),
                      onError: (error) => toast.error(errorMessage(error)),
                    },
                  )
                }
              >
                Sumar a la búsqueda #{search.id}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </li>
  )
}

type ExploreView = NonNullable<LabJob['explore']>

/** «Ronda 2» (search rounds counted on their own), «Verificación» or «Confirmación». */
function roundTitle(rounds: ExploreView['rounds'], at: number): string {
  const round = rounds[at]
  if (round?.kind === 'verify') return 'Verificación'
  if (round?.kind === 'confirm') return 'Confirmación'
  if (round?.probe) return 'Ronda de prueba'
  const number = rounds.slice(0, at + 1).filter((item) => item.kind === 'search' && !item.probe).length
  // T-017 C8: the fill round.
  return round && round.fill.length > 0 ? `Ronda ${number} (a fondo)` : `Ronda ${number}`
}

function roundText(round: ExploreView['rounds'][number], explore: ExploreView, label: Map<number, string>): string {
  const name = (id: number | null) => (id === null ? '' : (label.get(id) ?? String(id)))
  if (round.kind === 'confirm') {
    return `lista de partida y la mejor encontrada, ${explore.config.confirmGames} partidas por rival`
  }
  if (round.probe) {
    // T-017 C3: one copy of each card out, a filler in its place.
    return round.decided
      ? `${round.candidates.length} cartas medidas: lo que menos aporta sale más seguido después`
      : `${round.candidates.length} cartas: sale una copia de cada una, con un relleno en su lugar`
  }
  if (round.kind === 'verify' && round.candidates.length > 1) {
    // T-017 C8: the fill round's best three, verified together (the bar goes up for being several).
    const names = round.candidates.map(name).join(', ')
    if (!round.decided) return `las ${round.candidates.length} mejores (${names}) contra la mejor, con partidas nuevas`
    return round.accepted !== null
      ? `${name(round.accepted)} se sostuvo con partidas nuevas: pasa a ser la mejor`
      : `ninguna de las ${round.candidates.length} se sostuvo con partidas nuevas`
  }
  if (round.kind === 'verify') {
    const [variant = null] = round.candidates
    if (!round.decided) return `${name(variant)} contra la mejor, con partidas nuevas`
    return round.accepted !== null
      ? `${name(round.accepted)} se sostuvo con partidas nuevas: pasa a ser la mejor`
      : `${name(variant)} no se sostuvo con partidas nuevas`
  }
  const notes = [
    round.candidates.some((id) => explore.combos.includes(id)) ? 'una junta los dos mejores cambios' : null,
    round.candidates.some((id) => explore.reverts.includes(id)) ? 'una deshace un cambio anterior' : null,
  ].filter(Boolean)
  // Fase 42, carreras: the variants clearly worse after the first half did not play the second.
  if (round.dropped.length > 0) {
    notes.push(
      round.dropped.length === 1
        ? 'una quedó afuera a mitad de ronda'
        : `${round.dropped.length} quedaron afuera a mitad de ronda`,
    )
  }
  // T-017 C8: every way to fill the weakest places.
  if (round.fill.length > 0) {
    notes.unshift(`todas las formas de llenar los lugares de ${round.fill.map((card) => card.nameEs).join(' y ')}`)
  }
  const combo = notes.length > 0 ? ` (${notes.join('; ')})` : ''
  if (round.stopped) {
    // T-017 D2: an incomplete candidate cannot win; a complete one that wins is verified, then confirmed.
    if (!round.decided) return 'la frenaste: terminan las partidas en juego y pasa a confirmar'
    if (round.accepted !== null) return `la frenaste: ganó ${name(round.accepted)}`
    if (round.screened !== null)
      return `la frenaste: ${name(round.screened)} le ganó a la mejor: se verifica y después se confirma`
    return 'la frenaste: ninguna variante completa mejoró a la mejor'
  }
  if (!round.decided) return `${round.candidates.length} variantes jugando${combo}`
  if (round.accepted !== null) return `ganó ${name(round.accepted)}`
  if (round.screened !== null) {
    return round.fill.length > 0
      ? `${name(round.screened)} y las que le siguen le ganaron a la mejor en los lugares de ${round.fill.map((card) => card.nameEs).join(' y ')}: se verifican`
      : `${name(round.screened)} le ganó a la mejor: se verifica`
  }
  return `${round.candidates.length} variantes${combo}, ninguna mejoró a la mejor`
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
          ...(explore.config.verifyGames
            ? [
                {
                  label: 'Antes de aceptar',
                  value: `se verifica con ${explore.config.verifyGames} partidas nuevas por rival`,
                },
              ]
            : []),
          {
            label: 'Paradas',
            value: `${explore.config.maxRounds} rondas como máximo, o ${explore.config.patience} seguidas sin mejora`,
          },
          ...(explore.locked.length > 0
            ? [{ label: 'No se tocan', value: explore.locked.map((card) => card.nameEs).join(', ') }]
            : []),
          ...(explore.event ? [{ label: `Evento «${explore.event.name}»`, value: explore.event.rules.join(' ') }] : []),
        ]}
      />
      <ol className="flex flex-col gap-1 text-sm">
        {explore.rounds.map((round, at) => (
          <li key={round.index} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{roundTitle(explore.rounds, at)}</span>
            <span className="text-muted-foreground">{roundText(round, explore, label)}</span>
          </li>
        ))}
      </ol>
      {explore.leftOut.length > 0 ? (
        <p className="text-sm">
          No pudo probar, porque no las tenés:{' '}
          {explore.leftOut.map((card) => `${card.nameEs} (${percent(card.archetypeShare)} del arquetipo)`).join(', ')}.
          {explore.poolEs === 'cartas de la colección'
            ? ' Para incluirlas, buscá con «todas las cartas que el motor juega».'
            : ''}
        </p>
      ) : null}
      {explore.learned.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-xs text-muted-foreground">
            Lo que midió por carta (puntos contra{' '}
            {job.objective.kind === 'meta' ? 'el meta' : job.objective.labelEs.replace(/^solo /, '')}, de lo más claro a
            lo menos; guía qué se prueba, no qué se acepta):
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {explore.learned.map((change) => (
              <li key={`${change.sign}${change.cardId}`} className="text-xs">
                {change.sign === '+' ? 'entra' : 'sale'} {change.nameEs}:{' '}
                <span className={change.mean >= 0 ? 'text-success' : 'text-destructive'}>
                  {change.mean >= 0 ? '+' : '−'}
                  {Math.abs(change.mean).toLocaleString('es-AR', {
                    maximumFractionDigits: 1,
                    minimumFractionDigits: 1,
                  })}
                </span>{' '}
                ({change.n} {change.n === 1 ? 'variante' : 'variantes'})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {explore.confirmation ? (
        <p className="text-sm">
          Confirmación: {explore.confirmation.differenceText} sobre la lista de partida;{' '}
          {explore.confirmation.verdictEs}.
        </p>
      ) : null}
      {explore.robustness ? <RobustnessLine robustness={explore.robustness} /> : null}
      {explore.probe.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Qué aporta cada carta (ronda de prueba)</p>
          <p className="text-xs text-muted-foreground">
            El mazo con una copia menos de cada carta, contra el mazo: arriba, lo que menos se extraña.
            {explore.weakest.length > 0
              ? ` Sale más seguido: ${explore.weakest.map((card) => card.nameEs).join(', ')}.`
              : ''}
          </p>
          <ul className="text-xs">
            {explore.probe.map((card) => (
              <li key={card.cardId}>
                {card.nameEs}, una copia menos: {card.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {explore.include.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-sm">Probando: {explore.include.map((card) => card.nameEs).join(', ')}.</p>
          <IncludeNotes cards={explore.include} className="text-muted-foreground" />
        </div>
      ) : null}
      {explore.added.length + explore.pending.length + explore.lost.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Sumadas a mano: {explore.added.length}
          {explore.pending.length > 0 ? ` (y ${explore.pending.length} para la próxima ronda)` : ''}
          {explore.lost.length > 0
            ? `; ${explore.lost.length} no llegaron a jugarse porque la búsqueda terminó antes`
            : ''}
          .
        </p>
      ) : null}
    </Section>
  )
}

export function LabJobPage() {
  const { id = '' } = useParams()
  const lab = useLabJob(id)
  const cancel = useCancelSimulation()
  const stop = useStopLabSearch()
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
          #{job.id} · {data.mode === 'test' ? 'Prueba' : 'Búsqueda de variantes'} · era {data.era} · contra{' '}
          {data.objective.labelEs} · {data.size} arquetipos · {job.playersEs[0]} vs {job.playersEs[1]} · semilla{' '}
          {job.baseSeed} · motor {shortSha(job.engineRev)}
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
              {data.mode === 'explore' && data.explore?.phase === 'search' && data.explore.stopRequested ? (
                <span className="text-xs text-muted-foreground">
                  Frenando: termina lo que se está jugando y pasa a confirmar.
                </span>
              ) : null}
              {data.mode === 'explore' && data.explore?.phase === 'search' && !data.explore.stopRequested ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={stop.isPending}
                  title="Termina la ronda con lo que tiene y pasa a la confirmación: no se pierde lo encontrado"
                  onClick={() =>
                    stop.mutate(job.id, {
                      onSuccess: () => {
                        toast.success('Frenada: pasa a confirmar lo encontrado')
                        void lab.refetch()
                      },
                      onError: (error) => toast.error(errorMessage(error)),
                    })
                  }
                >
                  <SquareIcon aria-hidden="true" />
                  Frenar y confirmar
                </Button>
              ) : null}
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
      <FoundBetter job={data} />
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
