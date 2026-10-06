import { SaveIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateDeck, useDeck, useDecks, useUpdateDeck, useValidateDeck } from '@/api/decks'
import type { DeckDetail, SelectableEnergy } from '@/api/schemas'
import { usePageTitle } from '@/app/AppShell'
import { CardSearch } from '@/components/CardSearch'
import { EnergyPicker } from '@/components/EnergyChip'
import { IssueList } from '@/components/IssueList'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { CardCode, Field, Section } from '@/components/Section'
import { Stepper } from '@/components/Stepper'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useDebouncedValue } from '@/lib/useDebounce'
import { cn } from '@/lib/utils'
import {
  addCard,
  DECK_SIZE,
  type EditorCard,
  type EditorState,
  formatDeckCount,
  fromDeckCards,
  groupByType,
  isDeckSizeOk,
  setCount,
  toDeckInput,
  totalCount,
} from './deckLogic'

const NONE = '__none__'
const PRIORITY_LABEL: Record<'0' | '1' | '2' | '3', string> = {
  '0': 'Sin prioridad de sobres',
  '1': 'Prioridad baja',
  '2': 'Prioridad media',
  '3': 'Prioridad alta',
}

function initialState(deck?: DeckDetail): EditorState {
  if (!deck) return { name: '', energies: [], cards: [], tags: '', notes: '', variantOfId: null, packPriority: null }
  const priority = deck.packPriority
  return {
    name: deck.name,
    energies: deck.energies,
    cards: fromDeckCards(deck.cards),
    tags: deck.tags.join(', '),
    notes: deck.notes ?? '',
    variantOfId: deck.variantOfId,
    packPriority: priority === 0 || priority === 1 || priority === 2 || priority === 3 ? priority : null,
  }
}

export function DeckEditorPage() {
  const { deckId } = useParams()
  const navigate = useNavigate()
  const existing = useDeck(deckId)
  const [state, setState] = useState<EditorState>(() => initialState())
  const [loadedId, setLoadedId] = useState<string | null>(null)

  // Fill the form once the deck arrives (edit mode); later refetches must not clobber what is being typed.
  useEffect(() => {
    if (deckId && existing.data && loadedId !== existing.data.id) {
      setState(initialState(existing.data))
      setLoadedId(existing.data.id)
    }
  }, [deckId, existing.data, loadedId])

  usePageTitle(deckId ? (existing.data ? `Editar «${existing.data.name}»` : undefined) : 'Nuevo mazo')

  if (deckId && existing.isPending) return <LoadingRows />
  if (deckId && existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />
  if (deckId && loadedId !== deckId) return <LoadingRows />

  return (
    <DeckEditorForm
      key={loadedId ?? 'new'}
      initial={state}
      deckId={deckId}
      onSaved={(id) => navigate(`/mazos/${encodeURIComponent(id)}`, { replace: true })}
      onCancel={() => navigate(deckId ? `/mazos/${encodeURIComponent(deckId)}` : '/mazos')}
    />
  )
}

function DeckEditorForm({
  initial,
  deckId,
  onSaved,
  onCancel,
}: {
  initial: EditorState
  deckId: string | undefined
  onSaved: (id: string) => void
  onCancel: () => void
}) {
  const [state, setState] = useState<EditorState>(initial)
  const create = useCreateDeck()
  const update = useUpdateDeck()
  const validate = useValidateDeck()
  const decks = useDecks({ archived: false })
  const total = totalCount(state.cards)
  const saving = create.isPending || update.isPending

  // Live validation against the API, debounced; the validator is shared with the server (PLAN §3.3).
  const validationKey = useMemo(
    () => JSON.stringify({ cards: state.cards.map((c) => [c.card.id, c.count]), energies: state.energies }),
    [state.cards, state.energies],
  )
  const debouncedKey = useDebouncedValue(validationKey, 400)
  const { mutate: runValidation, reset: resetValidation } = validate
  useEffect(() => {
    const payload = JSON.parse(debouncedKey) as { cards: [string, number][]; energies: SelectableEnergy[] }
    if (payload.cards.length === 0) {
      resetValidation()
      return
    }
    runValidation({ cards: payload.cards.map(([cardId, count]) => ({ cardId, count })), energies: payload.energies })
  }, [debouncedKey, runValidation, resetValidation])

  function patch(partial: Partial<EditorState>) {
    setState((prev) => ({ ...prev, ...partial }))
  }

  async function save() {
    const input = toDeckInput(state)
    if (!input.name) {
      toast.error('Poné un nombre al mazo.')
      return
    }
    try {
      const saved = deckId ? await update.mutateAsync({ id: deckId, patch: input }) : await create.mutateAsync(input)
      toast.success(saved.valid ? 'Mazo guardado' : 'Mazo guardado con errores de validación')
      onSaved(saved.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const { pokemon, trainers } = groupByType(state.cards)
  const result = validate.data

  return (
    <div className="flex flex-col gap-6">
      <Field label="Nombre" htmlFor="deck-name">
        <Input
          id="deck-name"
          value={state.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Mega-Lucario ex / Lucario"
          autoComplete="off"
        />
      </Field>

      <Field label="Energías" hint="Las que genera la Zona de Energía. Dragón e Incoloro no se eligen.">
        <EnergyPicker value={state.energies} onChange={(energies) => patch({ energies })} />
      </Field>

      <Section
        title="Cartas"
        action={
          <span
            className={cn('text-xl font-semibold tabular', isDeckSizeOk(total) ? 'text-success' : 'text-warning')}
            aria-live="polite"
            title={`${total} de ${DECK_SIZE} cartas`}
          >
            {formatDeckCount(total)}
          </span>
        }
      >
        <CardSearch
          keepQuery
          placeholder="Agregar carta (nombre o código)…"
          onPick={(hit) => {
            if (total >= DECK_SIZE) {
              toast.warning(`El mazo ya tiene ${DECK_SIZE} cartas.`)
              return
            }
            patch({ cards: addCard(state.cards, hit) })
          }}
        />
        {state.cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Buscá una carta y tocala para agregarla. Cada entrada guarda su edición.
          </p>
        ) : null}
        {[
          { title: 'Pokémon', items: pokemon },
          { title: 'Entrenadores', items: trainers },
        ]
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.title} className="rounded-lg border">
              <div className="flex items-center justify-between px-3 py-2 text-sm font-medium">
                <span>{group.title}</span>
                <span className="text-muted-foreground tabular">{totalCount(group.items)}</span>
              </div>
              <ul className="divide-y border-t">
                {group.items.map((entry) => (
                  <EditorRow
                    key={entry.card.id}
                    entry={entry}
                    onCount={(count) => patch({ cards: setCount(state.cards, entry.card.id, count) })}
                  />
                ))}
              </ul>
            </div>
          ))}
      </Section>

      <Section title="Validación en vivo">
        {validate.isPending && !result ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Validando…
          </p>
        ) : null}
        {validate.isError ? <ErrorState error={validate.error} /> : null}
        {state.cards.length === 0 ? <p className="text-sm text-muted-foreground">Agregá cartas para validar.</p> : null}
        {result ? (
          <div className={cn('flex flex-col gap-2', validate.isPending && 'opacity-60')}>
            {result.validation.ok ? <p className="text-sm text-success">El mazo cumple las reglas del juego.</p> : null}
            <IssueList issues={result.validation.errors} level="error" />
            <IssueList issues={result.validation.warnings} level="warning" />
            <IssueList issues={result.validation.infos} level="info" />
            {result.completeness.complete ? (
              <p className="text-sm text-success">Tenés todas las cartas.</p>
            ) : (
              <p className="text-sm text-warning">
                {result.completeness.missingCount === 1
                  ? 'Falta 1 copia'
                  : `Faltan ${result.completeness.missingCount} copias`}
                : {result.completeness.missing.map((m) => `${m.nameEs} ${m.have}/${m.need}`).join(' · ')}
              </p>
            )}
          </div>
        ) : null}
      </Section>

      <Section title="Más datos">
        <Field label="Etiquetas" htmlFor="deck-tags" hint="Separadas por coma: competitivo, casual, misión">
          <Input
            id="deck-tags"
            value={state.tags}
            onChange={(event) => patch({ tags: event.target.value })}
            autoComplete="off"
          />
        </Field>
        <Field label="Notas" htmlFor="deck-notes">
          <Textarea
            id="deck-notes"
            value={state.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            rows={3}
          />
        </Field>
        <Field label="Variante de">
          <Select
            value={state.variantOfId ?? NONE}
            onValueChange={(value) => patch({ variantOfId: value === NONE ? null : value })}
          >
            <SelectTrigger className="w-full" aria-label="Variante de">
              <SelectValue placeholder="Ningún mazo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Ningún mazo</SelectItem>
              {(decks.data ?? [])
                .filter((deck) => deck.id !== deckId)
                .map((deck) => (
                  <SelectItem key={deck.id} value={deck.id}>
                    {deck.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Prioridad de sobres">
          <Select
            value={state.packPriority === null ? NONE : String(state.packPriority)}
            onValueChange={(value) => patch({ packPriority: value === NONE ? null : (Number(value) as 0 | 1 | 2 | 3) })}
          >
            <SelectTrigger className="w-full" aria-label="Prioridad de sobres">
              <SelectValue placeholder="Sin definir" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin definir</SelectItem>
              {(['0', '1', '2', '3'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {PRIORITY_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <div className="sticky bottom-20 z-20 flex gap-2 rounded-lg border bg-background/95 p-2 backdrop-blur">
        <Button className="flex-1" size="lg" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          Guardar
        </Button>
        <Button variant="outline" size="lg" onClick={onCancel} disabled={saving}>
          <XIcon data-icon="inline-start" />
          Cancelar
        </Button>
      </div>
    </div>
  )
}

function EditorRow({ entry, onCount }: { entry: EditorCard; onCount: (count: number) => void }) {
  return (
    <li className="flex items-center gap-2 px-3 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{entry.card.nameEs}</span>
        <span className="block text-xs text-muted-foreground">
          <CardCode id={entry.card.id} link={false} /> · {entry.card.rarity}
        </span>
      </span>
      <Stepper
        value={entry.count}
        onChange={onCount}
        min={0}
        max={DECK_SIZE}
        label={`copias de ${entry.card.nameEs}`}
      />
    </li>
  )
}
