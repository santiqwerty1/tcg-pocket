/**
 * «Contra cada rival» (Fase 9): for the most played archetypes of the era and every opponent the deck met, own
 * matches next to how the deck's archetype does against that rival in tournaments. Two separate numbers, never one.
 */
import { Link } from 'react-router'
import { useDeckMatchups } from '@/api/matches'
import type { WinRate } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { formatRateValue, formatRecord } from '@/lib/matches'
import { matchupTone, TONE_CLASS } from '@/lib/matchups'
import { formatShare } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

function Rate({ rate, prefix }: { rate: WinRate | null; prefix: string }) {
  if (!rate) return <span className="text-muted-foreground">{prefix}: —</span>
  return (
    <span className="whitespace-nowrap">
      {prefix}:{' '}
      <span className={cn('font-medium tabular', TONE_CLASS[matchupTone(rate)])}>{formatRateValue(rate.value)}</span>
      <span className="text-muted-foreground"> (n = {rate.games})</span>
    </span>
  )
}

export function DeckMatchupsSection({ deckId }: { deckId: string }) {
  const matchups = useDeckMatchups(deckId)
  if (matchups.isPending) return <LoadingRows rows={3} />
  if (matchups.isError) return <ErrorState error={matchups.error} onRetry={() => matchups.refetch()} />
  if (!matchups.data) return null
  const data = matchups.data
  if (data.rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay rivales: ni partidas tuyas con este mazo ni rondas de torneo de su arquetipo.
      </p>
    )
  }
  return (
    <Section title="Contra cada rival">
      <p className="text-xs text-muted-foreground">
        {data.archetype ? (
          <>
            Torneo: {/* Fase 41: from the deck to its archetype in one tap. */}
            <Link
              to={`/torneos/arquetipos/${encodeURIComponent(data.archetype.id)}`}
              className="font-medium text-foreground underline"
            >
              {data.archetype.name}
            </Link>{' '}
            ({data.archetype.source === 'owner' ? 'elegido en el mazo' : 'el arquetipo de las listas más parecidas'})
            contra cada rival en {data.era}
          </>
        ) : (
          'El mazo no tiene arquetipo de torneo: solo tus partidas'
        )}
        {data.archetype && data.tournamentsWithPairings === 0
          ? ' (las rondas llegan con la próxima sincronización)'
          : ''}
        {data.expected ? `; contra el meta debería sacar ${formatRateValue(data.expected.value)}` : ''}. Vos: tus
        partidas con este mazo.
      </p>
      <ul className="divide-y rounded-lg border">
        {data.rows.map((row) => (
          <li key={row.rival.id ?? `text-${row.rival.name}`} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
            <div className="flex items-baseline gap-2">
              {row.rival.id ? (
                <Link
                  to={`/torneos/arquetipos/${encodeURIComponent(row.rival.id)}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {row.rival.name}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate font-medium">{row.rival.name}</span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                {row.share === null ? 'anotado a mano' : `${formatShare(row.share)} del meta`}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              <span>
                {row.mine ? (
                  <>
                    <Rate rate={row.mine.rate} prefix="Vos" /> · {formatRecord(row.mine.record)}
                    {row.luck === 'unlucky' ? <span className="text-warning"> · racha rara</span> : null}
                    {row.luck === 'lucky' ? <span className="text-success"> · mejor de lo esperable</span> : null}
                    {row.turn ? (
                      <span className="block text-muted-foreground">
                        empezando {formatRecord(row.turn.first)} · segundo {formatRecord(row.turn.second)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">Vos: sin partidas</span>
                )}
              </span>
              {row.share !== null ? <Rate rate={row.tournament?.rate ?? null} prefix="Torneo" /> : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{data.attribution}.</p>
    </Section>
  )
}
