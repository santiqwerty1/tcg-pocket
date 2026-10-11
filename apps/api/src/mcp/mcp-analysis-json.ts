import type { SimulationAnalysisService } from '../simulation/analysis.service.js'
import { rateView } from './mcp-json.js'

type Analysis = Awaited<ReturnType<SimulationAnalysisService['read']>>
const number = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 })
const signed = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

/** REST keeps all cells for the heatmap; MCP quotes a bounded selection and its evidence. */
export function analysisJson(view: Analysis, limit = 5, full = false) {
  const { first, second, ties, firstAdvantage, duration } = view.games
  return {
    source: view.source,
    text: `${number(view.summary.simulations)} simulaciones; ${number(view.summary.games)} partidas terminadas.`,
    warning:
      'Hallazgos exploratorios: selección con Benjamini–Hochberg (FDR 5 %); los IC son puntuales. No prueban causalidad del bot ni rendimiento en torneos. El laboratorio contiene listas de búsqueda y puede compartir semillas.',
    summary: view.summary,
    findings: view.findings,
    rankings: view.rankings.map(({ rows, ...matrix }) => ({
      ...matrix,
      total: rows.length,
      rows: rows
        .filter((row) => row.rate)
        .slice(0, limit)
        .map(({ key, label, rate }) => ({ key, label, rate: rateView(rate) })),
    })),
    agreement: view.agreement
      ? {
          ...view.agreement,
          changesTotal: view.agreement.changes.length,
          changes: [...view.agreement.changes]
            .sort((a, b) => Math.abs(b.difference.value) - Math.abs(a.difference.value))
            .slice(0, limit)
            .map((change) => ({
              key: change.key,
              label: change.label,
              rivals: change.rivals,
              significant: change.significant,
              before: rateView({
                ...change.before,
                source: 'simulation',
                samples: change.before.games,
                sampleKind: 'simulations',
                orientative: change.orientative,
              }),
              after: rateView({
                ...change.after,
                source: 'simulation',
                samples: change.after.games,
                sampleKind: 'simulations',
                orientative: change.orientative,
              }),
              rankBefore: change.rankBefore,
              rankAfter: change.rankAfter,
              difference: {
                ...change.difference,
                text: `${signed(change.difference.value)} puntos (n = ${change.before.games}/${change.after.games}, IC 95 % ${change.difference.ci95.map(signed).join(' a ')} puntos${change.orientative ? ', orientativo' : ''}); ${view.agreement?.rightBot} menos ${view.agreement?.leftBot}; motores ${view.agreement?.rightEngine}/${view.agreement?.leftEngine}.`,
              },
            })),
        }
      : null,
    comparison: view.comparison,
    games: {
      coverage: view.games.coverage,
      sample: view.gameSample,
      first: rateView(first),
      second: rateView(second),
      ties: ties ? { ...rateView(ties), scope: 'matrix', matrix: view.matrix?.id ?? null } : null,
      firstAdvantage: firstAdvantage
        ? {
            text: `${signed(firstAdvantage.value)} puntos (n = ${firstAdvantage.n}, IC 95 % ${firstAdvantage.ci95.map(signed).join(' a ')} puntos${firstAdvantage.orientative ? ', orientativo' : ''}).`,
          }
        : null,
      duration: duration
        ? {
            text: `${number(duration.mean)} turnos (n = ${duration.n}, IC 95 % ${duration.ci95?.map(number).join(' a ') ?? 'no estimable'}${duration.orientative ? ', orientativo' : ''}).`,
          }
        : null,
    },
    ...(full && view.matrix
      ? {
          matrix: {
            ...view.matrix,
            rows: view.matrix.rows.map((row) => ({
              ...row,
              rate: rateView(row.rate),
              cells: row.cells.map((cell) => ({ ...cell, rate: rateView(cell.rate) })),
            })),
          },
        }
      : {}),
  }
}
