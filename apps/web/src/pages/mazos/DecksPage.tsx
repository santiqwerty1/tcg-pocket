import { ClipboardPasteIcon, DicesIcon, PlusIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDecks, useUpdateDeck } from '@/api/decks'
import type { DeckSummary } from '@/api/schemas'
import { DeckNumber } from '@/components/DeckNumber'
import { EnergyChips } from '@/components/EnergyChip'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { type DeckListFilters, deckListSearch, deckPath, filterDecks, readDeckListFilters } from './deckList'
import { BUILT_IN_GAME_LIMIT, DECK_SIZE } from './deckLogic'
import { RandomDeckSheet } from './RandomDeckSheet'

const ALL_TAGS = '__all__'

/** `showBuilt` is off in the list, where the «armado» checkbox already says it. */
export function DeckBadges({ deck, showBuilt = true }: { deck: DeckSummary; showBuilt?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {deck.valid ? (
        <Badge variant="outline" className="text-success">
          válido
        </Badge>
      ) : (
        <Badge variant="destructive">{deck.errorCount === 1 ? '1 error' : `${deck.errorCount} errores`}</Badge>
      )}
      {deck.complete ? (
        <Badge variant="outline" className="text-success">
          completo
        </Badge>
      ) : (
        <Badge variant="outline" className="text-warning">
          {deck.missingCount === 1 ? 'falta 1' : `faltan ${deck.missingCount}`}
        </Badge>
      )}
      {deck.cardCount !== DECK_SIZE ? <Badge variant="outline">{deck.cardCount} cartas</Badge> : null}
      {showBuilt && deck.builtInGame ? <Badge variant="secondary">en el juego</Badge> : null}
      {deck.archivedAt ? <Badge variant="outline">archivado</Badge> : null}
    </span>
  )
}

/**
 * Marks a deck as built in the game right from the list (pedido del 8/10/2026). Shows the new state while it saves;
 * if the API refuses it (I8: at most 25 built decks) it goes back and says why.
 */
function BuiltCheckbox({ deck }: { deck: DeckSummary }) {
  const update = useUpdateDeck()
  const checked = update.isPending ? update.variables.patch.builtInGame === true : deck.builtInGame
  return (
    <Label className="flex w-18 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 border-l text-xs font-normal text-muted-foreground hover:bg-muted">
      <Checkbox
        checked={checked}
        disabled={update.isPending}
        aria-label={`Armado en el juego: ${deck.name}`}
        onCheckedChange={(value) =>
          update.mutate(
            { id: deck.id, patch: { builtInGame: value === true } },
            { onError: (error) => toast.error(errorMessage(error)) },
          )
        }
      />
      armado
    </Label>
  )
}

export function DecksPage() {
  const [params, setParams] = useSearchParams()
  const filters = readDeckListFilters(params)
  const search = deckListSearch(filters)
  const [randomOpen, setRandomOpen] = useState(false)
  const decks = useDecks({ archived: filters.archived })
  const active = useDecks({ archived: false })

  // In the URL, so they survive opening a deck and coming back, and the deck page steps through the same list.
  function setFilters(patch: Partial<DeckListFilters>) {
    setParams(new URLSearchParams(deckListSearch({ ...filters, ...patch })), { replace: true })
  }

  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const deck of decks.data ?? []) for (const t of deck.tags) set.add(t)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))
  }, [decks.data])

  const builtCount = (active.data ?? []).filter((deck) => deck.builtInGame && !deck.archivedAt).length
  const items = filterDecks(decks.data ?? [], filters)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/mazos/nuevo">
            <PlusIcon data-icon="inline-start" />
            Nuevo mazo
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/mazos/importar">
            <ClipboardPasteIcon data-icon="inline-start" />
            Importar
          </Link>
        </Button>
        <Button variant="outline" onClick={() => setRandomOpen(true)}>
          <DicesIcon data-icon="inline-start" />
          Al azar
        </Button>
        <span className="ml-auto self-center text-sm text-muted-foreground tabular">
          {builtCount}/{BUILT_IN_GAME_LIMIT} en el juego
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.tag ?? ALL_TAGS}
          onValueChange={(value) => setFilters({ tag: value === ALL_TAGS ? null : value })}
        >
          <SelectTrigger className="min-w-40" aria-label="Etiqueta">
            <SelectValue placeholder="Etiqueta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TAGS}>Todas las etiquetas</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={filters.onlyBuilt} onCheckedChange={(onlyBuilt) => setFilters({ onlyBuilt })} />
          Solo en el juego
        </Label>
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={filters.archived} onCheckedChange={(archived) => setFilters({ archived })} />
          Archivados
        </Label>
      </div>

      {decks.isPending ? <LoadingRows /> : null}
      {decks.isError ? <ErrorState error={decks.error} onRetry={() => decks.refetch()} /> : null}
      {decks.data && items.length === 0 ? (
        <EmptyState
          title={filters.archived ? 'No hay mazos archivados' : 'Todavía no hay mazos'}
          description="Creá uno nuevo o pegá tus listas en «Importar»."
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {items.map((deck) => (
            <li key={deck.id} className="flex">
              <Link
                to={deckPath(deck.id, search)}
                className={cn(
                  'flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2 hover:bg-muted',
                  deck.archivedAt && 'opacity-70',
                )}
              >
                <span className="flex items-center gap-2">
                  <DeckNumber id={deck.id} name={deck.name} className="text-sm" />
                  <span className="min-w-0 flex-1 truncate font-medium">{deck.name}</span>
                  <EnergyChips energies={deck.energies} />
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <DeckBadges deck={deck} showBuilt={false} />
                  {deck.tags.map((t) => (
                    <span key={t} className="text-xs text-muted-foreground">
                      #{t}
                    </span>
                  ))}
                </span>
              </Link>
              <BuiltCheckbox deck={deck} />
            </li>
          ))}
        </ul>
      ) : null}
      {randomOpen ? (
        <RandomDeckSheet open onOpenChange={setRandomOpen} onlyBuilt={filters.onlyBuilt} tag={filters.tag} />
      ) : null}
    </div>
  )
}
