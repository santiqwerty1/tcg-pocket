/**
 * Armar desde un núcleo (Fase 19): pick 1–4 cards, get a first list from what the era's tournament lists that play
 * them also play, then test it against the meta, search variants that keep the core, or save it as a deck.
 */
import { BlocksIcon, FlaskConicalIcon, SaveIcon, SearchIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateDeck } from '@/api/decks'
import { useLabCore, useLabExplore, useLabTest } from '@/api/lab'
import type { LabCore, SelectableEnergy } from '@/api/schemas'
import { CardSearch } from '@/components/CardSearch'
import { EnergyChips, EnergyPicker } from '@/components/EnergyChip'
import { Field } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const MAX_CORE = 4
type CorePool = 'collection' | 'all'
const POOL_ES: Record<CorePool, string> = { collection: 'Solo lo que tengo', all: 'Cualquier carta' }
const REASON_ES = { core: 'núcleo', line: 'línea evolutiva' } as const

function CoreDraft({ draft, size, name }: { draft: LabCore; size: number; name: string }) {
  const navigate = useNavigate()
  const test = useLabTest()
  const explore = useLabExplore()
  const createDeck = useCreateDeck()
  const cards = draft.cards.map((card) => ({ cardId: card.cardId, count: card.count }))
  const ready = draft.problems.length === 0 && draft.energies.length > 0
  const deck = { cards, energies: draft.energies, name }
  const core = draft.cards.filter((card) => card.reason === 'core').map((card) => card.cardId)

  async function run(work: () => Promise<{ id: number }>, what: string) {
    try {
      const job = await work()
      toast.success(`${what} #${job.id} en cola`)
      navigate(`/laboratorio/${job.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function save() {
    try {
      const created = await createDeck.mutateAsync({ name, energies: draft.energies, cards })
      toast.success('Mazo guardado')
      navigate(`/mazos/${created.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-sm">{draft.basis.text}.</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <EnergyChips energies={draft.energies} />
        <span className={draft.total === 20 ? 'text-muted-foreground' : 'text-warning'}>
          {draft.total} de 20 cartas
        </span>
      </div>
      {draft.left.length > 0 ? (
        <ul className="text-sm text-warning">
          {draft.left.map((item) => (
            <li key={item.cardId}>
              {item.nameEs}: {item.reason}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="divide-y rounded-md border text-sm">
        {draft.cards.map((card) => (
          <li key={card.groupId} className="flex items-baseline gap-2 px-3 py-1.5">
            <span className="w-4 text-right tabular-nums">{card.count}</span>
            <span className="min-w-0 flex-1 truncate">
              {card.nameEs} <span className="text-xs text-muted-foreground">{card.cardId}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {card.reason === 'usage' && card.share !== null
                ? `${Math.round(card.share)} % de las listas`
                : REASON_ES[card.reason === 'usage' ? 'core' : card.reason]}
            </span>
          </li>
        ))}
      </ul>
      {draft.problems.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {draft.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Es un punto de partida armado con listas de torneo, no un mazo probado. {draft.attribution}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!ready || test.isPending}
          onClick={() => void run(() => test.mutateAsync({ decks: [deck], size, gamesPerRival: 100 }), 'Prueba')}
        >
          <FlaskConicalIcon aria-hidden="true" />
          Probar contra el meta
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!ready || explore.isPending}
          onClick={() =>
            void run(() => explore.mutateAsync({ deck, size, locked: core, config: { pool: draft.pool } }), 'Búsqueda')
          }
        >
          <SearchIcon aria-hidden="true" />
          Buscar variantes
        </Button>
        <Button type="button" variant="ghost" disabled={!ready || createDeck.isPending} onClick={() => void save()}>
          <SaveIcon aria-hidden="true" />
          Guardar como mazo
        </Button>
      </div>
    </div>
  )
}

export function CoreBuilder({ size }: { size: number }) {
  const build = useLabCore()
  const [core, setCore] = useState<{ cardId: string; groupId: string; nameEs: string }[]>([])
  const [energies, setEnergies] = useState<SelectableEnergy[]>([])
  const [pool, setPool] = useState<CorePool>('collection')
  const name = `Núcleo: ${core.map((card) => card.nameEs).join(' + ')}`

  function submit() {
    build.mutate(
      { cards: core.map((card) => card.cardId), pool, ...(energies.length > 0 ? { energies } : {}) },
      { onError: (error) => toast.error(errorMessage(error)) },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Elegí de 1 a 4 cartas que quieras jugar juntas. El resto sale de lo que juegan las listas de torneo de la era
        que llevan esas cartas, con su línea evolutiva y las copias que suelen llevar.
      </p>
      {core.length < MAX_CORE ? (
        <CardSearch
          placeholder="Agregar una carta al núcleo…"
          limit={8}
          onPick={(hit) => {
            if (core.some((card) => card.groupId === hit.group.id)) return
            setCore([...core, { cardId: hit.card.id, groupId: hit.group.id, nameEs: hit.card.nameEs }])
            build.reset()
          }}
        />
      ) : null}
      {core.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {core.map((card) => (
            <li key={card.groupId}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label={`Quitar ${card.nameEs}`}
                onClick={() => {
                  setCore(core.filter((other) => other.groupId !== card.groupId))
                  build.reset()
                }}
              >
                {card.nameEs}
                <XIcon data-icon="inline-end" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="Energías (vacío: las que piden los ataques del núcleo)">
        <EnergyPicker value={energies} onChange={setEnergies} label="Energías del núcleo" />
      </Field>
      <Field label="Cartas que pueden entrar">
        <Select value={pool} onValueChange={(next) => setPool(next as CorePool)}>
          <SelectTrigger aria-label="Cartas que pueden entrar al núcleo" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(POOL_ES) as CorePool[]).map((value) => (
              <SelectItem key={value} value={value}>
                {POOL_ES[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div>
        <Button type="button" disabled={core.length === 0 || build.isPending} onClick={submit}>
          <BlocksIcon aria-hidden="true" />
          Armar
        </Button>
      </div>
      {build.data ? <CoreDraft draft={build.data} size={size} name={name} /> : null}
    </div>
  )
}
