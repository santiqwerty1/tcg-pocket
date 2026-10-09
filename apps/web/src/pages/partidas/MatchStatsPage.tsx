import { useMemo, useState } from 'react'
import { type MatchStatsParams, useMatchStats } from '@/api/matches'
import { MATCH_MODES, type MatchMode } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { RateHeadline, RateRows } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { TurnOrderCard } from '@/components/TurnOrderCard'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MODE_LABEL, PERIODS, type PeriodKey, periodFrom } from '@/lib/matches'
import { ChoiceGroup } from './MatchFields'

const ALL_MODES = '__all__'

/** Own matches only (BRIEF §2): tournament and simulation numbers live in their own views and never mix in here. */
export function MatchStatsPage() {
  const [mode, setMode] = useState<MatchMode | typeof ALL_MODES>(ALL_MODES)
  const [period, setPeriod] = useState<PeriodKey>('all')
  // The period start is fixed when the filter changes, so the query key does not change on every render.
  const params = useMemo<MatchStatsParams>(() => {
    const from = periodFrom(period)
    return { ...(mode === ALL_MODES ? {} : { mode }), ...(from ? { from } : {}) }
  }, [mode, period])
  const stats = useMatchStats(params)

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
                ...(row.deck.archived ? { hint: 'archivado' } : {}),
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
                record: row.record,
                rate: row.rate,
              }))}
            />
          </Section>

          {stats.data.turnOrder ? (
            <Section title="¿Importa empezar?">
              <TurnOrderCard turnOrder={stats.data.turnOrder} />
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
