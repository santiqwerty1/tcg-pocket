/**
 * «Versión de torneo» of a deck (pedido del 8/10/2026): the exact list of its archetype worth aiming at in the era
 * (played 5 times or more, best lower bound of its interval), the cards that change from the saved list and what the
 * collection lacks for it. The saved lists are built with what the owner has, so «completo» does not mean «óptimo».
 */
import { Link } from 'react-router'
import type { DeckVersion, ListRow } from '@/api/schemas'
import { useDeckVersion } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { OrientativeBadge, RateDetails } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { plural } from '@/lib/format'
import { formatRateValue } from '@/lib/matches'

function changeText(changes: { nameEs: string; count: number }[]): string {
  return changes.map((change) => `${change.count} ${change.nameEs}`).join(' · ')
}

function ListLine({ list, label }: { list: ListRow; label?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <Link
          to={`/torneos/listas/${list.key}`}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
        >
          {label ?? list.archetype.name} · {plural(list.lists, 'lista', 'listas')}
        </Link>
        <span className="shrink-0 font-semibold tabular">
          {list.rate ? formatRateValue(list.rate.value) : 'sin datos'}
        </span>
      </div>
      {list.rate ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
          <RateDetails record={list.record} rate={list.rate} />
          {list.rate.orientative ? <OrientativeBadge /> : null}
        </div>
      ) : null}
    </div>
  )
}

function Body({ data }: { data: DeckVersion & { scope: { attribution: string; era: { code: string } } } }) {
  if (!data.archetype) {
    return (
      <p className="text-sm text-muted-foreground">
        Ninguna lista de torneo de la era {data.scope.era.code} se parece a este mazo (más de 6 cambios): elegí su
        arquetipo en «Torneo, en detalle» para ver su versión de torneo.
      </p>
    )
  }
  const source = data.archetype.source === 'owner' ? 'elegido en el mazo' : 'sugerido por las listas más parecidas'
  if (!data.version) {
    return (
      <p className="text-sm text-muted-foreground">
        Arquetipo {data.archetype.name} ({source}): sin listas en la era {data.scope.era.code}.
      </p>
    )
  }
  const { version } = data
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Arquetipo {data.archetype.name} ({source}). La lista de torneo a la que conviene apuntar: jugada 5 veces o más
        en la era, la de mejor piso del intervalo.
      </p>
      <div className="rounded-lg border p-3">
        <ListLine list={version.list} />
      </div>
      {version.swaps === 0 ? (
        <p className="text-sm text-success">Tu lista ya es la versión de torneo.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Sacar</dt>
          <dd>{changeText(version.remove)}</dd>
          <dt className="text-muted-foreground">Poner</dt>
          <dd>{changeText(version.add)}</dd>
        </dl>
      )}
      {version.missingCopies === 0 ? (
        version.swaps > 0 ? (
          <p className="text-sm text-success">La podés armar con tu colección: abrí la lista e importala como mazo.</p>
        ) : null
      ) : (
        <p className="text-sm text-warning">
          Te falta:{' '}
          {version.missing.map((item) => `${item.need - item.have} ${item.nameEs} (tenés ${item.have})`).join(', ')}. En
          Sobres, marcá este mazo y activá «Apuntar a la versión de torneo».
        </p>
      )}
      {version.alternatives.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground select-none">Otras listas del arquetipo</summary>
          <ul className="mt-1 flex flex-col gap-2">
            {version.alternatives.map((list) => (
              <li key={list.key}>
                <ListLine list={list} label={`Lista ${list.key.slice(0, 6)}`} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{data.scope.attribution}</p>
    </div>
  )
}

export function TournamentVersionSection({ deckId }: { deckId: string }) {
  const query = useDeckVersion(deckId)
  return (
    <Section title="Versión de torneo">
      {query.isPending ? (
        <LoadingRows rows={2} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Body data={query.data} />
      )}
    </Section>
  )
}
