/**
 * New simulation (PLAN §3.7, Fase 6): matrix, compare or optimize; decks from my list or tournament lists; bots, games
 * per pairing, seed (random unless given) and replays. The preview marks «no simulable» with the card and the reason
 * before anything is queued, and asks for an energy where a list has none.
 */
import { DicesIcon, PlusIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDeck, useDecks } from '@/api/decks'
import type {
  SelectableEnergy,
  SimulationInput,
  SimulationKind,
  SimulationPreview,
  SimulationSource,
  TournamentFormat,
} from '@/api/schemas'
import { SIMULATION_KINDS } from '@/api/schemas'
import { useCreateSimulation, useEngineInfo, usePreviewSimulation } from '@/api/simulations'
import { useTournamentLists } from '@/api/tournaments'
import { CardSearch } from '@/components/CardSearch'
import { EnergyPicker } from '@/components/EnergyChip'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { SearchBox } from '@/components/SearchBox'
import { Field, Section } from '@/components/Section'
import { Stepper } from '@/components/Stepper'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { energyLabel } from '@/lib/energies'
import { formatNumber, plural } from '@/lib/format'
import {
  decodeSource,
  formatDuration,
  gamesLabel,
  KIND_HINT,
  KIND_LABEL,
  multisetCount,
  sourceId,
} from '@/lib/simulation'
import { FORMAT_LABEL } from '@/lib/tournaments'
import { useDebouncedValue } from '@/lib/useDebounce'

interface Picked {
  source: SimulationSource
  label: string
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

const MAX_SEED = 2 ** 52

/** Decks and tournament lists to add to one side. */
function SourceAdder({ picked, onAdd }: { picked: Picked[]; onAdd: (items: Picked[]) => void }) {
  const [tab, setTab] = useState<'decks' | 'lists'>('decks')
  const [filter, setFilter] = useState('')
  const [format, setFormat] = useState<TournamentFormat>('STANDARD')
  const decks = useDecks({ archived: false })
  const lists = useTournamentLists({ format }, 'group')
  const taken = new Set(picked.map((item) => sourceId(item.source)))
  const folded = fold(filter.trim())

  const deckItems: Picked[] = (decks.data ?? [])
    .map((deck) => ({ source: { deckId: deck.id }, label: deck.name }) satisfies Picked)
    .filter((item) => !taken.has(sourceId(item.source)) && (folded === '' || fold(item.label).includes(folded)))
  const era = lists.data?.scope.era.code
  const listItems: (Picked & { hint: string })[] = (lists.data?.rows ?? [])
    .map((row) => ({
      source: { listKey: row.key, ...(era ? { era } : {}), format, kind: 'group' as const },
      label: `${row.archetype.name} · lista ${row.key.slice(0, 6)}`,
      hint: `${plural(row.lists, 'lista', 'listas')} en ${era ?? '—'} ${FORMAT_LABEL[format]}`,
    }))
    .filter((item) => !taken.has(sourceId(item.source)) && (folded === '' || fold(item.label).includes(folded)))

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'decks' | 'lists')}>
        <TabsList className="w-full">
          <TabsTrigger value="decks">Mis mazos</TabsTrigger>
          <TabsTrigger value="lists">Listas de torneo</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex gap-2">
        <SearchBox value={filter} onChange={setFilter} placeholder="Filtrar" className="flex-1" />
        {tab === 'lists' ? (
          <Select value={format} onValueChange={(value) => setFormat(value as TournamentFormat)}>
            <SelectTrigger aria-label="Formato" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="STANDARD">{FORMAT_LABEL.STANDARD}</SelectItem>
              <SelectItem value="NOEX">{FORMAT_LABEL.NOEX}</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {tab === 'decks' ? (
        decks.isPending ? (
          <LoadingRows rows={3} />
        ) : decks.isError ? (
          <ErrorState error={decks.error} onRetry={() => decks.refetch()} />
        ) : (
          <>
            {deckItems.length > 1 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onAdd(deckItems)}>
                Agregar los {deckItems.length}
              </Button>
            ) : null}
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {deckItems.map((item) => (
                <li key={sourceId(item.source)}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-sm hover:bg-muted"
                    onClick={() => onAdd([item])}
                  >
                    <PlusIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </button>
                </li>
              ))}
              {deckItems.length === 0 ? (
                <li className="p-2 text-sm text-muted-foreground">Nada para agregar.</li>
              ) : null}
            </ul>
          </>
        )
      ) : lists.isPending ? (
        <LoadingRows rows={3} />
      ) : lists.isError ? (
        <ErrorState error={lists.error} onRetry={() => lists.refetch()} />
      ) : (
        <>
          {listItems.length > 10 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onAdd(listItems.slice(0, 10))}>
              Agregar las 10 más jugadas
            </Button>
          ) : null}
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {listItems.slice(0, 100).map((item) => (
              <li key={sourceId(item.source)}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => onAdd([{ source: item.source, label: item.label }])}
                >
                  <PlusIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">{item.hint}</span>
                  </span>
                </button>
              </li>
            ))}
            {listItems.length === 0 ? (
              <li className="p-2 text-sm text-muted-foreground">Sin listas para esta era y formato.</li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  )
}

/** One side of the job: what was picked, its «no simulable» reasons from the preview, and an energy where missing. */
function SideEditor({
  title,
  hint,
  picked,
  onChange,
  preview,
  single,
}: {
  title: string
  hint?: string
  picked: Picked[]
  onChange: (next: Picked[]) => void
  preview: SimulationPreview['sideA'] | undefined
  single?: boolean
}) {
  const [adding, setAdding] = useState(picked.length === 0)
  function setEnergies(index: number, energies: SelectableEnergy[]) {
    onChange(
      picked.map((item, i) =>
        i === index
          ? { ...item, source: { ...item.source, ...(energies.length > 0 ? { energies } : { energies: undefined }) } }
          : item,
      ),
    )
  }
  return (
    <Section
      title={title}
      action={
        picked.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
            Vaciar
          </Button>
        ) : null
      }
    >
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {picked.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {picked.map((item, index) => {
            const snapshot = preview?.[index]
            const energyProblem = snapshot?.problems.find((problem) => problem.kind === 'energy_required')
            const others = snapshot?.problems.filter((problem) => problem.kind !== 'energy_required') ?? []
            return (
              <li key={sourceId(item.source)} className="flex flex-col gap-1.5 px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{snapshot?.label ?? item.label}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {'listKey' in item.source ? <span>lista de torneo</span> : <span>mi mazo</span>}
                      {snapshot ? (
                        snapshot.simulable ? (
                          <Badge variant="secondary">simulable</Badge>
                        ) : (
                          <Badge variant="destructive">no simulable</Badge>
                        )
                      ) : null}
                      {snapshot && snapshot.energies.length > 0 ? (
                        <span>energía {snapshot.energies.map(energyLabel).join(', ')}</span>
                      ) : null}
                      {snapshot && snapshot.remapped.length > 0 ? (
                        <span title={snapshot.remapped.map((r) => `${r.cardId} → ${r.playedAs}`).join('\n')}>
                          {plural(snapshot.remapped.length, 'reimpresión jugada', 'reimpresiones jugadas')} como otra
                          edición
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar ${item.label}`}
                    onClick={() => onChange(picked.filter((_, i) => i !== index))}
                  >
                    <XIcon />
                  </Button>
                </div>
                {others.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-destructive">
                    {others.map((problem) => (
                      <li key={`${problem.kind}-${problem.message}`}>{problem.message}</li>
                    ))}
                  </ul>
                ) : null}
                {energyProblem || item.source.energies ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      {energyProblem
                        ? `Elegí la energía para simular${
                            energyProblem.suggested?.length
                              ? ` (sugerida: ${energyProblem.suggested.map(energyLabel).join(', ')})`
                              : ''
                          }`
                        : 'Energía elegida para la simulación'}
                    </span>
                    <EnergyPicker
                      label={`Energía de ${item.label}`}
                      value={item.source.energies ?? []}
                      onChange={(next) => setEnergies(index, next)}
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      {single && picked.length >= 1 ? null : adding ? (
        <SourceAdder
          picked={picked}
          onAdd={(items) => {
            onChange(single ? items.slice(0, 1) : [...picked, ...items])
            if (single) setAdding(false)
          }}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          <PlusIcon data-icon="inline-start" />
          Agregar
        </Button>
      )}
    </Section>
  )
}

/** Optimize: copies to take out of the deck and the candidates to try in their place. */
function OptimizeEditor({
  deckId,
  remove,
  onRemove,
  candidates,
  onCandidates,
}: {
  deckId: string | null
  remove: Record<string, number>
  onRemove: (next: Record<string, number>) => void
  candidates: { id: string; nameEs: string }[]
  onCandidates: (next: { id: string; nameEs: string }[]) => void
}) {
  const deck = useDeck(deckId ?? undefined)
  if (!deckId) return <p className="text-sm text-muted-foreground">Elegí uno de tus mazos para optimizar.</p>
  return (
    <>
      <Section title="Cartas a sacar">
        {deck.isPending ? (
          <LoadingRows rows={4} />
        ) : deck.isError ? (
          <ErrorState error={deck.error} onRetry={() => deck.refetch()} />
        ) : (
          <ul className="divide-y rounded-lg border">
            {deck.data.cards.map((line) => (
              <li key={line.card.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {line.card.nameEs} <span className="text-xs text-muted-foreground">×{line.count}</span>
                </span>
                <Stepper
                  label={`copias de ${line.card.nameEs} a sacar`}
                  value={remove[line.card.id] ?? 0}
                  min={0}
                  max={Math.min(2, line.count)}
                  onChange={(next) => {
                    const copy = { ...remove }
                    if (next > 0) copy[line.card.id] = next
                    else delete copy[line.card.id]
                    onRemove(copy)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Candidatas">
        <p className="text-xs text-muted-foreground">
          Se prueban todas las combinaciones (con repetición) de las candidatas en los huecos; si una edición no está en
          el motor se juega otra de la misma carta.
        </p>
        {candidates.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {candidates.map((card) => (
              <li key={card.id}>
                <Badge variant="outline" className="gap-1 py-1">
                  {card.nameEs}
                  <button
                    type="button"
                    aria-label={`Quitar ${card.nameEs}`}
                    onClick={() => onCandidates(candidates.filter((other) => other.id !== card.id))}
                  >
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <CardSearch
          keepQuery
          limit={10}
          placeholder="Agregar candidata…"
          onPick={(hit) => {
            if (candidates.some((card) => card.id === hit.card.id) || candidates.length >= 30) return
            onCandidates([...candidates, { id: hit.card.id, nameEs: hit.card.nameEs }])
          }}
        />
      </Section>
    </>
  )
}

function initialSides(params: URLSearchParams): { a: Picked[]; b: Picked[] } {
  const read = (key: string) =>
    params
      .getAll(key)
      .map((token) => decodeSource(token))
      .filter((source): source is SimulationSource => source !== null)
      .map((source) => ({ source, label: 'deckId' in source ? `Mazo ${source.deckId}` : `Lista ${source.listKey}` }))
  return { a: read('a'), b: read('b') }
}

export function NewSimulationPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const engine = useEngineInfo()
  const preview = usePreviewSimulation()
  const create = useCreateSimulation()

  const initial = useMemo(() => initialSides(params), [params])
  const kindParam = params.get('tipo')
  const [kind, setKind] = useState<SimulationKind>(
    (SIMULATION_KINDS as readonly string[]).includes(kindParam ?? '')
      ? (kindParam as SimulationKind)
      : initial.b.length > 0
        ? 'compare'
        : 'matrix',
  )
  const [sideA, setSideA] = useState<Picked[]>(initial.a)
  const [sideB, setSideB] = useState<Picked[]>(initial.b)
  const [players, setPlayers] = useState<[string, string]>(['e2', 'e2'])
  const [games, setGames] = useState('200')
  const [seed, setSeed] = useState('')
  const [label, setLabel] = useState('')
  const [replaySample, setReplaySample] = useState('2')
  const [bothOrders, setBothOrders] = useState(false)
  const [skipNotSimulable, setSkipNotSimulable] = useState(false)
  const [remove, setRemove] = useState<Record<string, number>>({})
  const [candidates, setCandidates] = useState<{ id: string; nameEs: string }[]>([])

  const gamesNumber = Number(games)
  const seedNumber = seed.trim() === '' ? undefined : Number(seed)
  const seedError =
    seedNumber !== undefined && (!Number.isInteger(seedNumber) || seedNumber < 0 || seedNumber > MAX_SEED)
      ? `La semilla va de 0 a ${formatNumber(MAX_SEED)}.`
      : null
  const gamesError =
    !Number.isInteger(gamesNumber) || gamesNumber < 1 || gamesNumber > 20_000 ? 'Entre 1 y 20.000 partidas.' : null
  const removed = Object.values(remove).reduce((sum, count) => sum + count, 0)
  const optimizeDeckId = kind === 'optimize' && sideA[0] && 'deckId' in sideA[0].source ? sideA[0].source.deckId : null

  const input: SimulationInput | null = useMemo(() => {
    if (sideA.length === 0 || gamesError || seedError) return null
    if ((kind === 'compare' || kind === 'optimize') && sideB.length === 0) return null
    if (kind === 'optimize' && (!optimizeDeckId || removed === 0 || candidates.length === 0)) return null
    return {
      kind,
      ...(label.trim() ? { label: label.trim() } : {}),
      sideA: (kind === 'optimize' ? sideA.slice(0, 1) : sideA).map((item) => item.source),
      sideB: sideB.map((item) => item.source),
      gamesPerPair: gamesNumber,
      players,
      ...(seedNumber !== undefined ? { seed: seedNumber } : {}),
      ...(kind === 'matrix' ? { bothOrders } : {}),
      replaySample: kind === 'optimize' ? 0 : Number(replaySample),
      ...(kind === 'optimize'
        ? {
            optimize: {
              remove: Object.entries(remove).map(([cardId, count]) => ({ cardId, count })),
              candidates: candidates.map((card) => card.id),
            },
          }
        : {}),
    }
  }, [
    kind,
    label,
    sideA,
    sideB,
    gamesNumber,
    gamesError,
    players,
    seedNumber,
    seedError,
    bothOrders,
    replaySample,
    remove,
    removed,
    candidates,
    optimizeDeckId,
  ])

  const debounced = useDebouncedValue(input ? JSON.stringify(input) : null, 400)
  // The estimate uses the cores of the worker online (the first one), 8 by default like the worker.
  const cores = engine.data?.workers.find((worker) => worker.online)?.cores ?? 8
  const { mutate: runPreview, reset: resetPreview } = preview
  useEffect(() => {
    if (debounced) runPreview({ ...(JSON.parse(debounced) as SimulationInput), cores })
    else resetPreview()
  }, [debounced, cores, runPreview, resetPreview])

  const data = debounced && input && JSON.stringify(input) === debounced ? preview.data : undefined
  const notSimulable = data ? [...data.sideA, ...data.sideB].filter((snapshot) => !snapshot.simulable).length : 0
  const rivals = data ? data.sideB.filter((snapshot) => snapshot.simulable).length : 0
  const combinations = kind === 'optimize' ? multisetCount(candidates.length, removed) : 0
  const totalGames = kind === 'optimize' ? combinations * rivals * gamesNumber : (data?.totalGames ?? 0)
  const estimate =
    kind === 'optimize' && data && data.totalGames > 0
      ? (data.estimatedSeconds * totalGames) / data.totalGames
      : (data?.estimatedSeconds ?? 0)

  async function submit() {
    if (!input) return
    try {
      const job = await create.mutateAsync({ ...input, ...(skipNotSimulable ? { skipNotSimulable: true } : {}) })
      toast.success(`Simulación #${job.id} en cola`)
      navigate(`/simulacion/${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const bots = engine.data?.bots ?? [{ code: 'e2', label: 'Expectiminimax (profundidad 2)' }]
  const sideBTitle = kind === 'matrix' ? 'Contra (opcional)' : 'Rivales'
  const sideBHint =
    kind === 'matrix'
      ? 'Vacío: todos contra todos dentro de la lista de arriba. Con mazos acá: cada uno de arriba contra cada uno de estos.'
      : undefined

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Tabs value={kind} onValueChange={(value) => setKind(value as SimulationKind)}>
          <TabsList className="w-full">
            {SIMULATION_KINDS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {KIND_LABEL[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">{KIND_HINT[kind]}</p>
      </div>

      <SideEditor
        key={`a-${kind === 'optimize'}`}
        title={kind === 'optimize' ? 'Mazo' : kind === 'compare' ? 'Mis mazos' : 'Mazos'}
        picked={sideA}
        onChange={setSideA}
        preview={data?.sideA}
        single={kind === 'optimize'}
      />
      {kind === 'optimize' ? (
        <OptimizeEditor
          deckId={optimizeDeckId}
          remove={remove}
          onRemove={setRemove}
          candidates={candidates}
          onCandidates={setCandidates}
        />
      ) : null}
      <SideEditor title={sideBTitle} hint={sideBHint} picked={sideB} onChange={setSideB} preview={data?.sideB} />

      <Section title="Partidas">
        <div className="grid grid-cols-2 gap-3">
          {(['A', 'B'] as const).map((side, index) => (
            <Field key={side} label={`Bot de ${side === 'A' ? 'mis mazos' : 'los rivales'}`}>
              <Select
                value={players[index]}
                onValueChange={(value) =>
                  setPlayers((current) => (index === 0 ? [value, current[1]] : [current[0], value]))
                }
              >
                <SelectTrigger className="w-full" aria-label={`Bot del lado ${side}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bots.map((bot) => (
                    <SelectItem key={bot.code} value={bot.code}>
                      {bot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}
          <Field
            label={kind === 'optimize' ? 'Partidas por rival y combinación' : 'Partidas por cruce'}
            htmlFor="sim-games"
            hint={gamesError ?? undefined}
          >
            <Input
              id="sim-games"
              inputMode="numeric"
              value={games}
              onChange={(event) => setGames(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="Semilla" htmlFor="sim-seed" hint={seedError ?? 'Vacía: al azar. La misma semilla repite todo.'}>
            <div className="flex gap-1">
              <Input
                id="sim-seed"
                inputMode="numeric"
                placeholder="al azar"
                value={seed}
                onChange={(event) => setSeed(event.target.value.replace(/\D/g, ''))}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Semilla al azar"
                onClick={() => setSeed(String(Math.floor(Math.random() * 2 ** 32)))}
              >
                <DicesIcon />
              </Button>
            </div>
          </Field>
          {kind !== 'optimize' ? (
            <Field label="Repeticiones guardadas por cruce">
              <Select value={replaySample} onValueChange={setReplaySample}>
                <SelectTrigger className="w-full" aria-label="Repeticiones por cruce">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['0', '1', '2', '3', '4', '5'].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Nombre (opcional)" htmlFor="sim-label" className="col-span-2">
            <Input id="sim-label" value={label} maxLength={200} onChange={(event) => setLabel(event.target.value)} />
          </Field>
        </div>
        {kind === 'matrix' ? (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="sim-both" checked={bothOrders} onCheckedChange={(value) => setBothOrders(value === true)} />
            <label htmlFor="sim-both">Cada cruce en los dos sentidos (A contra B y B contra A)</label>
          </div>
        ) : null}
      </Section>

      <Section title="Resumen">
        {!input ? (
          <p className="text-sm text-muted-foreground">
            {kind === 'optimize'
              ? 'Elegí el mazo, las cartas a sacar, las candidatas y al menos un rival.'
              : kind === 'compare'
                ? 'Elegí al menos un mazo de cada lado.'
                : 'Elegí al menos dos mazos.'}
          </p>
        ) : preview.isError ? (
          <ErrorState error={preview.error} />
        ) : !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Revisando los mazos…
          </p>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
            {kind === 'optimize' ? (
              <p>
                {plural(combinations, 'combinación', 'combinaciones')} × {plural(rivals, 'rival', 'rivales')} ×{' '}
                {gamesLabel(gamesNumber)} = <strong>{gamesLabel(totalGames)}</strong>
                {combinations > 200 ? (
                  <span className="block text-destructive">El límite es 200 combinaciones.</span>
                ) : null}
              </p>
            ) : (
              <p>
                {plural(data.pairings, 'cruce', 'cruces')} × {gamesLabel(gamesNumber)} ={' '}
                <strong>{gamesLabel(data.totalGames)}</strong>
              </p>
            )}
            <p className="text-muted-foreground">
              Tiempo estimado con {cores} núcleos: alrededor de {formatDuration(estimate)} (varía mucho según los
              mazos).
            </p>
            {notSimulable > 0 ? (
              <div className="flex items-start gap-2 text-destructive">
                <Checkbox
                  id="sim-skip"
                  checked={skipNotSimulable}
                  onCheckedChange={(value) => setSkipNotSimulable(value === true)}
                />
                <label htmlFor="sim-skip">
                  {plural(notSimulable, 'mazo no es simulable', 'mazos no son simulables')} (motivos arriba). Saltearlos
                  y simular el resto.
                </label>
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <Button
        type="submit"
        size="lg"
        disabled={
          !input ||
          !data ||
          create.isPending ||
          (notSimulable > 0 && !skipNotSimulable) ||
          (kind === 'optimize' && combinations > 200)
        }
      >
        {create.isPending ? <Spinner /> : null}
        Encolar
      </Button>
    </form>
  )
}
