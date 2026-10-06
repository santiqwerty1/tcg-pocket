import { ClipboardPasteIcon, PlusIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useDecks } from '@/api/decks'
import type { DeckSummary } from '@/api/schemas'
import { EnergyChips } from '@/components/EnergyChip'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { BUILT_IN_GAME_LIMIT, DECK_SIZE } from './deckLogic'

const ALL_TAGS = '__all__'

export function DeckBadges({ deck }: { deck: DeckSummary }) {
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
      {deck.builtInGame ? <Badge variant="secondary">en el juego</Badge> : null}
      {deck.archivedAt ? <Badge variant="outline">archivado</Badge> : null}
    </span>
  )
}

export function DecksPage() {
  const [showArchived, setShowArchived] = useState(false)
  const [onlyBuilt, setOnlyBuilt] = useState(false)
  const [tag, setTag] = useState<string>(ALL_TAGS)
  const decks = useDecks({ archived: showArchived })
  const active = useDecks({ archived: false })

  const tags = useMemo(() => {
    const set = new Set<string>()
    for (const deck of decks.data ?? []) for (const t of deck.tags) set.add(t)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))
  }, [decks.data])

  const builtCount = (active.data ?? []).filter((deck) => deck.builtInGame && !deck.archivedAt).length
  const items = (decks.data ?? []).filter(
    (deck) => (!onlyBuilt || deck.builtInGame) && (tag === ALL_TAGS || deck.tags.includes(tag)),
  )

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
        <span className="ml-auto self-center text-sm text-muted-foreground tabular">
          {builtCount}/{BUILT_IN_GAME_LIMIT} en el juego
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={tag} onValueChange={setTag}>
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
          <Switch checked={onlyBuilt} onCheckedChange={setOnlyBuilt} />
          Solo en el juego
        </Label>
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Archivados
        </Label>
      </div>

      {decks.isPending ? <LoadingRows /> : null}
      {decks.isError ? <ErrorState error={decks.error} onRetry={() => decks.refetch()} /> : null}
      {decks.data && items.length === 0 ? (
        <EmptyState
          title={showArchived ? 'No hay mazos archivados' : 'Todavía no hay mazos'}
          description="Creá uno nuevo o pegá tus listas en «Importar»."
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {items.map((deck) => (
            <li key={deck.id}>
              <Link
                to={`/mazos/${encodeURIComponent(deck.id)}`}
                className={cn(
                  'flex min-h-16 flex-col justify-center gap-1 px-3 py-2 hover:bg-muted',
                  deck.archivedAt && 'opacity-70',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{deck.name}</span>
                  <EnergyChips energies={deck.energies} />
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  <DeckBadges deck={deck} />
                  {deck.tags.map((t) => (
                    <span key={t} className="text-xs text-muted-foreground">
                      #{t}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
