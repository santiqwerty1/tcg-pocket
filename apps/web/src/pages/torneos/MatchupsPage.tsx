/**
 * Matchups de torneo (Fase 9): the most played archetypes of the era against each other, from Limitless's pairings
 * (who played whom in each round). What each one should score against the field, then the table. Matches between
 * people; a match is a whole BO1 or BO3.
 */
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { MatchupMatrix } from '@/api/schemas'
import { useMatchupMatrix } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatInterval, formatRateValue, formatSample, ORIENTATIVE_BELOW } from '@/lib/matches'
import { matchupTone, shortName, TONE_CLASS } from '@/lib/matchups'
import { formatCount, formatShare, scopeFromSearch, scopeSearch } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

const SIZES = [8, 12, 20] as const

function Coverage({ data }: { data: MatchupMatrix }) {
  const { coverage } = data
  if (coverage.tournamentsWithPairings === 0) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Todavía no se bajaron las rondas de los torneos de {data.scope.era.code}. Llegan con la próxima sincronización
        (una llamada más por torneo, respetando el límite de Limitless).
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      {formatCount(coverage.matches)} partidas de {coverage.tournamentsWithPairings} de {coverage.tournaments} torneos
      de {data.scope.era.code}. Cada partida es un BO1 o un BO3 entero; sin byes, ausencias ni dobles derrotas
      {coverage.skipped.noArchetype > 0
        ? `, ni ${formatCount(coverage.skipped.noArchetype)} partidas con un jugador sin lista`
        : ''}
      .
    </p>
  )
}

function Table({ data, search }: { data: MatchupMatrix; search: string }) {
  const cell = new Map(data.cells.map((item) => [`${item.a}|${item.b}`, item]))
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-normal text-muted-foreground">
              Fila contra columna
            </th>
            {data.archetypes.map((col) => (
              <th
                key={col.archetype.id}
                className="max-w-20 px-1.5 py-1 text-left align-bottom font-normal text-muted-foreground"
                title={col.archetype.name}
              >
                {shortName(col.archetype.name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.archetypes.map((row) => (
            <tr key={row.archetype.id} className="border-t">
              <th className="sticky left-0 z-10 max-w-32 bg-background px-2 py-1 text-left font-medium">
                <Link
                  to={`/torneos/arquetipos/${encodeURIComponent(row.archetype.id ?? 'none')}${search}`}
                  className="block truncate hover:underline"
                  title={row.archetype.name}
                >
                  {row.archetype.name}
                </Link>
              </th>
              {data.archetypes.map((col) => {
                const item = cell.get(`${row.archetype.id}|${col.archetype.id}`)
                const mirror = row.archetype.id === col.archetype.id
                return (
                  <td
                    key={col.archetype.id}
                    className={cn('px-1.5 py-1 text-right tabular', mirror && 'bg-muted/50')}
                    title={
                      item?.rate
                        ? `${row.archetype.name} contra ${col.archetype.name}: n = ${item.rate.games}, IC ${formatInterval(item.rate.ci95)}`
                        : undefined
                    }
                  >
                    {mirror ? (
                      <span className="text-muted-foreground">espejo</span>
                    ) : item?.rate ? (
                      <>
                        <span className={cn('font-medium', TONE_CLASS[matchupTone(item.rate)])}>
                          {formatRateValue(item.rate.value)}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">n {item.rate.games}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MatchupsPage() {
  const [params] = useSearchParams()
  const scope = scopeFromSearch(params)
  const search = scopeSearch(scope)
  const [top, setTop] = useState<number>(12)
  const matrix = useMatchupMatrix(scope, top)

  if (matrix.isPending) return <LoadingRows />
  if (matrix.isError) return <ErrorState error={matrix.error} onRetry={() => matrix.refetch()} />
  const data = matrix.data

  return (
    <div className="flex flex-col gap-5">
      <Section title={`Matchups de ${data.scope.era.code}`}>
        <Coverage data={data} />
      </Section>

      {data.coverage.matches > 0 ? (
        <>
          <Section title="Contra el meta">
            <p className="text-xs text-muted-foreground">
              Lo que debería sacar cada arquetipo si enfrentara a cada rival tanto como se juega: sus matchups pesados
              por la cuota de cada rival. Un matchup con pocas partidas se acerca a su récord contra todos, así una mala
              racha chica no lo hunde; «con datos» es la parte del meta donde hay 10 partidas o más.
            </p>
            <ul className="divide-y rounded-lg border">
              {data.archetypes.map((row) => (
                <li key={row.archetype.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="flex items-baseline gap-3">
                    <Link
                      to={`/torneos/arquetipos/${encodeURIComponent(row.archetype.id ?? 'none')}${search}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {row.archetype.name}
                    </Link>
                    <span className="shrink-0 font-semibold tabular">
                      {row.expected ? formatRateValue(row.expected.value) : 'sin datos'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatShare(row.share)} del meta
                    {row.expected
                      ? ` · con datos: ${formatShare(row.expected.coverage)} del meta, ${row.expected.rivals} rivales (n = ${formatCount(row.expected.matches)}${row.expected.ci95 ? `, IC ${formatInterval(row.expected.ci95)}` : ''}${row.expected.matches < ORIENTATIVE_BELOW ? ', orientativo' : ''})`
                      : ''}
                    {row.field.rate
                      ? ` · contra todos: ${formatRateValue(row.field.rate.value)} (${formatSample(row.field.rate)}, IC ${formatInterval(row.field.rate.ci95)}${row.field.rate.orientative ? ', orientativo' : ''})`
                      : ''}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Tabla"
            action={
              <div className="flex gap-1">
                {SIZES.map((size) => (
                  <Button
                    key={size}
                    size="xs"
                    variant={top === size ? 'default' : 'outline'}
                    onClick={() => setTop(size)}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            }
          >
            <p className="text-xs text-muted-foreground">
              Porcentaje de la fila contra la columna. En verde, favorable con el intervalo entero arriba de 50 %; en
              rojo, desfavorable; sin color, no se puede decir. Tocá un nombre para ver el arquetipo.
            </p>
            <Table data={data} search={search} />
          </Section>
        </>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {data.attribution}. Partidas entre personas en torneos online: no son simulaciones. Los jugadores repiten a lo
        largo de las rondas, así que el intervalo es optimista.
      </p>
    </div>
  )
}
