/**
 * Laboratorio de mazos (T-008): the meta bank of the era, a deck (mine or pasted) against it, the automatic search of
 * variants, and the tests and searches so far. Bots play, not people: every number is a hint to try in the game.
 */
import { FlaskConicalIcon, SearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDeck, useDecks } from '@/api/decks'
import { useLabBank, useLabExplore, useLabJobs, useLabTest, usePlanLabExplore } from '@/api/lab'
import type { ExplorePool, LabBank, LabDeckSource, LabExploreInput, LabExplorePlan } from '@/api/schemas'
import { useEngineInfo } from '@/api/simulations'
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
import { formatDuration, isActive, progressFraction } from '@/lib/simulation'
import { ProgressBar, StatusBadge } from '../simulacion/SimulacionPage'

export const LAB_NOTE =
  'Juegan bots del motor deckgym (e2), no personas: el porcentaje depende del bot. Es una pista para probar en el juego, no un veredicto.'

const SIZES = [5, 10, 15, 20] as const

const pct = (value: number) => `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`

function BankList({ bank }: { bank: LabBank }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Era {bank.era}: {bank.size} arquetipos que suman el {pct(bank.coverage)} de {formatNumber(bank.lists)} listas.
        Cada uno juega su lista representativa (la misma que la «versión de torneo») y pesa según su cuota.
      </p>
      <ol className="divide-y rounded-lg border text-sm">
        {bank.rivals.map((rival, at) => (
          <li key={rival.archetypeId} className="flex items-baseline gap-2 px-3 py-2">
            <span className="w-5 shrink-0 text-xs text-muted-foreground tabular">{at + 1}</span>
            <Link to={`/torneos/listas/${rival.listKey}`} className="min-w-0 flex-1 truncate hover:underline">
              {rival.archetypeName}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground tabular">
              {pct(rival.share)} · peso {pct(rival.weight * 100)}
              {rival.rank > 0 ? ' · otra lista' : ''}
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

function TestForm({ size }: { size: number }) {
  const navigate = useNavigate()
  const test = useLabTest()
  const [source, setSource] = useState<LabDeckSource | null>(null)
  const [games, setGames] = useState('100')
  const bank = useLabBank(size)
  const rivals = bank.data?.rivals.length ?? size
  const engine = useEngineInfo()
  const cores = engine.data?.workers.find((worker) => worker.online)?.cores ?? 8
  const total = rivals * Number(games)

  async function submit() {
    if (!source) return
    try {
      const job = await test.mutateAsync({ decks: [source], size, gamesPerRival: Number(games) })
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
      <Button type="button" disabled={!source || test.isPending} onClick={() => void submit()}>
        <FlaskConicalIcon aria-hidden="true" />
        Probar contra el meta
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
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">Cartas que no se tocan</legend>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {deck.data.cards.map((entry) => {
          const id = `lock-${entry.card.id}`
          return (
            <li key={entry.card.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={id}
                checked={locked.includes(entry.card.id)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...locked, entry.card.id] : locked.filter((cardId) => cardId !== entry.card.id))
                }
              />
              <label htmlFor={id} className="min-w-0 truncate">
                {entry.count} {entry.card.nameEs}
              </label>
            </li>
          )
        })}
      </ul>
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
          <p className="text-xs text-muted-foreground">Variantes de la primera ronda:</p>
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

function ExploreForm({ size }: { size: number }) {
  const navigate = useNavigate()
  const plan = usePlanLabExplore()
  const explore = useLabExplore()
  const [source, setSource] = useState<LabDeckSource | null>(null)
  const [pool, setPool] = useState<ExplorePool>('collection')
  const [locked, setLocked] = useState<string[]>([])
  const [rounds, setRounds] = useState('8')
  const [variants, setVariants] = useState('6')
  const [games, setGames] = useState('40')
  const [confirmGames, setConfirmGames] = useState('100')
  const deckId = source && 'deckId' in source ? source.deckId : null

  const input: LabExploreInput | null = useMemo(() => {
    if (!source) return null
    return {
      deck: source,
      size,
      ...(deckId && locked.length > 0 ? { locked } : {}),
      config: {
        pool,
        maxRounds: Number(rounds),
        variantsPerRound: Number(variants),
        gamesPerRival: Number(games),
        confirmGames: Number(confirmGames),
      },
    }
  }, [source, size, deckId, locked, pool, rounds, variants, games, confirmGames])

  async function start() {
    if (!input) return
    try {
      const job = await explore.mutateAsync(input)
      toast.success(`Búsqueda #${job.id} en cola`)
      navigate(`/laboratorio/${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Prueba variantes de 1 o 2 cambios de cartas contra el banco, ronda por ronda; una variante se queda solo si le
        gana con claridad a la mejor hasta ahora. Al final, una ronda de confirmación juega la lista de partida y la
        encontrada con partidas nuevas.
      </p>
      <DeckSourcePicker
        value={source}
        onChange={(next) => {
          setSource(next)
          setLocked([])
          plan.reset()
        }}
        idPrefix="explore"
      />
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
      {deckId ? <LockPicker deckId={deckId} locked={locked} onChange={setLocked} /> : null}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Rondas como máximo" value={rounds} onChange={setRounds} min={1} max={20} />
        <NumberField label="Variantes por ronda" value={variants} onChange={setVariants} min={1} max={12} />
        <NumberField label="Partidas por rival" value={games} onChange={setGames} min={10} max={500} />
        <NumberField
          label="Confirmación (por rival)"
          value={confirmGames}
          onChange={setConfirmGames}
          min={0}
          max={1000}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!input || plan.isPending}
          onClick={() => input && plan.mutate(input, { onError: (error) => toast.error(errorMessage(error)) })}
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
              #{job.id} · {job.mode === 'test' ? 'Prueba contra el meta' : 'Búsqueda de variantes'}
              {job.era ? ` · era ${job.era}` : ''} · {formatDateTime(job.createdAt)}
            </div>
            {isActive(job.status) ? <ProgressBar fraction={progressFraction(job)} /> : null}
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function LaboratorioPage() {
  const [size, setSize] = useState(10)
  const bank = useLabBank(size)
  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <FlaskConicalIcon aria-hidden="true" />
        <AlertDescription>{LAB_NOTE}</AlertDescription>
      </Alert>
      <Section
        title="Banco del meta"
        action={
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
        }
      >
        {bank.isLoading ? <LoadingRows rows={4} /> : null}
        {bank.isError ? <ErrorState error={bank.error} onRetry={() => void bank.refetch()} /> : null}
        {bank.data ? <BankList bank={bank.data} /> : null}
      </Section>
      <Section title="Probar contra el meta">
        <TestForm size={size} />
      </Section>
      <Section title="Buscar variantes">
        <ExploreForm size={size} />
      </Section>
      <Section title="Pruebas y búsquedas">
        <LabJobsList />
      </Section>
    </div>
  )
}
