import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { type MatchListParams, useMatches, useMatchSuggestions } from '@/api/matches'
import { MATCH_MODES, MATCH_RESULTS, type MatchMode, type MatchResult } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
import { MODE_LABEL, PERIODS, type PeriodKey, periodFrom, RESULT_LABEL } from '@/lib/matches'
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
  // `?rival=` from a stats row or an archetype (Fase 41).
  const [opponent, setOpponent] = useState(() => params.get('rival') ?? '')
  // With `?exacto=1` only that rival, not every name that contains it; typing goes back to a search.
  const [exact, setExact] = useState(() => params.get('exacto') === '1')
  // A stats row also passes its modality and period (Fase 41), so the history shows the matches the row counted.
  const modeParam = params.get('modalidad')
  const mode = (MATCH_MODES as readonly string[]).includes(modeParam ?? '') ? (modeParam as MatchMode) : null
  const periodParam = params.get('periodo')
  const period = PERIODS.find((item) => item.key === periodParam && item.key !== 'all')
  const from = useMemo(() => (period ? periodFrom(period.key as PeriodKey) : undefined), [period])
  const [page, setPage] = useState(0)
  const debouncedOpponent = useDebouncedValue(opponent.trim(), 300)
  const suggestions = useMatchSuggestions()

  const query = useMemo<MatchListParams>(
    () => ({
      ...(deckId === ALL ? {} : { deckId }),
      ...(result ? { result } : {}),
      ...(mode ? { mode } : {}),
      ...(from ? { from } : {}),
      ...(debouncedOpponent ? { opponent: debouncedOpponent } : {}),
      ...(debouncedOpponent && exact ? { opponentMatch: 'exact' as const } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [deckId, result, mode, from, debouncedOpponent, exact, page],
  )
  const matches = useMatches(query)
  const total = matches.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const deckOptions = suggestions.data?.decks ?? []
  const unknownDeck = deckId !== ALL && !deckOptions.some((deck) => deck.id === deckId)

  function clearStatsFilters() {
    setPage(0)
    const next = new URLSearchParams(params)
    next.delete('modalidad')
    next.delete('periodo')
    setParams(next, { replace: true, preventScrollReset: true })
  }

  function setDeck(value: string) {
    setPage(0)
    const next = new URLSearchParams(params)
    if (value === ALL) next.delete('mazo')
    else next.set('mazo', value)
    setParams(next, { replace: true, preventScrollReset: true })
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
        {mode || period ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">
              Como en las estadísticas:{' '}
              {[mode ? MODE_LABEL[mode] : null, period ? `últimos ${period.label}` : null].filter(Boolean).join(' · ')}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={clearStatsFilters}>
              <XIcon data-icon="inline-start" />
              Quitar
            </Button>
          </div>
        ) : null}
        <Input
          aria-label="Rival"
          placeholder="Filtrar por rival"
          value={opponent}
          onChange={(event) => {
            setPage(0)
            setExact(false)
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
            {total === 1 ? '1 partida' : `${formatNumber(total)} partidas`}
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
