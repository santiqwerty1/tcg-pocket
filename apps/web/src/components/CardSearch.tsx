import { useState } from 'react'
import { useCardSearch } from '@/api/catalog'
import type { CardSearchHit } from '@/api/schemas'
import { SearchBox } from '@/components/SearchBox'
import { Thumb } from '@/components/Thumb'
import { Badge } from '@/components/ui/badge'
import { useDebouncedValue } from '@/lib/useDebounce'
import { cn } from '@/lib/utils'
import { ErrorState, Spinner } from './ListState'

export interface CardSearchProps {
  onPick: (hit: CardSearchHit) => void
  placeholder?: string
  autoFocus?: boolean
  /** Keeps the query after a pick (deck editor adds several cards in a row). */
  keepQuery?: boolean
  limit?: number
  className?: string
}

/** Search-as-you-type over GET /api/cards?q= (names in Spanish or English, ids, rules text). */
export function CardSearch({
  onPick,
  placeholder = 'Buscar carta…',
  autoFocus,
  keepQuery,
  limit = 20,
  className,
}: CardSearchProps) {
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 250)
  const search = useCardSearch(debounced, { limit })
  const hits = search.data ?? []

  function pick(hit: CardSearchHit) {
    onPick(hit)
    if (!keepQuery) setQuery('')
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={placeholder}
        autoFocus={autoFocus}
        label="Buscar carta"
      />
      {search.isError ? <ErrorState error={search.error} onRetry={() => search.refetch()} /> : null}
      {debounced.trim() ? (
        <ul className="divide-y rounded-lg border" aria-label="Resultados" aria-busy={search.isFetching}>
          {search.isFetching && hits.length === 0 ? (
            <li className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Spinner /> Buscando…
            </li>
          ) : null}
          {!search.isFetching && hits.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">Sin resultados para «{debounced}».</li>
          ) : null}
          {hits.map((hit) => (
            <li key={hit.card.id}>
              <button
                type="button"
                onClick={() => pick(hit)}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
              >
                <Thumb src={hit.card.imageUrl} alt="" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{hit.card.nameEs}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {hit.card.nameEn} · {hit.card.rarity}
                    {hit.group.editionCount > 1 ? ` · ${hit.group.editionCount} ediciones` : ''}
                  </span>
                </span>
                <Badge variant="outline" className="font-mono">
                  {hit.card.id}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
