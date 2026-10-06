import { useState } from 'react'
import { Link } from 'react-router'
import { useCollectionGroups } from '@/api/collection'
import { ExpansionSelect } from '@/components/ExpansionSelect'
import { EmptyState, ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { SearchBox } from '@/components/SearchBox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatNumber } from '@/lib/format'
import { useDebouncedValue } from '@/lib/useDebounce'
import { cn } from '@/lib/utils'

/** Collection by functional card: one row per group with its playable copies. */
export function ByGroupTab() {
  const [query, setQuery] = useState('')
  const [expansion, setExpansion] = useState<string | undefined>(undefined)
  const [missingOnly, setMissingOnly] = useState(false)
  const q = useDebouncedValue(query, 250)
  const groups = useCollectionGroups({ q, ...(expansion ? { expansion } : {}), missingOnly })
  const items = groups.data?.pages.flatMap((page) => page.items) ?? []
  const total = groups.data?.pages[0]?.total

  return (
    <div className="flex flex-col gap-3 pt-2">
      <SearchBox value={query} onChange={setQuery} placeholder="Nombre, código o texto…" />
      <div className="flex flex-wrap items-center gap-3">
        <ExpansionSelect value={expansion} onChange={setExpansion} className="min-w-44" />
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={missingOnly} onCheckedChange={setMissingOnly} />
          Solo faltantes
        </Label>
        {total !== undefined ? (
          <span className="ml-auto text-sm text-muted-foreground tabular">{formatNumber(total)} cartas</span>
        ) : null}
      </div>

      {groups.isPending ? <LoadingRows /> : null}
      {groups.isError ? <ErrorState error={groups.error} onRetry={() => groups.refetch()} /> : null}
      {groups.data && items.length === 0 ? <EmptyState title="Ninguna carta coincide" /> : null}

      {items.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {items.map(({ group, playable, fromStock, hasAdjustment }) => (
            <li key={group.id}>
              <Link
                to={`/grupos/${encodeURIComponent(group.id)}`}
                className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate font-medium', playable === 0 && 'text-muted-foreground')}>
                    {group.nameEs}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <code className="font-mono">{group.displayCardId}</code>
                    {group.editionCount > 1 ? ` · ${group.editionCount} ediciones` : ''}
                    {hasAdjustment ? ` · stock ${fromStock}` : ''}
                  </span>
                </span>
                {hasAdjustment ? <Badge variant="secondary">ajuste</Badge> : null}
                <span
                  className={cn(
                    'min-w-8 text-right text-xl font-semibold tabular',
                    playable === 0 ? 'text-destructive' : playable === 1 ? 'text-warning' : '',
                  )}
                  title="copias jugables"
                >
                  {playable}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {groups.hasNextPage ? (
        <Button variant="outline" onClick={() => groups.fetchNextPage()} disabled={groups.isFetchingNextPage}>
          {groups.isFetchingNextPage ? <Spinner /> : null}
          Cargar más
        </Button>
      ) : null}
    </div>
  )
}
