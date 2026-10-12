/**
 * Laboratorio de mazos (T-008): the meta bank of the era, a deck (mine or pasted) against it, the automatic search of
 * variants, and the tests and searches so far. Bots play, not people: every number is a hint to try in the game.
 */
import { FlaskConicalIcon, SearchIcon, XIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDeck, useDecks } from '@/api/decks'
import { useLabBank, useLabExplore, useLabJobs, useLabTest, usePlanLabExplore } from '@/api/lab'
import type {
  ExplorePool,
  LabBank,
  LabDeckSource,
  LabExploreInput,
  LabExplorePlan,
  LabObjectiveChoice,
} from '@/api/schemas'
import { useEngineInfo } from '@/api/simulations'
import { CardSearch } from '@/components/CardSearch'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, formatNumber } from '@/lib/format'
import { useMarkSeen } from '@/lib/seen'
import { formatDuration, isActive, progressFraction } from '@/lib/simulation'
import { ProgressBar, StatusBadge } from '../simulacion/SimulacionPage'
import { CoreBuilder } from './CoreBuilder'

export const LAB_NOTE =
  'Juegan bots del motor deckgym (e2), no personas: el porcentaje depende del bot. Es una pista para probar en el juego, no un veredicto.'

const SIZES = [5, 10, 15, 20] as const

const pct = (value: number) => `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`

function BankList({ bank }: { bank: LabBank }) {
  const { objective } = bank
  return (
    <div className="flex flex-col gap-2">
      {objective.kind === 'meta' ? (
        <p className="text-xs text-muted-foreground">
          Era {bank.era}: {bank.size} arquetipos que suman el {pct(bank.coverage)} de {formatNumber(bank.lists)} listas.
          Cada uno juega su lista representativa (la misma que la «versión de torneo») y pesa según su cuota.
        </p>
      ) : objective.kind === 'mine' ? (
        <p className="text-xs text-muted-foreground">
          Mi meta en la era {bank.era}: los rivales de {objective.matched ?? 0} partidas (n efectivo{' '}
          {formatNumber(objective.effectiveMatches ?? 0)}
          {objective.orientative ? ', orientativo' : ''}), cada uno con el peso de cuántas veces lo enfrentaste (una
          partida de hace {objective.halfLifeDays ?? 14} días pesa la mitad). Son el {pct(objective.coverage ?? 0)} de
          tus partidas con rival, ponderadas por fecha. El intervalo de cada puntaje toma estos pesos como fijos.
          {(objective.unmatched ?? 0) > 0
            ? ` ${objective.unmatched} no se cuentan porque el rival no es un arquetipo de la era${
                objective.unmatchedNames?.length ? ` (${objective.unmatchedNames.join(', ')})` : ''
              }: cargalo con el nombre que sugiere la lista.`
            : ''}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Contra un solo arquetipo de la era {bank.era}, con sus dos listas más representativas, cada una con el peso de
          cuántas veces se jugó.
        </p>
      )}
      <ol className="divide-y rounded-lg border text-sm">
        {bank.rivals.map((rival, at) => (
          <li key={rival.listKey} className="flex items-baseline gap-2 px-3 py-2">
            <span className="w-5 shrink-0 text-xs text-muted-foreground tabular">{at + 1}</span>
            <Link to={`/torneos/listas/${rival.listKey}`} className="min-w-0 flex-1 truncate hover:underline">
              {rival.archetypeName}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground tabular">
              {objective.games?.[rival.archetypeId] !== undefined && !rival.second
                ? `${objective.games[rival.archetypeId]} partidas · `
                : ''}
              {pct(rival.share)} · peso {pct(rival.weight * 100)}
              {rival.second ? ' · segunda lista del arquetipo' : rival.rank > 0 ? ' · otra lista' : ''}
            </span>
          </li>
        ))}
      </ol>
      {bank.skipped.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Salteados (el motor no los puede jugar):{' '}
          {bank.skipped.map((skip) => `${skip.archetypeName} (${skip.reason})`).join('; ')}.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{bank.attribution}</p>
    </div>
  )
}

/** One of my decks, or a pasted list. */
function DeckSourcePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: LabDeckSource | null
  onChange: (source: LabDeckSource | null) => void
  idPrefix: string
}) {
  const decks = useDecks()
  const [mode, setMode] = useState<'deck' | 'text'>('deck')
  const [deckId, setDeckId] = useState<string>('')
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const active = (decks.data ?? []).filter((deck) => deck.archivedAt === null)

  function emit(next: { mode?: 'deck' | 'text'; deckId?: string; text?: string; name?: string }) {
    const m = next.mode ?? mode
    const d = next.deckId ?? deckId
    const t = next.text ?? text
    const n = next.name ?? name
    if (m === 'deck') onChange(d ? { deckId: d } : null)
    else onChange(t.trim() ? { text: t, ...(n.trim() ? { name: n.trim() } : {}) } : null)
  }

  return (
    <div className="flex flex-col gap-2">
      <Tabs
        value={mode}
        onValueChange={(next) => {
          setMode(next as 'deck' | 'text')
          emit({ mode: next as 'deck' | 'text' })
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="deck">Uno de mis mazos</TabsTrigger>
          <TabsTrigger value="text">Pegar una lista</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === 'deck' ? (
        <Select
          value={deckId}
          onValueChange={(next) => {
            setDeckId(next)
            emit({ deckId: next })
          }}
        >
          <SelectTrigger aria-label="Mazo" className="w-full">
            <SelectValue placeholder={decks.isLoading ? 'Cargando mazos…' : 'Elegí un mazo'} />
          </SelectTrigger>
          <SelectContent>
            {active.map((deck) => (
              <SelectItem key={deck.id} value={deck.id}>
                {deck.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <>
          <Textarea
            id={`${idPrefix}-text`}
            aria-label="Lista pegada"
            rows={6}
            placeholder={'2 Torchic (B1-33), 2 Mega-Blaziken ex…\no el formato de Limitless o deckgym'}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              emit({ text: event.target.value })
            }}
          />
          <Input
            aria-label="Nombre de la lista"
            placeholder="Nombre (opcional)"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              emit({ name: event.target.value })
            }}
          />
        </>
      )}
      {value === null && mode === 'deck' && active.length === 0 && !decks.isLoading ? (
        <p className="text-xs text-muted-foreground">No tenés mazos activos.</p>
      ) : null}
    </div>
  )
}

function TestForm({ size, objective }: { size: number; objective: LabObjectiveChoice }) {
  const navigate = useNavigate()
  const test = useLabTest()
  const [source, setSource] = useState<LabDeckSource | null>(null)
  const [games, setGames] = useState('100')
  const bank = useLabBank(size, undefined, objective)
  const rivals = bank.data?.rivals.length ?? size
  const engine = useEngineInfo()
  const cores = engine.data?.workers.find((worker) => worker.online)?.cores ?? 8
  const total = rivals * Number(games)

  async function submit() {
    if (!source) return
    try {
      const job = await test.mutateAsync({ decks: [source], size, gamesPerRival: Number(games), ...objective })
      toast.success(`Prueba #${job.id} en cola`)
      navigate(`/laboratorio/${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DeckSourcePicker value={source} onChange={setSource} idPrefix="test" />
      <Field label="Partidas contra cada rival">
        <Select value={games} onValueChange={setGames}>
          <SelectTrigger aria-label="Partidas contra cada rival" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['50', '100', '200', '500'].map((value) => (
              <SelectItem key={value} value={value}>
                {value} partidas
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <p className="text-xs text-muted-foreground">
        {rivals} rivales × {games} = {formatNumber(total)} partidas, unos{' '}
        {formatDuration((total * 0.1) / Math.max(1, cores))} con {cores} núcleos.
      </p>
      <Button type="button" disabled={!source || test.isPending || !bank.data} onClick={() => void submit()}>
        <FlaskConicalIcon aria-hidden="true" />
        Probar contra {bank.data?.objective.labelEs ?? 'el banco'}
      </Button>
    </div>
  )
}

/** The deck's cards with a «no tocar» checkbox each (only for one of my decks). */
function LockPicker({
  deckId,
  locked,
  onChange,
}: {
  deckId: string
  locked: string[]
  onChange: (locked: string[]) => void
}) {
  const deck = useDeck(deckId)
  if (!deck.data) return null
  return (
    <CardLocks
      cards={deck.data.cards.map((entry) => ({ cardId: entry.card.id, nameEs: entry.card.nameEs, count: entry.count }))}
      locked={locked}
      onChange={onChange}
    />
  )
}

/** «Cartas que no se tocan», for any list (T-017 E3: a pasted or tournament one, from the plan). */
function CardLocks({
  cards,
  locked,
  onChange,
}: {
  cards: { cardId: string; nameEs: string; count: number }[]
  locked: string[]
  onChange: (locked: string[]) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">Cartas que no se tocan</legend>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {cards.map((entry) => {
          const id = `lock-${entry.cardId}`
          return (
            <li key={entry.cardId} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={id}
                checked={locked.includes(entry.cardId)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...locked, entry.cardId] : locked.filter((cardId) => cardId !== entry.cardId))
                }
              />
              <label htmlFor={id} className="min-w-0 truncate">
                {entry.count} {entry.nameEs}
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

/** T-017 E3: «Probar estas cartas», the opposite of locking: each round one variant brings one of them in. */
function IncludePicker({
  cards,
  onChange,
}: {
  cards: { cardId: string; groupId: string; nameEs: string }[]
  onChange: (cards: { cardId: string; groupId: string; nameEs: string }[]) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">Probar estas cartas</legend>
      <p className="text-xs text-muted-foreground">
        Entran aunque no las tengas, tan seguido como la carta más jugada, y cada ronda una variante trae una.
      </p>
      {cards.length < 10 ? (
        <CardSearch
          placeholder="Agregar una carta para probar…"
          limit={8}
          onPick={(hit) => {
            if (cards.some((card) => card.groupId === hit.group.id)) return
            onChange([...cards, { cardId: hit.card.id, groupId: hit.group.id, nameEs: hit.card.nameEs }])
          }}
        />
      ) : null}
      {cards.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {cards.map((card) => (
            <li key={card.groupId}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={`Quitar ${card.nameEs}`}
                onClick={() => onChange(cards.filter((other) => other.groupId !== card.groupId))}
              >
                {card.nameEs}
                <XIcon data-icon="inline-end" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  )
}

function PlanView({ plan }: { plan: LabExplorePlan }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      {!plan.base.simulable ? (
        <p className="text-destructive">
          No se puede simular: {plan.base.problems.map((problem) => problem.message).join('; ')}.
        </p>
      ) : null}
      <p>
        {formatNumber(plan.pool)} cartas candidatas · {formatNumber(plan.games.perRound)} partidas por ronda (~
        {formatDuration(plan.estimatedSeconds.perRound)}) · como mucho {formatNumber(plan.games.max)} (~
        {formatDuration(plan.estimatedSeconds.max)}).
      </p>
      {plan.firstRound.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            Variantes de la primera ronda (si empezás sin cambiar nada, se juegan estas):
          </p>
          <ul className="flex flex-col gap-1 text-xs">
            {plan.firstRound.map((variant) => (
              <li key={[...variant.add, ...variant.remove].map((card) => card.cardId).join(',')}>
                <ChangeLine add={variant.add} remove={variant.remove} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-warning">No encontré variantes válidas con esas cartas.</p>
      )}
    </div>
  )
}

export function ChangeLine({
  add,
  remove,
}: {
  add: { cardId: string; nameEs: string; count: number }[]
  remove: { cardId: string; nameEs: string; count: number }[]
}) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {add.map((card) => (
        <span key={`+${card.cardId}`} className="text-success">
          +{card.count} {card.nameEs}
        </span>
      ))}
      {remove.map((card) => (
        <span key={`-${card.cardId}`} className="text-destructive">
          −{card.count} {card.nameEs}
        </span>
      ))}
    </span>
  )
}

const POOL_LABEL: Record<ExplorePool, string> = {
  collection: 'Cartas de mi colección',
  all: 'Todas las cartas que el motor juega',
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
}) {
  const id = `explore-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

function ExploreForm({ size, objective }: { size: number; objective: LabObjectiveChoice }) {
  const navigate = useNavigate()
  const plan = usePlanLabExplore()
  const explore = useLabExplore()
  // T-017 E4: «Buscar variantes desde esta» on a test or search brings its list here.
  const from = (useLocation().state as { exploreFrom?: LabDeckSource & { name?: string } } | null)?.exploreFrom
  const [source, setSource] = useState<LabDeckSource | null>(from ?? null)
  const [fromLab, setFromLab] = useState(!!from)
  const [include, setInclude] = useState<{ cardId: string; groupId: string; nameEs: string }[]>([])
  // The starting list's cards from the last plan: locks stay offered after the plan is reset (review of #64).
  const [planCards, setPlanCards] = useState<{ cardId: string; nameEs: string; count: number }[]>([])
  const [pool, setPool] = useState<ExplorePool>('collection')
  const [locked, setLocked] = useState<string[]>([])
  const [rounds, setRounds] = useState('12')
  const [variants, setVariants] = useState('8')
  const [games, setGames] = useState('60')
  const [confirmGames, setConfirmGames] = useState('200')
  const [verifyGames, setVerifyGames] = useState('120')
  // Fase 42, carreras: off by default until measured (review of #53).
  const [race, setRace] = useState(false)
  const deckId = source && 'deckId' in source ? source.deckId : null

  const input: LabExploreInput | null = useMemo(() => {
    if (!source) return null
    return {
      deck: source,
      size,
      ...objective,
      ...(locked.length > 0 ? { locked } : {}),
      ...(include.length > 0 ? { include: include.map((card) => card.cardId) } : {}),
      config: {
        pool,
        maxRounds: Number(rounds),
        variantsPerRound: Number(variants),
        gamesPerRival: Number(games),
        confirmGames: Number(confirmGames),
        verifyGames: Number(verifyGames),
        race,
      },
    }
  }, [source, size, objective, locked, include, pool, rounds, variants, games, confirmGames, verifyGames, race])

  // H-021: the plan on screen is the search that starts (same seed) while nothing changed since «Ver el plan».
  const [plannedFor, setPlannedFor] = useState<string | null>(null)
  const plannedSeed = plan.data?.seed !== undefined && plannedFor === JSON.stringify(input) ? plan.data.seed : undefined

  async function start() {
    if (!input) return
    try {
      const job = await explore.mutateAsync(plannedSeed === undefined ? input : { ...input, seed: plannedSeed })
      toast.success(`Búsqueda #${job.id} en cola`)
      navigate(`/laboratorio/${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Prueba variantes de 1 o 2 cambios de cartas contra el banco, ronda por ronda. La mejor de cada ronda, si le gana
        a la mejor hasta ahora, se verifica con partidas nuevas y se queda solo si vuelve a ganar con claridad. Al
        final, una ronda de confirmación juega la lista de partida y la encontrada con partidas nuevas: dice si la
        mejora se sostiene.
      </p>
      {fromLab && source ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            Desde el laboratorio: {'name' in source && source.name ? source.name : 'una lista'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setFromLab(false)
              setSource(null)
              setLocked([])
              plan.reset()
            }}
          >
            Elegir otra
          </Button>
        </div>
      ) : (
        <DeckSourcePicker
          value={source}
          onChange={(next) => {
            setSource(next)
            setLocked([])
            setPlanCards([])
            plan.reset()
          }}
          idPrefix="explore"
        />
      )}
      <Field label="Cartas que pueden entrar">
        <Select value={pool} onValueChange={(next) => setPool(next as ExplorePool)}>
          <SelectTrigger aria-label="Cartas que pueden entrar" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(POOL_LABEL) as ExplorePool[]).map((value) => (
              <SelectItem key={value} value={value}>
                {POOL_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {deckId ? (
        <LockPicker deckId={deckId} locked={locked} onChange={setLocked} />
      ) : planCards.length > 0 ? (
        <CardLocks
          cards={planCards}
          locked={locked}
          onChange={(next) => {
            setLocked(next)
            // The plan on screen was for other locks: plan again (its seed would not be the search's).
            plan.reset()
          }}
        />
      ) : source ? (
        <p className="text-xs text-muted-foreground">Con «Ver el plan» podés elegir cartas que no se tocan.</p>
      ) : null}
      <IncludePicker
        cards={include}
        onChange={(next) => {
          setInclude(next)
          plan.reset()
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Rondas como máximo" value={rounds} onChange={setRounds} min={1} max={20} />
        <NumberField label="Variantes por ronda" value={variants} onChange={setVariants} min={1} max={12} />
        <NumberField label="Partidas por rival" value={games} onChange={setGames} min={10} max={500} />
        <NumberField
          label="Verificación (por rival)"
          value={verifyGames}
          onChange={setVerifyGames}
          min={0}
          max={1000}
        />
        <NumberField
          label="Confirmación (por rival)"
          value={confirmGames}
          onChange={setConfirmGames}
          min={0}
          max={1000}
        />
      </div>
      <div className="flex items-start gap-2 text-sm">
        <Checkbox id="explore-race" checked={race} onCheckedChange={(checked) => setRace(checked === true)} />
        <label htmlFor="explore-race">
          Carreras (en prueba): a mitad de cada ronda, las variantes claramente peores dejan de jugar y las partidas van
          a las demás.
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!input || plan.isPending}
          onClick={() => {
            if (!input) return
            setPlannedFor(JSON.stringify(input))
            plan.mutate(input, {
              onSuccess: (data) => setPlanCards(data.baseCards),
              onError: (error) => toast.error(errorMessage(error)),
            })
          }}
        >
          <SearchIcon aria-hidden="true" />
          Ver el plan
        </Button>
        <Button type="button" disabled={!input || explore.isPending} onClick={() => void start()}>
          <FlaskConicalIcon aria-hidden="true" />
          Empezar la búsqueda
        </Button>
      </div>
      {plan.data ? <PlanView plan={plan.data} /> : null}
    </div>
  )
}

function LabJobsList() {
  const jobs = useLabJobs()
  if (jobs.isLoading) return <LoadingRows rows={3} />
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
  if (!jobs.data || jobs.data.length === 0) {
    return <EmptyState title="Todavía no probaste nada" description="Las pruebas y búsquedas aparecen acá." />
  }
  return (
    <ul className="divide-y rounded-lg border">
      {jobs.data.map((job) => (
        <li key={job.id}>
          <Link to={`/laboratorio/${job.id}`} className="flex flex-col gap-1.5 px-3 py-2.5 hover:bg-muted">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{job.label}</span>
              <StatusBadge status={job.status} />
            </div>
            <div className="text-xs text-muted-foreground">
              #{job.id} · {job.mode === 'test' ? `Prueba contra ${job.against}` : 'Búsqueda de variantes'}
              {job.era ? ` · era ${job.era}` : ''} · {formatDateTime(job.createdAt)}
            </div>
            {isActive(job.status) ? <ProgressBar fraction={progressFraction(job)} /> : null}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** T-017 D4: the meta, «mi meta» or one archetype (from the era's 20 most played). */
function ObjectivePicker({
  value,
  onChange,
}: {
  value: LabObjectiveChoice
  onChange: (next: LabObjectiveChoice) => void
}) {
  const top = useLabBank(20)
  const archetypes = [
    ...new Map((top.data?.rivals ?? []).map((rival) => [rival.archetypeId, rival.archetypeName])).entries(),
  ]
  return (
    <div className="flex flex-wrap gap-2">
      <Select
        value={value.objective ?? 'meta'}
        onValueChange={(next) =>
          onChange(
            next === 'rival'
              ? { objective: 'rival', archetypeId: archetypes[0]?.[0] }
              : { objective: next as 'meta' | 'mine' },
          )
        }
      >
        <SelectTrigger aria-label="Contra qué medir" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="meta">El meta de torneos</SelectItem>
          <SelectItem value="mine">Mi meta</SelectItem>
          <SelectItem value="rival">Un solo rival</SelectItem>
        </SelectContent>
      </Select>
      {value.objective === 'rival' ? (
        <Select
          value={value.archetypeId ?? ''}
          onValueChange={(archetypeId) => onChange({ objective: 'rival', archetypeId })}
        >
          <SelectTrigger aria-label="Arquetipo rival" className="w-56">
            <SelectValue placeholder="Elegí el arquetipo" />
          </SelectTrigger>
          <SelectContent>
            {archetypes.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}

export function LaboratorioPage() {
  useMarkSeen('laboratorio')
  // T-017 E4 (review of #64): «Buscar variantes desde esta» keeps the bank of the job it comes from.
  const carried = useLocation().state as { size?: number; objective?: LabObjectiveChoice } | null
  const [size, setSize] = useState(carried?.size ?? 15)
  const [objective, setObjective] = useState<LabObjectiveChoice>(carried?.objective ?? { objective: 'meta' })
  const bank = useLabBank(size, undefined, objective)
  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <FlaskConicalIcon aria-hidden="true" />
        <AlertDescription>{LAB_NOTE}</AlertDescription>
      </Alert>
      <Section
        title="Banco del meta"
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <ObjectivePicker value={objective} onChange={setObjective} />
            {objective.objective === 'rival' ? null : (
              <Select value={String(size)} onValueChange={(next) => setSize(Number(next))}>
                <SelectTrigger aria-label="Arquetipos del banco" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZES.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} arquetipos
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        }
      >
        {bank.isLoading ? <LoadingRows rows={4} /> : null}
        {bank.isError ? <ErrorState error={bank.error} onRetry={() => void bank.refetch()} /> : null}
        {bank.data ? <BankList bank={bank.data} /> : null}
      </Section>
      <Section title="Armar desde un núcleo">
        <CoreBuilder size={size} />
      </Section>
      <Section title="Probar contra el banco">
        <TestForm size={size} objective={objective} />
      </Section>
      <Section title="Buscar variantes">
        <ExploreForm size={size} objective={objective} />
      </Section>
      <Section title="Pruebas y búsquedas">
        <LabJobsList />
      </Section>
    </div>
  )
}
