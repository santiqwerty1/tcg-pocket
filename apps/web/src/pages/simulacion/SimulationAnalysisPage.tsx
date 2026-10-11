import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useCalibration } from '@/api/calibration'
import type { SimulationStatus } from '@/api/schemas'
import { type SimulationAnalysis, useSimulationAnalysis } from '@/api/simulationAnalysis'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { formatNumber, shortSha } from '@/lib/format'
import { formatInterval, formatRate, formatRateValue } from '@/lib/matches'
import { STATUS_LABEL } from '@/lib/simulation'
import { AnalysisChart } from './AnalysisChart'
import { CalibrationReport } from './CalibrationPage'
import { MatrixGrid } from './SimulationDetailPage'

const decimal = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 2 })
const points = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
const selectClass = 'min-h-11 w-full min-w-0 rounded-lg border bg-background px-2 text-sm'

function Calibration({ id }: { id: number }) {
  const query = useCalibration(String(id))
  return (
    <div className="flex flex-col gap-4">
      <Link className="text-primary underline" to={`/simulacion/calibracion/${id}`}>
        Calibración #{id}
      </Link>
      {query.isPending ? <LoadingRows rows={2} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? <CalibrationReport view={query.data} /> : null}
    </div>
  )
}

function Heatmap({ matrix }: { matrix: NonNullable<SimulationAnalysis['matrix']> }) {
  const labels = new Map<string, string>()
  for (const row of matrix.rows) {
    labels.set(row.key, row.label)
    for (const cell of row.cells) labels.set(cell.rival, cell.label)
  }
  const ids = new Map([...labels.keys()].sort().map((key, i) => [key, i]))
  return (
    <MatrixGrid
      job={{
        snapshots: [...labels].map(([key, label]) => ({ id: ids.get(key) as number, label })),
        rows: matrix.rows.map((row) => ({
          snapshot: ids.get(row.key) as number,
          total: row.record,
          rate: row.rate,
          cells: row.cells.map((cell) => ({
            rival: ids.get(cell.rival) as number,
            record: cell.record,
            rate: cell.rate,
          })),
        })),
      }}
    />
  )
}

export function SimulationAnalysisPage() {
  const [params, setParams] = useSearchParams()
  const query = useSimulationAnalysis(params)
  const view = query.data
  const choose = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (['bot', 'era', 'expansion'].includes(key))
      for (const dependent of ['matrix', 'left', 'right', 'calibration']) next.delete(dependent)
    setParams(next)
  }
  const { matrix, games } = view ?? {}
  const calibrationId =
    Number(params.get('calibration')) || view?.calibrationJobId || view?.matrices.find((m) => m.calibration)?.id
  const selected = view?.matrices.find((m) => m.id === matrix?.id)
  const correlation = view?.agreement?.correlation
  const charts = useMemo(
    () =>
      new Map(
        view?.rankings.map((ranking) => {
          const top = ranking.rows.filter((row) => row.rate).slice(0, 12)
          return [
            ranking.id,
            {
              x: top.map((_, i) => i + 1),
              values: top.map((r) => r.rate?.value ?? 0),
              lower: top.map((r) => r.rate?.ci95[0] ?? 0),
              upper: top.map((r) => r.rate?.ci95[1] ?? 0),
            },
          ]
        }),
      ),
    [view?.rankings],
  )
  const histogram = useMemo(
    () => ({ x: games?.histogram.map((r) => r.turns) ?? [], values: games?.histogram.map((r) => r.games) ?? [] }),
    [games?.histogram],
  )
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Análisis de simulaciones</h1>
        <p className="text-sm text-muted-foreground">
          Resultados de bots. Cada porcentaje con n e IC 95 %; orientativo con menos de 30 partidas. El resultado
          depende del bot y del motor.
        </p>
      </div>
      <Link to="/simulacion" className="text-primary underline">
        Volver a Simulación
      </Link>
      {query.isPending ? <LoadingRows /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {view ? (
        <>
          <Section title="Filtros">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(['bot', 'era', 'expansion'] as const).map((key) => (
                <label key={key} className="flex min-w-0 flex-col gap-1 text-sm">
                  {key === 'bot' ? 'Bot' : key === 'era' ? 'Era' : 'Expansión'}
                  <select
                    aria-label={key === 'bot' ? 'Bot' : key === 'era' ? 'Era' : 'Expansión'}
                    className={selectClass}
                    value={params.get(key) ?? ''}
                    onChange={(e) => choose(key, e.target.value)}
                  >
                    <option value="">Todas</option>
                    {view.options[key === 'bot' ? 'bots' : key === 'era' ? 'eras' : 'expansions'].map((value) => (
                      <option key={value} value={value}>
                        {key === 'bot'
                          ? `${value} · ${view.summary.byBot.find((row) => row.bot === `${value}/${value}`)?.botEs.split(' / ')[0] ?? value}`
                          : value}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Expansión = cartas presentes en las listas. Una simulación puede aparecer en varias expansiones: esos
              subtotales se solapan. Era = dato guardado por el trabajo; {view.summary.unknownEra} no tienen era
              declarada.
            </p>
          </Section>
          <Section title="Resumen">
            <p className="text-lg tabular">
              {formatNumber(view.summary.simulations)} simulaciones · {formatNumber(view.summary.games)} partidas
              terminadas
            </p>
            <p className="text-xs text-muted-foreground">
              Incluye archivadas, laboratorio, consistencia y optimizaciones; cuenta cada partida reportada una vez, sin
              duplicar los dos lados. {view.summary.failedChunks} chunks fallaron. Los rankings usan matrices y no
              mezclan trabajos de búsqueda.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <ul className="text-sm">
                {view.summary.byBot.map((row) => (
                  <li key={row.bot} className="border-b py-2">
                    <strong>{row.bot}</strong>: {formatNumber(row.simulations)} simulaciones · {formatNumber(row.games)}{' '}
                    partidas
                  </li>
                ))}
              </ul>
              <ul className="text-sm">
                {view.summary.byExpansion.map((row) => (
                  <li key={row.expansion} className="border-b py-2">
                    <strong>{row.expansion}</strong>: {formatNumber(row.simulations)} simulaciones ·{' '}
                    {formatNumber(row.games)} partidas
                  </li>
                ))}
              </ul>
            </div>
          </Section>
          {!view.summary.simulations ? <EmptyState title="Todavía no hay simulaciones para estos filtros" /> : null}
          <Section title="Ranking de mazos por bot">
            <p className="text-xs text-muted-foreground">
              Última matriz con resultados por bot, era y motor, y las matrices elegidas, sin juntar corridas. Totales
              contra los rivales jugados de cada matriz; bancos distintos no son comparables directamente. Los puntos y
              la banda muestran victorias e IC; abajo está n.
            </p>
            {view.rankings.length ? (
              view.rankings.map((ranking) => {
                const chart = charts.get(ranking.id)
                if (!chart) return null
                return (
                  <details key={ranking.id} open={ranking.id === matrix?.id} className="min-w-0 rounded-lg border p-3">
                    <summary className="min-h-11 cursor-pointer text-sm font-medium">
                      {ranking.bot} · {ranking.era ?? 'sin era'} · motor {shortSha(ranking.engineRev)} · #{ranking.id}
                    </summary>
                    <AnalysisChart title={`Ranking ${ranking.bot} con intervalos`} {...chart} />
                    <p className="text-xs text-muted-foreground">
                      Gráfico: primeras {chart.x.length} listas. Ranking completo:
                    </p>
                    <ol className="list-inside list-decimal text-sm">
                      {ranking.rows.map((row) => (
                        <li key={row.key} className="border-b py-2">
                          <strong>{row.label}</strong>
                          <p>{formatRate(row.rate)}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )
              })
            ) : (
              <p>Sin matrices con el mismo bot en ambos lados.</p>
            )}
          </Section>
          <Section title="Acuerdo entre bots">
            <div className="grid gap-3 sm:grid-cols-2">
              {(['left', 'right'] as const).map((key) => (
                <label key={key} className="flex min-w-0 flex-col gap-1 text-sm">
                  {key === 'left' ? 'Bot de referencia' : 'Bot a comparar'}
                  <select
                    aria-label={key === 'left' ? 'Bot de referencia' : 'Bot a comparar'}
                    className={selectClass}
                    value={params.get(key) ?? String(view.comparison[key] ?? '')}
                    onChange={(e) => choose(key, e.target.value)}
                  >
                    <option value="">Automático</option>
                    {view.matrices
                      .filter((m) => m.symmetric)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          #{m.id} · {m.bot} · {m.era ?? 'sin era'} · {shortSha(m.engineRev)} ·{' '}
                          {STATUS_LABEL[m.status as SimulationStatus]}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Listas exactas en común y, para cada lista, los mismos rivales con peso igual. Diferencia = bot a comparar
              menos referencia. e2 y f2 permiten explorar H-018. IC aproximado de corridas independientes; no es una
              prueba apareada. Cambiar motor o banco también puede explicar diferencias. La correlación bootstrap
              remuestrea listas; refleja estabilidad del orden entre listas, no incertidumbre por partida.
            </p>
            {view.agreement ? (
              <p className="text-sm">
                {view.agreement.leftBot} ({STATUS_LABEL[view.agreement.leftStatus as SimulationStatus]}) →{' '}
                {view.agreement.rightBot} ({STATUS_LABEL[view.agreement.rightStatus as SimulationStatus]}).{' '}
                {view.agreement.sameEngine ? 'Mismo motor' : 'Motores distintos'}: {shortSha(view.agreement.leftEngine)}{' '}
                / {shortSha(view.agreement.rightEngine)}.
              </p>
            ) : null}
            {correlation ? (
              <p>
                Spearman ρ = {decimal(correlation.rho)} · n = {correlation.n} listas · IC 95 %{' '}
                {correlation.ci95 ? correlation.ci95.map(decimal).join(' a ') : 'no estimable'}
                {view.agreement?.orientative ? ' · orientativo' : ''}
              </p>
            ) : (
              <p>
                No hay al menos tres listas comparables con rangos distintos entre dos bots con eras compatibles cuando
                se conocen.
              </p>
            )}
            <p className="text-sm">Mazos que más suben o bajan (por diferencia en puntos):</p>
            <ul className="text-sm">
              {view.agreement?.changes.map((c) => (
                <li key={c.key} className="border-b py-3">
                  <strong>
                    {c.label}: {points(c.difference.value)} puntos
                  </strong>
                  <p>
                    IC 95 % {c.difference.ci95.map(points).join(' a ')} puntos · n = {formatNumber(c.before.games)}/
                    {formatNumber(c.after.games)} · {c.rivals} rivales comunes{c.orientative ? ' · orientativo' : ''}
                  </p>
                  <p className="text-muted-foreground">
                    Posición {decimal(c.rankBefore)} → {decimal(c.rankAfter)} · referencia{' '}
                    {formatRateValue(c.before.value)} (IC {formatInterval(c.before.ci95)}, n ={' '}
                    {formatNumber(c.before.games)}) · comparación {formatRateValue(c.after.value)} (IC{' '}
                    {formatInterval(c.after.ci95)}, n = {formatNumber(c.after.games)})
                  </p>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Mapa de calor de matchups">
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              Matriz
              <select
                aria-label="Matriz"
                className={selectClass}
                value={params.get('matrix') ?? String(matrix?.id ?? '')}
                onChange={(e) => choose('matrix', e.target.value)}
              >
                <option value="">Automática</option>
                {view.matrices.map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.id} · {m.label} · {m.bot}
                    {m.archived ? ' · archivada' : ''}
                  </option>
                ))}
              </select>
            </label>
            {matrix ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {matrix.bot} · motor {shortSha(matrix.engineRev)} · {matrix.era ?? 'sin era declarada'} ·{' '}
                  {selected ? STATUS_LABEL[selected.status as SimulationStatus] : ''}. Solo cruces terminados; una
                  corrida parcial puede sesgar el ranking. Deslizá la tabla y tocá una celda para ver n e IC.
                </p>
                <Heatmap key={matrix.id} matrix={matrix} />
              </>
            ) : (
              <p>Sin matrices.</p>
            )}
          </Section>
          <Section title="Empezar, duración y empates">
            <p className="text-xs text-muted-foreground">
              {view.gameSample?.scope === 'laboratory'
                ? `Laboratorio del mismo bot y motor (trabajos ${view.gameSample.jobIds.join(', ')}); muestra de búsqueda, puede compartir semillas; IC exploratorios.`
                : 'Matriz elegida.'}{' '}
              Cobertura por partida: {formatNumber(games?.coverage ?? 0)} de{' '}
              {formatNumber(view.gameSample?.scope === 'laboratory' ? view.gameSample.games : (selected?.games ?? 0))}.
              Empezar y el histograma necesitan datos por partida y el mismo bot en ambos lados. La media puede usar
              turnos agregados; sin datos por partida no se estima su IC. Se cuenta cada juego una vez; turnos globales
              suman los turnos de ambos jugadores.
            </p>
            {games ? (
              <>
                <p>Gana quien empieza primero: {formatRate(games.first)}</p>
                <p>Gana quien empieza segundo: {formatRate(games.second)}</p>
                {games.firstAdvantage ? (
                  <p>
                    Ventaja de primero: {points(games.firstAdvantage.value)} puntos (IC 95 %{' '}
                    {games.firstAdvantage.ci95.map(points).join(' a ')}; n = {formatNumber(games.firstAdvantage.n)}
                    {games.firstAdvantage.orientative ? '; orientativo' : ''}).
                  </p>
                ) : null}
                <p>Empates: {formatRate(games.ties)}</p>
                {games.duration ? (
                  <>
                    <p>
                      Duración media: {decimal(games.duration.mean)} turnos (IC 95 %{' '}
                      {games.duration.ci95 ? games.duration.ci95.map(decimal).join(' a ') : 'no estimable'}; n ={' '}
                      {formatNumber(games.duration.n)}
                      {games.duration.orientative ? '; orientativo' : ''}).
                    </p>
                    <AnalysisChart histogram title="Distribución de duración de partidas" {...histogram} />
                    <details>
                      <summary className="min-h-11 cursor-pointer">Partidas por duración</summary>
                      <ul>
                        {games.histogram.map((row) => (
                          <li key={row.turns}>
                            {row.turns} turnos: {formatNumber(row.games)} partidas
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                ) : (
                  <p>Sin datos por partida para estimar la duración.</p>
                )}
              </>
            ) : null}
          </Section>
          <Section title="Calibración contra torneos">
            <p className="text-xs text-muted-foreground">
              Simulaciones y torneos lado a lado, cada fuente con su n e intervalo. Las partidas propias de Santi
              permanecen separadas.
            </p>
            {view.matrices.some((m) => m.calibration) ? (
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                Calibración
                <select
                  aria-label="Calibración"
                  className={selectClass}
                  value={calibrationId ?? ''}
                  onChange={(e) => choose('calibration', e.target.value)}
                >
                  {view.matrices
                    .filter((m) => m.calibration)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        #{m.id} · {m.bot} · {m.era}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {calibrationId ? (
              <Calibration key={calibrationId} id={calibrationId} />
            ) : (
              <p>
                No hay calibraciones para estos filtros.{' '}
                <Link to="/simulacion/calibracion" className="text-primary underline">
                  Abrir Calibración
                </Link>
              </p>
            )}
          </Section>
          <Section title="Hallazgos">
            <p className="text-xs text-muted-foreground">
              Generados desde los resultados actuales. Exploratorios: selección con Benjamini–Hochberg (FDR 5 %) sobre
              cruces y cambios; los IC son puntuales. Cruces con al menos 55 % de las partidas decididas, cambios de al
              menos 5 puntos. No prueban causalidad del bot ni aseguran rendimiento en torneos.
            </p>
            <ul className="list-inside list-disc text-sm">
              {view.findings.map((finding) => (
                <li key={`${finding.kind}-${finding.text}`} className="py-2">
                  {finding.text}
                </li>
              ))}
            </ul>
            {!view.findings.length ? <p>Sin evidencia suficiente para generar hallazgos.</p> : null}
            <p className="text-xs text-muted-foreground">
              {view.patterns.dominantTotal} matchups seleccionados por efecto y corrección múltiple;{' '}
              {view.patterns.cyclesTotal} ciclos A &gt; B &gt; C &gt; A ordenados por su arista más débil. Se muestran
              hasta tres de cada clase.
            </p>
          </Section>
        </>
      ) : null}
    </div>
  )
}
