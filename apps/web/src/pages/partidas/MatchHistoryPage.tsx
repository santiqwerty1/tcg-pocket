import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { type MatchListParams, useMatches, useMatchSuggestions } from '@/api/matches'
import { MATCH_RESULTS, type MatchResult } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RESULT_LABEL } from '@/lib/matches'
import { useDebouncedValue } from '@/lib/useDebounce'
import { ChoiceGroup } from './MatchFields'
import { MatchList } from './MatchList'

const PAGE_SIZE = 50
const ALL = '__all__'

/** Every match, newest first, filterable by deck (`?mazo=`), result and opponent. */
export function MatchHistoryPage() {
  const [params, setParams] = useSearchParams()
  const deckId = params.get('mazo') ?? ALL
  const [result, setResult] = useState<MatchResult | null>(null)
  const [opponent, setOpponent] = useState('')
  const [page, setPage] = useState(0)
  const debouncedOpponent = useDebouncedValue(opponent.trim(), 300)
  const suggestions = useMatchSuggestions()

  const query = useMemo<MatchListParams>(
    () => ({
      ...(deckId === ALL ? {} : { deckId }),
      ...(result ? { result } : {}),
      ...(debouncedOpponent ? { opponent: debouncedOpponent } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [deckId, result, debouncedOpponent, page],
  )
  const matches = useMatches(query)
  const total = matches.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const deckOptions = suggestions.data?.decks ?? []
  const unknownDeck = deckId !== ALL && !deckOptions.some((deck) => deck.id === deckId)

  function setDeck(value: string) {
    setPage(0)
    const next = new URLSearchParams(params)
    if (value === ALL) next.delete('mazo')
    else next.set('mazo', value)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Select value={deckId} onValueChange={setDeck}>
          <SelectTrigger aria-label="Mazo" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los mazos</SelectItem>
            {unknownDeck ? <SelectItem value={deckId}>Mazo {deckId} (archivado)</SelectItem> : null}
            {deckOptions.map((deck) => (
              <SelectItem key={deck.id} value={deck.id}>
                {deck.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ChoiceGroup label="Resultado" hiddenLabel className="grid grid-cols-3 gap-1.5">
          {MATCH_RESULTS.map((item) => (
            <Button
              key={item}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={result === item}
              className="aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              onClick={() => {
                setPage(0)
                setResult(result === item ? null : item)
              }}
            >
              {RESULT_LABEL[item]}
            </Button>
          ))}
        </ChoiceGroup>
        <Input
          aria-label="Rival"
          placeholder="Filtrar por rival"
          value={opponent}
          onChange={(event) => {
            setPage(0)
            setOpponent(event.target.value)
          }}
        />
      </div>

      {matches.isPending ? <LoadingRows /> : null}
      {matches.isError ? <ErrorState error={matches.error} onRetry={() => matches.refetch()} /> : null}
      {matches.data && matches.data.items.length === 0 ? (
        <EmptyState title="Ninguna partida con estos filtros" />
      ) : null}
      {matches.data && matches.data.items.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground tabular">
            {total === 1 ? '1 partida' : `${total} partidas`}
            {pages > 1 ? ` · página ${page + 1} de ${pages}` : ''}
          </p>
          <MatchList matches={matches.data.items} showDeck={deckId === ALL} />
          {pages > 1 ? (
            <div className="flex justify-between gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeftIcon data-icon="inline-start" />
                Más nuevas
              </Button>
              <Button variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                Más viejas
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
