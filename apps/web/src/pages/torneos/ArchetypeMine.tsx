/**
 * «Vos y este arquetipo» (Fase 41): own matches against the archetype (linked to the history behind them) and the
 * decks marked as this archetype. Own matches only: tournament numbers stay in their own sections (BRIEF §2).
 */
import { Link } from 'react-router'
import { useDecks } from '@/api/decks'
import { useMatchStats } from '@/api/matches'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RateRows } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { opponentKeyOf } from '@/lib/matches'

export function ArchetypeMine({
  archetypeId,
  merged,
  name,
}: {
  archetypeId: string
  /** Archetypes folded into this one: a deck marked with one of them belongs here too. */
  merged: readonly string[]
  name: string
}) {
  const stats = useMatchStats({})
  const decks = useDecks({ archived: false })
  const key = opponentKeyOf(name)
  const row = stats.data?.byOpponent.find((item) => item.key === key)
  const ids = new Set([archetypeId, ...merged])
  const mine = (decks.data ?? []).filter((deck) => deck.tournamentArchetypeId && ids.has(deck.tournamentArchetypeId))
  return (
    <Section title="Vos y este arquetipo">
      {stats.isPending || decks.isPending ? <LoadingRows rows={1} /> : null}
      {stats.isError ? <ErrorState error={stats.error} onRetry={() => stats.refetch()} /> : null}
      {decks.isError ? <ErrorState error={decks.error} onRetry={() => decks.refetch()} /> : null}
      {stats.data ? (
        row ? (
          <RateRows
            rows={[
              {
                id: key,
                label: `Tus partidas contra ${row.label}`,
                to: `/partidas/historial?rival=${encodeURIComponent(row.label)}&exacto=1`,
                record: row.record,
                rate: row.rate,
              },
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Todavía no registraste partidas contra él (o lo anotaste con otro nombre).
          </p>
        )
      ) : null}
      {decks.data ? (
        mine.length > 0 ? (
          <ul className="divide-y rounded-lg border text-sm">
            {mine.map((deck) => (
              <li key={deck.id}>
                <Link
                  to={`/mazos/${encodeURIComponent(deck.id)}`}
                  className="flex min-h-11 items-center px-3 hover:bg-muted"
                >
                  Tu mazo #{deck.id} {deck.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ningún mazo tuyo marcado como este arquetipo (se elige en la ficha del mazo, en «Rendimiento»).
          </p>
        )
      ) : null}
    </Section>
  )
}
