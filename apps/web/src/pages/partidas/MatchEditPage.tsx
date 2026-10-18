import { SaveIcon, Trash2Icon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDeleteMatch, useMatch, useMatchSuggestions, useUpdateMatch } from '@/api/matches'
import { useMatchRanked, useRanked } from '@/api/ranked'
import type { Match, MatchInput, MatchMode, MatchResult, MatchSuggestions } from '@/api/schemas'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'
import { fromLocalInput, toLocalInput } from '@/lib/matches'
import { ModePicker, OpponentField, ResultPicker, WentFirstPicker } from './MatchFields'
import { RankPicker } from './SeasonPage'
import { SeenCardsField, seenCardsBody } from './SeenCards'

function MatchEditForm({ match, suggestions }: { match: Match; suggestions: MatchSuggestions }) {
  const navigate = useNavigate()
  const update = useUpdateMatch()
  const remove = useDeleteMatch()
  const initialPlayedAt = toLocalInput(match.playedAt)
  const [deckId, setDeckId] = useState(match.deck.id)
  const [result, setResult] = useState<MatchResult>(match.result)
  const [opponent, setOpponent] = useState(match.opponent ?? '')
  /** 14/10: the rival's cards seen. */
  const [cards, setCards] = useState(match.opponentCards)
  const [wentFirst, setWentFirst] = useState<boolean | null>(match.wentFirst)
  const [mode, setMode] = useState<MatchMode>(match.mode)
  const [playedAt, setPlayedAt] = useState(initialPlayedAt)
  const [note, setNote] = useState(match.note)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // The match's deck may be archived (not offered for new matches): keep it selectable here.
  const deckOptions = suggestions.decks.some((deck) => deck.id === match.deck.id)
    ? suggestions.decks
    : [{ id: match.deck.id, name: `${match.deck.name} (archivado)` }, ...suggestions.decks]

  async function save(event: FormEvent) {
    event.preventDefault()
    const patch: Partial<MatchInput> = {
      result,
      opponent: opponent.trim() || null,
      wentFirst,
      mode,
      note: note.trim(),
      // Self-review: only when they changed (a card the catalog lost would refuse an edit of the note).
      ...(JSON.stringify(seenCardsBody(cards)) !== JSON.stringify(seenCardsBody(match.opponentCards))
        ? { opponentCards: seenCardsBody(cards) }
        : {}),
    }
    if (deckId !== match.deck.id) patch.deckId = deckId
    // Only a date the user touched is sent: the input drops seconds, and the date decides the deck revision.
    if (playedAt !== initialPlayedAt) {
      const iso = fromLocalInput(playedAt)
      if (!iso) {
        toast.error('La fecha no es válida.')
        return
      }
      patch.playedAt = iso
    }
    try {
      await update.mutateAsync({ id: match.id, patch })
      toast.success('Partida guardada')
      if (window.history.length > 1) navigate(-1)
      else navigate('/partidas', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function deleteMatch() {
    try {
      await remove.mutateAsync(match.id)
      toast.success('Partida borrada')
      navigate('/partidas', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setConfirmDelete(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={save}>
      <Field label="Mazo" htmlFor="match-deck-select">
        <Select value={deckId} onValueChange={setDeckId}>
          <SelectTrigger id="match-deck-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {deckOptions.map((deck) => (
              <SelectItem key={deck.id} value={deck.id}>
                {deck.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">
        Jugada con la revisión #{match.deckRevision} de{' '}
        <Link to={`/mazos/${encodeURIComponent(match.deck.id)}`} className="underline">
          {match.deck.name}
        </Link>
        . Si cambiás el mazo o la fecha, la revisión se recalcula.
      </p>
      <ResultPicker value={result} onChange={setResult} />
      <OpponentField value={opponent} onChange={setOpponent} suggestions={suggestions.opponents} />
      <SeenCardsField value={cards} onChange={setCards} opponent={opponent} onPickRival={setOpponent} />
      <WentFirstPicker value={wentFirst} onChange={setWentFirst} />
      <ModePicker value={mode} onChange={setMode} />
      <Field label="Fecha y hora" htmlFor="match-played-at">
        <Input
          id="match-played-at"
          type="datetime-local"
          value={playedAt}
          onChange={(event) => setPlayedAt(event.target.value)}
        />
      </Field>
      <Field label="Nota" htmlFor="match-note">
        <Textarea
          id="match-note"
          value={note}
          maxLength={2000}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Registrada {formatDateTime(match.createdAt)}
        {match.updatedAt !== match.createdAt ? ` · editada ${formatDateTime(match.updatedAt)}` : ''}
        {match.source === 'mcp' ? ' · desde Claude' : ''}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="lg" className="flex-1" disabled={update.isPending}>
          {update.isPending ? <Spinner /> : <SaveIcon data-icon="inline-start" />}
          Guardar
        </Button>
        <Button type="button" size="lg" variant="destructive" onClick={() => setConfirmDelete(true)}>
          <Trash2Icon data-icon="inline-start" />
          Borrar
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Borrar esta partida?"
        description="Deja de contar en las estadísticas. No se puede deshacer."
        confirmLabel="Borrar"
        destructive
        pending={remove.isPending}
        onConfirm={deleteMatch}
      />
    </form>
  )
}

/**
 * 18/10 (Santi: «las partidas ya registradas»): the season and the rank a competitive match was played at, and noting
 * it — just before the match, so it holds for it and the next ones of the season until the next change.
 */
function MatchRanked({ matchId }: { matchId: string }) {
  const ranked = useMatchRanked(matchId)
  const ranks = useRanked().data?.ranks
  const data = ranked.data
  if (!data?.competitive || !ranks) return null
  if (!data.season) {
    return (
      <p className="text-sm text-muted-foreground">
        No cae en ninguna temporada de ranked.{' '}
        <Link to="/partidas/temporada" className="underline">
          Cargar la temporada
        </Link>
      </p>
    )
  }
  return (
    <Section title="Ranked">
      <p className="text-sm">
        {data.season.name}: la jugaste en <span className="font-medium">{data.rank?.label ?? 'sin rango anotado'}</span>
        {data.next ? `; después anotaste ${data.next.label} (${formatDateTime(data.next.at)}).` : '.'}
      </p>
      <RankPicker
        key={data.rank?.id ?? 'none'}
        ranks={ranks}
        current={data.rank?.rank ?? null}
        beforeMatch={matchId}
        label="Rango con que la jugaste"
      />
      <p className="text-xs text-muted-foreground">
        Vale para esta partida y las siguientes de la temporada, hasta el próximo cambio que anotaste.
      </p>
    </Section>
  )
}

export function MatchEditPage() {
  const { matchId } = useParams()
  const match = useMatch(matchId)
  const suggestions = useMatchSuggestions()
  if (match.isPending || suggestions.isPending) return <LoadingRows />
  if (match.isError) return <ErrorState error={match.error} onRetry={() => match.refetch()} />
  if (suggestions.isError) return <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} />
  return (
    <div className="flex flex-col gap-6">
      <MatchEditForm key={match.data.id} match={match.data} suggestions={suggestions.data} />
      {/* Outside the form: noting the rank saves nothing else. */}
      <MatchRanked matchId={match.data.id} />
    </div>
  )
}
