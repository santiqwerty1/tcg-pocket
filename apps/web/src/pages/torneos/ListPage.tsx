/**
 * One exact tournament list: its record, the 20 cards (Spanish names, edition codes), what the collection lacks for
 * it, and where it was played. «Importar como mazo» opens the deck importer with the Limitless text.
 */
import { CopyIcon, DownloadIcon } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import type { CardLine } from '@/api/schemas'
import { useTournamentList } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RateHeadline } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatRateValue, formatRecord } from '@/lib/matches'
import { formatCount, formatDayEs, scopeFromSearch, scopeSearch } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

function CardRows({ cards, missing }: { cards: CardLine[]; missing: Map<string, { need: number; have: number }> }) {
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {cards.map((card) => {
        const lack = card.groupId ? missing.get(card.groupId) : undefined
        return (
          <li key={`${card.set}-${card.number}`} className="flex items-baseline gap-2 px-3 py-1.5">
            <span className="w-5 shrink-0 text-right tabular">{card.count}</span>
            {card.groupId ? (
              <Link
                to={`/grupos/${encodeURIComponent(card.groupId)}`}
                className={cn('min-w-0 flex-1 truncate hover:underline', lack && 'text-warning')}
              >
                {card.nameEs}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate text-warning">{card.nameEn} (no está en el catálogo)</span>
            )}
            <code className="shrink-0 font-mono text-xs text-muted-foreground">
              {card.set}-{card.number}
            </code>
            {lack ? <span className="shrink-0 text-xs text-warning">tenés {lack.have}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

export function ListPage() {
  const { key = '' } = useParams()
  const [search] = useSearchParams()
  const scope = scopeFromSearch(search)
  const kind = search.get('clave') === 'nombre' ? 'name' : 'group'
  const detail = useTournamentList(key, scope, kind)
  const navigate = useNavigate()
  const query = scopeSearch(scope)

  if (detail.isPending) return <LoadingRows />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
  const { list, scope: info } = detail.data
  const missing = new Map(list.missing.map((item) => [item.groupId, item]))

  async function copy() {
    try {
      await navigator.clipboard.writeText(detail.data?.text ?? '')
      toast.success('Lista copiada (formato Limitless y deckgym).')
    } catch {
      toast.error('No se pudo copiar.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Section title={list.archetype.name}>
        <RateHeadline
          label={kind === 'group' ? 'Lista exacta' : 'Lista exacta por nombre'}
          record={list.record}
          rate={list.rate}
          hint={`${formatCount(list.lists)} ${list.lists === 1 ? 'jugador la usó' : 'jugadores la usaron'} en la era ${info.era.code} · media de la era ${info.mean.rate ? formatRateValue(info.mean.rate.value) : 'sin datos'}`}
        />
        {list.missing.length === 0 ? (
          <p className="text-sm text-success">La podés armar con tu colección.</p>
        ) : (
          <p className="text-sm text-warning">
            Te falta: {list.missing.map((item) => `${item.need - item.have} ${item.nameEs}`).join(', ')}.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            <CopyIcon data-icon="inline-start" />
            Copiar lista
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate('/mazos/importar', { state: { text: detail.data?.text ?? '' } })}
          >
            <DownloadIcon data-icon="inline-start" />
            Importar como mazo
          </Button>
          {list.archetype.id ? (
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/torneos/arquetipos/${encodeURIComponent(list.archetype.id)}${query}`}>Ver arquetipo</Link>
            </Button>
          ) : null}
        </div>
      </Section>

      <Section title="Pokémon">
        <CardRows cards={list.cards.filter((card) => card.cardType === 'pokemon')} missing={missing} />
      </Section>
      <Section title="Entrenadores">
        <CardRows cards={list.cards.filter((card) => card.cardType !== 'pokemon')} missing={missing} />
      </Section>
      <p className="text-sm text-muted-foreground">
        Energía: {detail.data.energies.length > 0 ? detail.data.energies.join(', ') : 'no declarada (torneo NOEX)'}
      </p>

      <Section title={`Dónde se jugó (${detail.data.entries.length})`}>
        <ul className="divide-y rounded-lg border text-sm">
          {detail.data.entries.slice(0, 100).map((entry) => (
            <li key={`${entry.tournamentId}:${entry.playerName}`} className="flex flex-col gap-0.5 px-3 py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{entry.tournamentName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDayEs(entry.date)}</span>
              </div>
              <div className="text-xs text-muted-foreground tabular">
                {entry.playerName}
                {entry.placing ? ` · puesto ${entry.placing}` : ''} · {formatRecord(entry.record)}
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
