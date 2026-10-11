import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { type MatchStatsParams, useMatchStats } from '@/api/matches'
import { MATCH_MODES, type MatchMode } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { RateHeadline, RateRows } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { TurnOrderCard } from '@/components/TurnOrderCard'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatInterval, formatRateValue, MODE_LABEL, PERIODS, type PeriodKey, periodFrom } from '@/lib/matches'
import { ChoiceGroup } from './MatchFields'
import { MyMetaSection } from './MyMetaSection'

const ALL_MODES = '__all__'

/** Own matches only (BRIEF §2): tournament and simulation numbers live in their own views and never mix in here. */
export function MatchStatsPage() {
  // Fase 41: the filters live in the URL, so back from a deck or the history returns to the same view.
  const [search, setSearch] = useSearchParams()
  const modeParam = search.get('modalidad')
  const mode: MatchMode | typeof ALL_MODES = (MATCH_MODES as readonly string[]).includes(modeParam ?? '')
    ? (modeParam as MatchMode)
    : ALL_MODES
  const periodParam = search.get('periodo')
  const period: PeriodKey = PERIODS.some((item) => item.key === periodParam) ? (periodParam as PeriodKey) : 'all'
  function setFilter(key: 'modalidad' | 'periodo', value: string, fallback: string) {
    const next = new URLSearchParams(search)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setSearch(next, { replace: true, preventScrollReset: true })
  }
  const setMode = (value: MatchMode | typeof ALL_MODES) => setFilter('modalidad', value, ALL_MODES)
  const setPeriod = (value: PeriodKey) => setFilter('periodo', value, 'all')
  // The period start is fixed when the filter changes, so the query key does not change on every render.
  const params = useMemo<MatchStatsParams>(() => {
    const from = periodFrom(period)
    return { ...(mode === ALL_MODES ? {} : { mode }), ...(from ? { from } : {}) }
  }, [mode, period])
  const stats = useMatchStats(params)
  function historyLink(label: string): string {
    const query = new URLSearchParams({ rival: label, exacto: '1' })
    if (mode !== ALL_MODES) query.set('modalidad', mode)
    if (period !== 'all') query.set('periodo', period)
    return `/partidas/historial?${query.toString()}`
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Select value={mode} onValueChange={(value) => setMode(value as MatchMode | typeof ALL_MODES)}>
          <SelectTrigger aria-label="Modalidad" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_MODES}>Todas las modalidades</SelectItem>
            {MATCH_MODES.map((item) => (
              <SelectItem key={item} value={item}>
                {MODE_LABEL[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ChoiceGroup label="Período" hiddenLabel className="grid grid-cols-4 gap-1.5">
          {PERIODS.map((item) => (
            <Button
              key={item.key}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={period === item.key}
              className="aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              onClick={() => setPeriod(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </ChoiceGroup>
      </div>

      {stats.isPending ? <LoadingRows /> : null}
      {stats.isError ? <ErrorState error={stats.error} onRetry={() => stats.refetch()} /> : null}
      {stats.data && stats.data.overall.rate === null ? (
        <EmptyState
          title="Sin partidas en este filtro"
          description="Registrá partidas desde la pantalla de Partidas o cambiá el filtro."
        />
      ) : null}
      {stats.data && stats.data.overall.rate !== null ? (
        <>
          <RateHeadline
            label="Porcentaje de victorias"
            hint="Mis partidas · V / (V + D + E)"
            record={stats.data.overall.record}
            rate={stats.data.overall.rate}
          />

          <Section title="Por mazo">
            <RateRows
              rows={stats.data.byDeck.map((row) => ({
                id: row.deck.id,
                label: row.deck.name,
                ...(row.deck.archived || row.coinAdjusted
                  ? {
                      hint: [
                        row.deck.archived ? 'archivado' : null,
                        row.coinAdjusted
                          ? `con la moneda pareja ${formatRateValue(row.coinAdjusted.value)} (n = ${row.coinAdjusted.games}, IC ${formatInterval(row.coinAdjusted.ci95)}${row.coinAdjusted.orientative ? ', orientativo' : ''})`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    }
                  : {}),
                to: `/mazos/${encodeURIComponent(row.deck.id)}`,
                record: row.record,
                rate: row.rate,
              }))}
            />
          </Section>

          <Section title="Por rival">
            <RateRows
              rows={stats.data.byOpponent.map((row) => ({
                id: row.key ?? '__none__',
                label: row.label,
                // Fase 41: the matches behind the row.
                // …with the same modality and period, so the history counts what the row counts.
                ...(row.key ? { to: historyLink(row.label) } : {}),
                record: row.record,
                rate: row.rate,
              }))}
            />
          </Section>

          <MyMetaSection
            mode={mode === ALL_MODES ? undefined : mode}
            days={PERIODS.find((item) => item.key === period)?.days ?? undefined}
          />

          {stats.data.turnOrder ? (
            <Section title="¿Importa empezar?">
              <TurnOrderCard turnOrder={stats.data.turnOrder} coinAdjusted={stats.data.coinAdjusted} />
            </Section>
          ) : null}

          <Section title="¿Quién empezó?">
            <RateRows
              rows={stats.data.byWentFirst.map((row) => ({
                id: row.key,
                label: row.label,
                record: row.record,
                rate: row.rate,
              }))}
            />
          </Section>

          {mode === ALL_MODES ? (
            <Section title="Por modalidad">
              <RateRows
                rows={stats.data.byMode.map((row) => ({
                  id: row.mode,
                  label: row.label,
                  record: row.record,
                  rate: row.rate,
                }))}
              />
            </Section>
          ) : null}
        </>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Victorias sobre partidas jugadas: los empates cuentan como partidas sin victoria. Intervalo de confianza del 95
        % de Wilson. Con menos de 30 partidas el número se marca «orientativo». Solo tus partidas: los datos de torneo y
        las simulaciones se muestran aparte y nunca se suman a estos.
      </p>
    </div>
  )
}
