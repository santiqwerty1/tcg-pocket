/**
 * Torneos (BRIEF M5, Fase 5): Limitless results of one era and format. Archetypes and exact lists with their n and
 * interval, what I can build today and which single card unlocks the most lists. Tournament data only: own matches
 * and simulations live in their own screens and never mix with these numbers.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { ListAgainstCollection, ListRow, TournamentScope } from '@/api/schemas'
import {
  type TournamentScopeParams,
  useArchetypes,
  useBuildable,
  useStartSync,
  useTournamentLists,
  useTournamentStatus,
  useUnlock,
} from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RateRows } from '@/components/RateSummary'
import { SearchBox } from '@/components/SearchBox'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatRateValue, formatRecord } from '@/lib/matches'
import { formatCount, formatShare, scopeFromSearch, scopeSearch } from '@/lib/tournaments'
import { ScopePicker, ScopeSummary, SyncLine } from './ScopeHeader'

const VIEWS = ['arquetipos', 'listas', 'armar', 'destraban'] as const
/** Four tabs fit a 375 px phone. */
const TAB = 'px-1.5 text-[13px]'
type View = (typeof VIEWS)[number]

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

function EmptyEra({ scope }: { scope: TournamentScope }) {
  return (
    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      Sin listas de torneo para {scope.era.code} en este formato todavía. La primera sincronización baja 60 días de
      torneos respetando el límite de Limitless (40 llamadas cada 5 minutos): tarda alrededor de una hora y media y
      sigue sola si se corta.
    </p>
  )
}

function ArchetypesTab({ scope }: { scope: TournamentScopeParams }) {
  const archetypes = useArchetypes(scope)
  const [filter, setFilter] = useState('')
  const search = scopeSearch(scope)
  const rows = useMemo(() => {
    const folded = fold(filter.trim())
    return (archetypes.data?.rows ?? []).filter((row) => folded === '' || fold(row.archetype.name).includes(folded))
  }, [archetypes.data, filter])
  if (archetypes.isPending) return <LoadingRows />
  if (archetypes.isError) return <ErrorState error={archetypes.error} onRetry={() => archetypes.refetch()} />
  if (archetypes.data.scope.lists === 0) return <EmptyEra scope={archetypes.data.scope} />
  return (
    <div className="flex flex-col gap-2">
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link to={`/torneos/matchups${search}`}>Matchups entre arquetipos</Link>
      </Button>
      <SearchBox value={filter} onChange={setFilter} placeholder="Buscar arquetipo" />
      <RateRows
        empty="Ningún arquetipo coincide."
        rows={rows.map((row) => ({
          id: row.archetype.id ?? '__none__',
          label: row.archetype.name,
          hint: `${formatCount(row.lists)} listas · ${formatShare(row.share)}`,
          to: `/torneos/arquetipos/${encodeURIComponent(row.archetype.id ?? 'none')}${search}`,
          record: row.record,
          rate: row.rate,
        }))}
      />
    </div>
  )
}

/** A list in one line: its archetype and the cards that tell it apart are in the detail. */
function listLabel(row: ListRow): string {
  const pokemon = row.cards
    .filter((card) => card.cardType === 'pokemon')
    .map((card) => card.nameEs)
    .filter((name, at, all) => all.indexOf(name) === at)
  return `${row.archetype.name} · ${pokemon.slice(0, 4).join(', ')}${pokemon.length > 4 ? '…' : ''}`
}

function ListsTab({ scope }: { scope: TournamentScopeParams }) {
  const [kind, setKind] = useState<'group' | 'name'>('group')
  const [minLists, setMinLists] = useState(2)
  const lists = useTournamentLists(scope, kind)
  const search = scopeSearch(scope)
  if (lists.isPending) return <LoadingRows />
  if (lists.isError) return <ErrorState error={lists.error} onRetry={() => lists.refetch()} />
  if (lists.data.scope.lists === 0) return <EmptyEra scope={lists.data.scope} />
  const rows = lists.data.rows.filter((row) => row.lists >= minLists)
  const kindParam = kind === 'name' ? `${search ? '&' : '?'}clave=nombre` : ''
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={kind === 'group' ? 'default' : 'outline'} onClick={() => setKind('group')}>
          Por carta funcional
        </Button>
        <Button size="sm" variant={kind === 'name' ? 'default' : 'outline'} onClick={() => setKind('name')}>
          Por nombre
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMinLists(minLists === 1 ? 2 : minLists === 2 ? 5 : 1)}>
          {minLists === 1 ? 'Todas' : `${minLists} listas o más`}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Lista exacta = las mismas 20 cartas sin mirar la edición.{' '}
        {kind === 'group'
          ? 'Por carta funcional distingue cartas con el mismo nombre y otro texto (Riolu A2-91 y B3-79).'
          : 'Por nombre, como pide el brief: junta cartas homónimas aunque tengan otro texto.'}{' '}
        {formatCount(lists.data.total)} listas distintas en la era.
      </p>
      <RateRows
        empty="Ninguna lista con ese mínimo."
        rows={rows.slice(0, 100).map((row) => ({
          id: row.key,
          label: listLabel(row),
          hint: `${formatCount(row.lists)} ${row.lists === 1 ? 'lista' : 'listas'}`,
          to: `/torneos/listas/${row.key}${search}${kindParam}`,
          record: row.record,
          rate: row.rate,
        }))}
      />
    </div>
  )
}

function AgainstRows({ rows, scope }: { rows: ListAgainstCollection[]; scope: TournamentScopeParams }) {
  const search = scopeSearch(scope)
  return (
    <RateRows
      empty="Ninguna."
      rows={rows.map((row) => ({
        id: row.key,
        label: listLabel(row),
        hint:
          row.missing.length === 0
            ? `${formatCount(row.lists)} ${row.lists === 1 ? 'lista' : 'listas'}`
            : `falta ${row.missing.map((item) => `${item.need - item.have} ${item.nameEs}`).join(', ')}`,
        to: `/torneos/listas/${row.key}${search}`,
        record: row.record,
        rate: row.rate,
      }))}
    />
  )
}

function BuildableTab({ scope }: { scope: TournamentScopeParams }) {
  const buildable = useBuildable(scope)
  if (buildable.isPending) return <LoadingRows />
  if (buildable.isError) return <ErrorState error={buildable.error} onRetry={() => buildable.refetch()} />
  if (buildable.data.scope.lists === 0) return <EmptyEra scope={buildable.data.scope} />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium">Las podés armar hoy ({buildable.data.buildable.length})</h3>
        <p className="text-xs text-muted-foreground">
          Cada lista contra la colección entera, por carta funcional: las copias no se reparten entre listas.
        </p>
        <AgainstRows rows={buildable.data.buildable} scope={scope} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium">A una o dos copias ({buildable.data.near.length})</h3>
        <AgainstRows rows={buildable.data.near} scope={scope} />
      </div>
    </div>
  )
}

function UnlockTab({ scope }: { scope: TournamentScopeParams }) {
  const unlock = useUnlock(scope)
  const search = scopeSearch(scope)
  if (unlock.isPending) return <LoadingRows />
  if (unlock.isError) return <ErrorState error={unlock.error} onRetry={() => unlock.refetch()} />
  if (unlock.data.scope.lists === 0) return <EmptyEra scope={unlock.data.scope} />
  if (unlock.data.cards.length === 0) {
    return <p className="text-sm text-muted-foreground">Ninguna lista queda a una sola carta de poder armarse.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Listas a las que les falta solo esa carta. El récord es el de esas listas juntas.
      </p>
      <ul className="divide-y rounded-lg border">
        {unlock.data.cards.map((card) => (
          <li key={card.groupId} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
            <div className="flex items-baseline gap-2">
              <Link
                to={`/grupos/${encodeURIComponent(card.groupId)}`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {card.nameEs}
              </Link>
              <Badge variant="secondary">
                {card.lists} {card.lists === 1 ? 'lista' : 'listas'}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Tenés {card.have}: {card.copies === 1 ? 'falta 1 copia' : `faltan hasta ${card.copies} copias`}
              {card.listsWithOneCopy > 0 && card.listsWithOneCopy < card.lists
                ? ` (${card.listsWithOneCopy} ${card.listsWithOneCopy === 1 ? 'lista' : 'listas'} con una sola)`
                : ''}
            </div>
            {card.rate ? (
              <div className="text-xs text-muted-foreground tabular">
                {formatRateValue(card.rate.value)} · {formatRecord(card.record)} en {formatCount(card.entries)} listas
                {card.rate.orientative ? ' · orientativo' : ''}
              </div>
            ) : null}
            <div className="text-xs">
              {card.unlocked
                .filter((row, at, all) => all.findIndex((other) => other.archetype.name === row.archetype.name) === at)
                .slice(0, 3)
                .map((row, at) => (
                  <span key={row.key}>
                    {at > 0 ? ' · ' : ''}
                    <Link to={`/torneos/listas/${row.key}${search}`} className="text-primary hover:underline">
                      {row.archetype.name}
                    </Link>
                  </span>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TorneosPage() {
  const [search, setSearch] = useSearchParams()
  const scope = scopeFromSearch(search)
  const view: View = (VIEWS as readonly string[]).includes(search.get('vista') ?? '')
    ? (search.get('vista') as View)
    : 'arquetipos'
  const status = useTournamentStatus()
  const archetypes = useArchetypes(scope)
  const startSync = useStartSync()

  function update(next: { scope?: TournamentScopeParams; view?: View }) {
    const params = new URLSearchParams()
    const nextScope = next.scope ?? scope
    if (nextScope.era) params.set('era', nextScope.era)
    if (nextScope.format === 'NOEX') params.set('formato', 'NOEX')
    const nextView = next.view ?? view
    if (nextView !== 'arquetipos') params.set('vista', nextView)
    setSearch(params, { replace: true })
  }

  async function sync() {
    try {
      const result = (await startSync.mutateAsync(undefined)) as { started?: boolean } | undefined
      toast.success(result?.started === false ? 'Ya hay una sincronización en curso.' : 'Sincronización iniciada.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (status.isPending) return <LoadingRows />
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />

  return (
    <div className="flex flex-col gap-4">
      <Section title="Torneos">
        <ScopePicker status={status.data} scope={scope} onChange={(next) => update({ scope: next })} />
        {archetypes.data ? <ScopeSummary scope={archetypes.data.scope} /> : null}
        <SyncLine status={status.data} onSync={sync} syncing={startSync.isPending} />
      </Section>
      <Tabs value={view} onValueChange={(next) => update({ view: next as View })}>
        <TabsList className="w-full">
          <TabsTrigger value="arquetipos" className={TAB}>
            Arquetipos
          </TabsTrigger>
          <TabsTrigger value="listas" className={TAB}>
            Listas
          </TabsTrigger>
          <TabsTrigger value="armar" className={TAB}>
            Armables
          </TabsTrigger>
          <TabsTrigger value="destraban" className={TAB}>
            Destraban
          </TabsTrigger>
        </TabsList>
        <TabsContent value="arquetipos">
          <ArchetypesTab scope={scope} />
        </TabsContent>
        <TabsContent value="listas">
          <ListsTab scope={scope} />
        </TabsContent>
        <TabsContent value="armar">
          <BuildableTab scope={scope} />
        </TabsContent>
        <TabsContent value="destraban">
          <UnlockTab scope={scope} />
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        Datos de torneo: Limitless (
        <a href="https://play.limitlesstcg.com" className="underline" target="_blank" rel="noreferrer">
          play.limitlesstcg.com
        </a>
        ). Wilson al 95 % sobre partidas; con menos de 30 listas el dato orienta, no prueba. Las partidas de un mismo
        jugador no son independientes, así que el intervalo es optimista.
      </p>
    </div>
  )
}
