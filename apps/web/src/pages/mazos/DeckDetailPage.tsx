import { CopyIcon, CpuIcon, DownloadIcon, EllipsisVerticalIcon, PencilIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage, saveBlob } from '@/api/client'
import {
  EXPORT_EXTENSION,
  fetchDeckExport,
  useDeck,
  useDecks,
  useDeleteDeck,
  useDuplicateDeck,
  useRestoreRevision,
  useUpdateDeck,
} from '@/api/decks'
import { DECK_EXPORT_FORMATS, type DeckCard, type DeckDetail, type DeckExportFormat } from '@/api/schemas'
import { usePageTitle } from '@/app/AppShell'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DeckNumber } from '@/components/DeckNumber'
import { EnergyChips } from '@/components/EnergyChip'
import { IssueList } from '@/components/IssueList'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { CardCode, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BestVersionsSection } from './BestVersions'
import { ClosestDecksSection } from './ClosestDecks'
import { ConsistencySection } from './ConsistencySection'
import { DeckPager } from './DeckPager'
import { DeckPerformance } from './DeckPerformance'
import { DeckBadges } from './DecksPage'
import { BUILT_IN_GAME_LIMIT, groupByType, totalCount } from './deckLogic'
import { TournamentVersionSection } from './TournamentVersion'

const FORMAT_LABEL: Record<DeckExportFormat, { title: string; hint: string }> = {
  spanish: { title: 'Texto en español', hint: 'Con códigos de edición y línea «- Energía:», como mazos_40_listas.md' },
  deckgym: { title: 'deckgym', hint: 'Para el motor: «N Nombre SET NUM» + Energy:' },
  limitless: { title: 'Limitless', hint: 'Portapapeles del builder de Limitless' },
  json: { title: 'JSON', hint: 'Formato propio de la app' },
}

/** Who made a revision or a change: the app, an import, Claude (MCP)… */
const SOURCE_LABEL: Record<string, string> = {
  ui: 'en la app',
  import: 'importado',
  mcp: 'desde Claude',
  duplicate: 'duplicado',
  restore: 'restaurado',
}

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source
}

function DeckCardRow({ entry }: { entry: DeckCard }) {
  return (
    <li className="flex min-h-11 items-center gap-2 px-3 py-1.5">
      <span className="w-6 text-right font-semibold tabular">{entry.count}</span>
      <Link to={`/grupos/${encodeURIComponent(entry.group.id)}`} className="min-w-0 flex-1 truncate hover:underline">
        {entry.card.nameEs}
      </Link>
      <CardCode id={entry.card.id} />
      {entry.card.cardType === 'pokemon' ? (
        <span className="text-xs text-muted-foreground" title="puntos en juego">
          {entry.card.prizePoints}p
        </span>
      ) : null}
      {entry.missing > 0 ? (
        <Badge variant="destructive">{entry.playable === 0 ? 'no la tenés' : `falta ${entry.missing}`}</Badge>
      ) : null}
    </li>
  )
}

function CardGroups({ deck }: { deck: DeckDetail }) {
  const { pokemon, trainers } = groupByType(deck.cards)
  return (
    <div className="flex flex-col gap-3">
      {[
        { title: 'Pokémon', items: pokemon },
        { title: 'Entrenadores', items: trainers },
      ].map((group) => (
        <div key={group.title} className="rounded-lg border">
          <div className="flex items-center justify-between px-3 py-2 text-sm font-medium">
            <span>{group.title}</span>
            <span className="text-muted-foreground tabular">{totalCount(group.items)}</span>
          </div>
          <ul className="divide-y border-t">
            {group.items.map((entry) => (
              <DeckCardRow key={entry.card.id} entry={entry} />
            ))}
            {group.items.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">—</li> : null}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function DeckDetailPage() {
  const { deckId } = useParams()
  return (
    <>
      {deckId ? <DeckPager deckId={deckId} /> : null}
      {/* Keyed so sheets and dialogs of one deck never stay open on the next. */}
      <DeckDetailView key={deckId} deckId={deckId} />
    </>
  )
}

function DeckDetailView({ deckId }: { deckId: string | undefined }) {
  const navigate = useNavigate()
  const deck = useDeck(deckId)
  const activeDecks = useDecks({ archived: false })
  const update = useUpdateDeck()
  const duplicate = useDuplicateDeck()
  const remove = useDeleteDeck()
  const restore = useRestoreRevision()
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState<DeckExportFormat | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [restoring, setRestoring] = useState<number | null>(null)
  usePageTitle(deck.data?.name)

  if (deck.isPending) return <LoadingRows />
  if (deck.isError) return <ErrorState error={deck.error} onRetry={() => deck.refetch()} />
  const data = deck.data
  const builtCount = (activeDecks.data ?? []).filter((d) => d.builtInGame && !d.archivedAt).length

  async function patch(patchBody: Parameters<typeof update.mutateAsync>[0]['patch'], done: string) {
    try {
      await update.mutateAsync({ id: data.id, patch: patchBody })
      toast.success(done)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function duplicateDeck() {
    try {
      const copy = await duplicate.mutateAsync({ id: data.id })
      toast.success(`Duplicado como «${copy.name}»`)
      navigate(`/mazos/${encodeURIComponent(copy.id)}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function deleteDeck() {
    try {
      await remove.mutateAsync(data.id)
      toast.success('Mazo eliminado')
      navigate('/mazos')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setConfirmDelete(false)
    }
  }

  async function exportAs(format: DeckExportFormat) {
    setExporting(format)
    try {
      const text = await fetchDeckExport(data.id, format)
      let copied = false
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch {
        copied = false
      }
      const safeName = data.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')
      saveBlob(
        new Blob([text], { type: format === 'json' ? 'application/json' : 'text/plain' }),
        `${safeName}.${EXPORT_EXTENSION[format]}`,
      )
      toast.success(copied ? 'Copiado al portapapeles y descargado' : 'Descargado (no se pudo copiar al portapapeles)')
      setExportOpen(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setExporting(null)
    }
  }

  async function restoreRevision(number: number) {
    try {
      await restore.mutateAsync({ id: data.id, number })
      toast.success(`Revisión ${number} restaurada`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-baseline gap-2 text-2xl font-semibold">
              <DeckNumber id={data.id} name={data.name} className="text-lg font-normal" />
              <span className="min-w-0">{data.name}</span>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <EnergyChips energies={data.energies} size="md" />
            </div>
          </div>
          <Button asChild>
            <Link to={`/mazos/${encodeURIComponent(data.id)}/editar`}>
              <PencilIcon data-icon="inline-start" />
              Editar
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Más acciones">
                <EllipsisVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={duplicateDeck}>
                <CopyIcon />
                Duplicar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setExportOpen(true)}>
                <DownloadIcon />
                Exportar…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => navigate(`/simulacion/nueva?tipo=compare&a=${encodeURIComponent(`d:${data.id}`)}`)}
              >
                <CpuIcon />
                Simular contra…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => navigate(`/simulacion/nueva?tipo=optimize&a=${encodeURIComponent(`d:${data.id}`)}`)}
              >
                <SlidersHorizontalIcon />
                Optimizar con simulación…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  patch(
                    { builtInGame: !data.builtInGame },
                    data.builtInGame ? 'Ya no cuenta como armado en el juego' : 'Marcado como armado en el juego',
                  )
                }
              >
                {data.builtInGame
                  ? 'Desmarcar «armado en el juego»'
                  : `Marcar armado en el juego (${builtCount}/${BUILT_IN_GAME_LIMIT})`}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  patch({ archived: !data.archivedAt }, data.archivedAt ? 'Mazo desarchivado' : 'Mazo archivado')
                }
              >
                {data.archivedAt ? 'Desarchivar' : 'Archivar'}
              </DropdownMenuItem>
              {data.archivedAt ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  Eliminar
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <DeckBadges deck={data} />
        {data.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1 text-sm text-muted-foreground">
            {data.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        ) : null}
        {data.variantOfId ? (
          <div className="text-sm">
            Variante de{' '}
            <Link to={`/mazos/${encodeURIComponent(data.variantOfId)}`} className="underline">
              otro mazo
            </Link>
          </div>
        ) : null}
        {data.notes ? <p className="text-sm whitespace-pre-wrap text-muted-foreground">{data.notes}</p> : null}
      </div>

      <DeckPerformance
        deckId={data.id}
        archived={Boolean(data.archivedAt)}
        tournamentArchetypeId={data.tournamentArchetypeId ?? null}
      />

      <Section title={`Cartas (${totalCount(data.cards)})`}>
        <CardGroups deck={data} />
      </Section>

      <TournamentVersionSection deckId={data.id} />

      <ConsistencySection deck={data} />

      <BestVersionsSection deck={data} />

      <ClosestDecksSection deckId={data.id} />

      <Section title="Validación">
        {data.validation.ok ? (
          <p className="text-sm text-success">El mazo cumple las reglas del juego.</p>
        ) : (
          <IssueList issues={data.validation.errors} level="error" />
        )}
        <IssueList issues={data.validation.warnings} level="warning" />
        <IssueList issues={data.validation.infos} level="info" />
      </Section>

      <Section title="Completitud">
        {data.completeness.complete ? (
          <p className="text-sm text-success">
            Tenés todas las cartas (contra la colección entera; las copias no se reparten).
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.completeness.missing.map((item) => (
              <li key={item.groupId} className="flex min-h-11 items-center gap-2 px-3 py-1.5 text-sm">
                <Link
                  to={`/grupos/${encodeURIComponent(item.groupId)}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {item.nameEs}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">{item.cardIds.join(', ')}</span>
                <span className="tabular">
                  {item.have}/{item.need}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Revisiones (${data.revisions.length})`}>
        <ul className="divide-y rounded-lg border">
          {data.revisions.map((revision) => {
            const current = revision.number === data.revisionNumber
            return (
              <li
                key={revision.number}
                className={cn('flex min-h-12 items-center gap-2 px-3 py-1.5 text-sm', current && 'bg-muted/50')}
              >
                <span className="w-8 font-mono">#{revision.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {formatDateTime(revision.createdAt)} · {sourceLabel(revision.source)}
                    {current ? ' · actual' : ''}
                  </span>
                  {revision.note ? <span className="block text-xs text-muted-foreground">{revision.note}</span> : null}
                </span>
                <span className="text-muted-foreground tabular">{revision.cardCount} cartas</span>
                {!current ? (
                  <Button size="sm" variant="outline" onClick={() => setRestoring(revision.number)}>
                    Restaurar
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title={`Cambios (${data.changes.length})`}>
        {data.changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cambios registrados.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {data.changes.map((change) => (
              <li key={`${change.at}:${change.field}:${stringify(change.new)}`} className="px-3 py-1.5">
                <span className="font-medium">{change.field}</span>:{' '}
                <span className="text-muted-foreground">{stringify(change.old)}</span> → {stringify(change.new)}
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(change.at)}
                  {change.source ? ` · ${sourceLabel(change.source)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Sheet open={exportOpen} onOpenChange={setExportOpen}>
        <SheetContent side="bottom" className="pb-safe">
          <SheetHeader>
            <SheetTitle>Exportar «{data.name}»</SheetTitle>
            <SheetDescription>Se copia al portapapeles y se descarga como archivo.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4 pb-4">
            {DECK_EXPORT_FORMATS.map((format) => (
              <Button
                key={format}
                variant="outline"
                size="lg"
                className="h-auto justify-start py-2"
                disabled={exporting !== null}
                onClick={() => exportAs(format)}
              >
                {exporting === format ? <Spinner /> : <DownloadIcon data-icon="inline-start" />}
                <span className="flex flex-col items-start text-left">
                  <span>{FORMAT_LABEL[format].title}</span>
                  <span className="text-xs font-normal text-muted-foreground">{FORMAT_LABEL[format].hint}</span>
                </span>
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Eliminar este mazo?"
        description="Se borra con sus revisiones. Solo se pueden eliminar mazos archivados y sin partidas registradas."
        confirmLabel="Eliminar"
        destructive
        pending={remove.isPending}
        onConfirm={deleteDeck}
      />

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => {
          if (!open) setRestoring(null)
        }}
        title={`¿Restaurar la revisión ${restoring ?? ''}?`}
        description="Se crea una revisión nueva con esas cartas y energías; nada se pierde."
        confirmLabel="Restaurar"
        pending={restore.isPending}
        onConfirm={() => restoring !== null && restoreRevision(restoring)}
      />
    </div>
  )
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(stringify).join(', ')
  return JSON.stringify(value)
}
