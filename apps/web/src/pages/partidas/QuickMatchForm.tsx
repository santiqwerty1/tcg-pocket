/**
 * Quick-entry sheet (PLAN §3.6, Fase 2 acceptance): with the last deck preselected, logging a match takes four taps
 * from the home screen: result → opponent chip → who started → «Guardar partida». Mode defaults to the last one;
 * the note is optional. The deck and the mode stay for the next match; the rest resets.
 */
import { ChevronDownIcon, SaveIcon } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useCreateMatch, useDeleteMatch } from '@/api/matches'
import type { MatchInput, MatchMode, MatchResult, MatchSuggestions, SeenCard } from '@/api/schemas'
import { useUiSettings } from '@/api/settings'
import { DeckNumber } from '@/components/DeckNumber'
import { Spinner } from '@/components/ListState'
import { LuckCard } from '@/components/LuckCard'
import { RivalNoteHint } from '@/components/RivalNote'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { opponentKeyOf, RESULT_LABEL } from '@/lib/matches'
import { discardPending, isOfflineError, newClientRef, queueMatch } from '@/lib/offlineMatches'
import { DeckChips, ModePicker, OpponentField, ResultPicker, WentFirstPicker } from './MatchFields'
import { SeenCardsField, seenCardsBody } from './SeenCards'

function initialDeck(suggestions: MatchSuggestions, preferred: string | null | undefined): string | null {
  const candidates = [preferred, suggestions.lastDeckId, suggestions.decks[0]?.id]
  return candidates.find((id) => id && suggestions.decks.some((deck) => deck.id === id)) ?? null
}

export function QuickMatchForm({
  suggestions,
  preferredDeckId,
}: {
  suggestions: MatchSuggestions
  /** `?mazo=` from a deck page: preselects that deck. */
  preferredDeckId?: string | null
}) {
  const create = useCreateMatch()
  const remove = useDeleteMatch()
  const [deckId, setDeckId] = useState<string | null>(() => initialDeck(suggestions, preferredDeckId))
  const [result, setResult] = useState<MatchResult | null>(null)
  const [opponent, setOpponent] = useState('')
  /** 14/10: the rival's cards seen. */
  const [cards, setCards] = useState<SeenCard[]>([])
  const [wentFirst, setWentFirst] = useState<boolean | null>(null)
  const [mode, setMode] = useState<MatchMode>(suggestions.lastMode)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filter, setFilter] = useState('')
  /** Fase 13: after a loss, «¿mala racha?» for that deck and rival. */
  const [lastLoss, setLastLoss] = useState<{ deckId: string; opponent: string | null } | null>(null)

  // Own opponents first (most recent and frequent), then the tournament archetypes of the era not typed yet.
  const opponentChoices = useMemo(() => {
    const own = suggestions.opponents.map((item) => ({ key: item.key, label: item.label }))
    const seen = new Set(own.map((item) => item.key))
    const fromTournaments = suggestions.tournamentArchetypes
      .map((item) => ({ key: opponentKeyOf(item.name), label: item.name }))
      .filter((item) => item.key !== '' && !seen.has(item.key))
    return [...own, ...fromTournaments]
  }, [suggestions])

  const filteredDecks = useMemo(() => {
    const text = filter.trim().toLocaleLowerCase('es')
    return text
      ? suggestions.decks.filter((deck) => deck.id === text || deck.name.toLocaleLowerCase('es').includes(text))
      : suggestions.decks
  }, [filter, suggestions.decks])

  const { askWentFirst } = useUiSettings()
  // Fase 41: a rival note being edited is saved or cancelled first; saving the match resets the rival and would drop it.
  const [noteEditing, setNoteEditing] = useState(false)
  const canSave =
    deckId !== null && result !== null && (!askWentFirst || wentFirst !== null) && !noteEditing && !create.isPending

  async function undo(id: string) {
    try {
      await remove.mutateAsync(id)
      toast.success('Partida borrada')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  function resetForm() {
    setResult(null)
    setOpponent('')
    setCards([])
    setWentFirst(null)
    setNote('')
    setNoteOpen(false)
  }

  /** Fase 28: no signal — the match stays on the phone and goes by itself when the signal is back. */
  function keepOnPhone(clientRef: string, body: MatchInput, label: string) {
    if (!queueMatch({ clientRef, body, label, savedAt: Date.now() })) {
      toast.error('Sin señal, y el celu no dejó guardarla. Anotala y cargala después.')
      return
    }
    setLastLoss(null)
    resetForm()
    toast.success(label, {
      description: 'Sin señal: quedó en el celu y se envía sola cuando vuelva.',
      duration: 10_000,
      action: { label: 'Deshacer', onClick: () => discardPending(clientRef) },
    })
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (!deckId || !result || create.isPending) return
    const body: MatchInput = {
      deckId,
      result,
      opponent: opponent.trim() || null,
      wentFirst,
      mode,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(cards.length > 0 ? { opponentCards: seenCardsBody(cards) } : {}),
    }
    const clientRef = newClientRef()
    const deckName = suggestions.decks.find((deck) => deck.id === deckId)?.name ?? `Mazo ${deckId}`
    const label = `${RESULT_LABEL[result]} con ${deckName}${body.opponent ? ` contra ${body.opponent}` : ''}`
    if (!navigator.onLine) {
      keepOnPhone(clientRef, body, label)
      return
    }
    try {
      const match = await create.mutateAsync({ ...body, clientRef })
      setLastLoss(match.result === 'loss' ? { deckId: match.deck.id, opponent: match.opponent } : null)
      resetForm()
      toast.success(
        `${RESULT_LABEL[match.result]} con ${match.deck.name}${match.opponent ? ` contra ${match.opponent}` : ''}`,
        { duration: 10_000, action: { label: 'Deshacer', onClick: () => void undo(match.id) } },
      )
    } catch (error) {
      if (isOfflineError(error)) keepOnPhone(clientRef, body, label)
      else toast.error(`No se guardó: ${errorMessage(error)}`)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={save} aria-label="Nueva partida">
      <DeckChips decks={suggestions.decks} value={deckId} onChange={setDeckId} onMore={() => setPickerOpen(true)} />
      <ResultPicker value={result} onChange={setResult} />
      <OpponentField value={opponent} onChange={setOpponent} suggestions={opponentChoices} />
      <RivalNoteHint key={opponentKeyOf(opponent)} opponent={opponent} onEditingChange={setNoteEditing} />
      <SeenCardsField value={cards} onChange={setCards} opponent={opponent} onPickRival={setOpponent} />
      {noteEditing ? (
        <p className="-mt-2 text-xs text-warning">Guardá o cancelá la nota del rival antes de guardar la partida.</p>
      ) : null}
      <WentFirstPicker value={wentFirst} onChange={setWentFirst} />
      {askWentFirst && wentFirst === null && deckId !== null && result !== null ? (
        <p className="-mt-2 text-xs text-warning">Falta quién empezó (lo pediste en los ajustes).</p>
      ) : null}
      <ModePicker value={mode} onChange={setMode} />
      {noteOpen ? (
        <Textarea
          aria-label="Nota"
          value={note}
          maxLength={2000}
          rows={2}
          placeholder="Nota (opcional)"
          onChange={(event) => setNote(event.target.value)}
        />
      ) : (
        <Button type="button" variant="ghost" className="self-start" onClick={() => setNoteOpen(true)}>
          <ChevronDownIcon data-icon="inline-start" />
          Agregar nota
        </Button>
      )}
      {/* Fase 41: always in reach above the bottom bar, however long the form above gets. */}
      <div className="sticky bottom-20 z-20 rounded-lg border bg-background/95 p-2 backdrop-blur">
        <Button type="submit" size="lg" className="h-14 w-full text-base" disabled={!canSave}>
          {create.isPending ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          Guardar partida
        </Button>
      </div>
      {lastLoss ? (
        <LuckCard
          key={`${lastLoss.deckId}|${lastLoss.opponent ?? ''}`}
          deckId={lastLoss.deckId}
          opponent={lastLoss.opponent}
        />
      ) : null}
      {deckId === null ? (
        <p className="text-sm text-muted-foreground">Elegí el mazo con «Otro mazo…».</p>
      ) : result === null ? (
        <p className="text-sm text-muted-foreground">Falta el resultado.</p>
      ) : null}

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] pb-safe">
          <SheetHeader>
            <SheetTitle>Elegí el mazo</SheetTitle>
            <SheetDescription>Los que jugaste hace poco van primero; los archivados no aparecen.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-col gap-2 px-4 pb-4">
            <Input
              aria-label="Buscar mazo"
              placeholder="Buscar por número o nombre"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <ul className="min-h-0 divide-y overflow-y-auto rounded-lg border">
              {filteredDecks.map((deck) => (
                <li key={deck.id}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                    aria-pressed={deck.id === deckId}
                    onClick={() => {
                      setDeckId(deck.id)
                      setPickerOpen(false)
                      setFilter('')
                    }}
                  >
                    <DeckNumber id={deck.id} name={deck.name} className="text-sm" />
                    <span className="min-w-0 flex-1 truncate">{deck.name}</span>
                    {deck.games > 0 ? (
                      <span className="text-xs text-muted-foreground tabular">{deck.games} partidas</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {filteredDecks.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Ningún mazo con ese nombre.</li>
              ) : null}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
    </form>
  )
}
