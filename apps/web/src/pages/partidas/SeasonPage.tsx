/**
 * Ranked by season and rank (pedido de Santi del 14/10): the season's days, the rank now and noting a change, the curve
 * (each rank noted, with the decks played since the one before), the record by rank and by deck, and every season.
 * Only competitive matches, by the day they were played.
 */
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { type Ranked, useAddRank, useDeleteRank, useRanked, useSetSeason } from '@/api/ranked'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/format'

/** «Anotar rango»: the rank now (Master Ball with its points). */
export function RankPicker({ ranks, current }: { ranks: Ranked['ranks']; current: string | null }) {
  const add = useAddRank()
  const [rank, setRank] = useState(current ?? 'ultra-1')
  const [points, setPoints] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      const noted = await add.mutateAsync({
        rank,
        ...(rank === 'master' && points.trim() ? { points: Number(points) } : {}),
      })
      toast.success(`Anotado: ${noted.label}.`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={save} aria-label="Anotar rango">
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Rango ahora</span>
        <select
          className="h-11 rounded-lg border bg-background px-2 text-base"
          value={rank}
          onChange={(event) => setRank(event.target.value)}
        >
          {ranks.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {rank === 'master' ? (
        <div className="flex w-28 flex-col gap-1 text-sm">
          <label htmlFor="rank-points" className="text-muted-foreground">
            Puntos
          </label>
          <Input
            id="rank-points"
            inputMode="numeric"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
          />
        </div>
      ) : null}
      <Button type="submit" variant="secondary" disabled={add.isPending}>
        Anotar
      </Button>
    </form>
  )
}

/** The curve as steps: one dot per rank noted, higher ranks higher. */
function Curve({ summary, ranks }: { summary: NonNullable<Ranked['summary']>; ranks: Ranked['ranks'] }) {
  if (summary.steps.length < 2) return null
  const start = new Date(`${summary.season.startsOn}T03:00:00Z`).getTime()
  const end = new Date(`${summary.season.endsOn}T03:00:00Z`).getTime() + 24 * 60 * 60 * 1000
  const levels = summary.steps.map((step) => ranks.findIndex((rank) => rank.code === step.rank))
  const low = Math.min(...levels)
  const high = Math.max(...levels)
  const x = (at: string) => 4 + (92 * (new Date(at).getTime() - start)) / Math.max(1, end - start)
  const y = (level: number) => (high === low ? 30 : 54 - (48 * (level - low)) / (high - low))
  const points = summary.steps.flatMap((step, at) => {
    const here = `${x(step.at)},${y(levels[at] ?? 0)}`
    const before = at > 0 ? `${x(step.at)},${y(levels[at - 1] ?? 0)}` : null
    return before ? [before, here] : [here]
  })
  return (
    <svg
      viewBox="0 0 100 60"
      className="h-28 w-full text-primary"
      role="img"
      aria-label="Curva de rango de la temporada"
    >
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.2" />
      {summary.steps.map((step, at) => (
        <circle key={step.id} cx={x(step.at)} cy={y(levels[at] ?? 0)} r="1.6" fill="currentColor">
          <title>{`${step.label} · ${formatDateTime(step.at)}`}</title>
        </circle>
      ))}
    </svg>
  )
}

function SeasonDates({ season }: { season: NonNullable<Ranked['summary']>['season'] }) {
  const set = useSetSeason()
  const [open, setOpen] = useState(false)
  const [startsOn, setStartsOn] = useState(season.startsOn)
  const [endsOn, setEndsOn] = useState(season.endsOn)
  if (!open) {
    return (
      <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={() => setOpen(true)}>
        Corregir fechas
      </Button>
    )
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      await set.mutateAsync({ code: season.code, name: season.name, startsOn, endsOn })
      setOpen(false)
      toast.success('Fechas corregidas.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={save} aria-label="Fechas de la temporada">
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="season-starts" className="text-muted-foreground">
          Desde
        </label>
        <Input id="season-starts" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="season-ends" className="text-muted-foreground">
          Hasta
        </label>
        <Input id="season-ends" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
      </div>
      <Button type="submit" variant="secondary" disabled={set.isPending}>
        Guardar
      </Button>
    </form>
  )
}

export function SeasonPage() {
  const [search] = useSearchParams()
  const asked = search.get('temporada') ?? undefined
  const ranked = useRanked(asked)
  const remove = useDeleteRank()
  const data = ranked.data
  const summary = data?.summary ?? null
  return (
    <div className="flex flex-col gap-6">
      {ranked.isPending ? <LoadingRows rows={4} /> : null}
      {ranked.isError ? <ErrorState error={ranked.error} onRetry={() => ranked.refetch()} /> : null}
      {data ? (
        <Section title={summary ? summary.season.name : 'Temporada de ranked'}>
          {summary ? (
            <p className="text-sm text-muted-foreground">
              Del {summary.season.startsOn.split('-').reverse().join('/')} al{' '}
              {summary.season.endsOn.split('-').reverse().join('/')}. Partidas competitivas: {summary.text}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No hay temporada de ranked cargada para hoy.</p>
          )}
          {summary ? <SeasonDates key={summary.season.code} season={summary.season} /> : null}
          {data.current && (!summary || summary.season.code === data.current.code) ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Rango ahora: <span className="font-medium">{data.current.rank?.label ?? 'sin anotar'}</span>
              </p>
              <RankPicker ranks={data.ranks} current={data.current.rank?.rank ?? null} />
            </div>
          ) : null}
        </Section>
      ) : null}
      {summary && summary.steps.length > 0 ? (
        <Section title="Curva de rango">
          <Curve summary={summary} ranks={data?.ranks ?? []} />
          <ol className="flex flex-col gap-2 text-sm">
            {summary.steps.map((step) => (
              <li key={step.id} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  {step.move === 'up' ? <ArrowUpIcon className="size-4 text-success" aria-label="subió" /> : null}
                  {step.move === 'down' ? (
                    <ArrowDownIcon className="size-4 text-destructive" aria-label="bajó" />
                  ) : null}
                  <span className="font-medium">{step.label}</span>
                  <span className="text-xs text-muted-foreground">· {formatDateTime(step.at)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="ml-auto"
                    aria-label={`Borrar ${step.label} del ${formatDateTime(step.at)}`}
                    onClick={() => remove.mutate(step.id)}
                  >
                    Borrar
                  </Button>
                </span>
                {step.decks.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {step.move === 'up' ? 'Subió con' : step.move === 'down' ? 'Bajó con' : 'Desde el anterior'}:{' '}
                    {step.decks.map((deck) => `${deck.deckName} ${deck.text}`).join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
      {summary && summary.games > 0 ? (
        <Section title="Récord de la temporada">
          <h3 className="text-sm font-medium">Por rango</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {summary.byRank.map((row) => (
              <li key={row.label}>
                {row.label}: <span className="text-muted-foreground">{row.text}</span>
              </li>
            ))}
          </ul>
          <h3 className="text-sm font-medium">Por mazo</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {summary.byDeck.map((row) => (
              <li key={row.deckId}>
                <Link to={`/mazos/${row.deckId}`} className="hover:underline">
                  {row.deckName}
                </Link>
                : <span className="text-muted-foreground">{row.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {data && data.seasons.length > 0 ? (
        <Section title="Temporadas">
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.seasons.map((season) => (
              <li key={season.code}>
                <Link
                  to={`/partidas/temporada?temporada=${encodeURIComponent(season.code)}`}
                  className="font-medium hover:underline"
                >
                  {season.name}
                </Link>
                {season.current ? ' (en curso)' : ''}
                <span className="text-muted-foreground">
                  {' '}
                  · {season.games > 0 ? season.text : 'sin partidas competitivas'}
                  {season.rankLabel ? ` · último rango: ${season.rankLabel}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}
