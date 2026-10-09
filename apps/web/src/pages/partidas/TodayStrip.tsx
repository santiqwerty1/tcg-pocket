/**
 * «Para hoy» (Fase 26), on top of the home screen: only what has something to say — a game against the bot waiting
 * for your move, the app's alerts, situations to solve, simulations and searches that finished in the last day, the
 * deck to bring, today's record and the archetype rising the most this week. Each line opens its page; anything that
 * fails to load is just left out (the quick-entry form below never waits for it).
 */
import {
  BellIcon,
  CpuIcon,
  FlaskConicalIcon,
  type LucideIcon,
  SwordsIcon,
  TargetIcon,
  TrendingUpIcon,
  TrophyIcon,
} from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { useAlerts } from '@/api/alerts'
import { usePickToday } from '@/api/decks'
import { useLabJobs } from '@/api/lab'
import { useMatchStats } from '@/api/matches'
import { usePlayGames } from '@/api/play'
import { usePuzzles } from '@/api/puzzles'
import { useSimulations } from '@/api/simulations'
import { useMetaTrends } from '@/api/tournaments'
import { formatRecord } from '@/lib/matches'
import { lastSeen } from '@/lib/seen'
import { cn } from '@/lib/utils'

const DAY_MS = 24 * 60 * 60 * 1000

interface Line {
  key: string
  icon: LucideIcon
  text: string
  detail?: string | undefined
  to: string
  tone?: 'turn' | 'warning' | undefined
}

function startOfToday(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

export function TodayStrip() {
  const from = useMemo(startOfToday, [])
  const games = usePlayGames()
  const alerts = useAlerts()
  const puzzles = usePuzzles()
  const simulations = useSimulations()
  const lab = useLabJobs()
  const pick = usePickToday('tournament')
  const today = useMatchStats({ from })
  const trends = useMetaTrends({}, 7)

  const lines: Line[] = []
  const waiting = (games.data ?? []).filter((game) => game.status === 'waiting')
  const first = waiting[0]
  if (first) {
    lines.push({
      key: 'turn',
      icon: SwordsIcon,
      text:
        waiting.length === 1 ? `Te toca contra ${first.rival}` : `Te toca en ${waiting.length} partidas contra el bot`,
      to: `/jugar/${first.id}`,
      tone: 'turn',
    })
  }
  for (const alert of (alerts.data ?? []).slice(0, 2)) {
    lines.push({
      key: `alert-${alert.code}`,
      icon: BellIcon,
      text: alert.title,
      detail: alert.detail,
      to: alert.link ?? '/mas',
      tone: alert.level === 'warning' ? 'warning' : undefined,
    })
  }
  const pending = puzzles.data?.counts.pending ?? 0
  if (pending > 0) {
    lines.push({
      key: 'puzzles',
      icon: TargetIcon,
      text: `${pending} ${pending === 1 ? 'situación' : 'situaciones'} para resolver`,
      detail: 'Tus errores de las partidas con entrenador',
      to: '/jugar/situaciones',
    })
  }
  // Finished in the last day and after the last visit to that page (on this device).
  const since = Date.now() - DAY_MS
  const finished = (simulations.data?.items ?? []).filter(
    (job) =>
      job.status === 'done' &&
      job.finishedAt &&
      new Date(job.finishedAt).getTime() >= Math.max(since, lastSeen('simulacion')),
  )
  const lastSim = finished[0]
  if (lastSim) {
    lines.push({
      key: 'sims',
      icon: CpuIcon,
      text:
        finished.length === 1
          ? `Terminó la simulación «${lastSim.label}»`
          : `Terminaron ${finished.length} simulaciones`,
      to: finished.length === 1 ? `/simulacion/${lastSim.id}` : '/simulacion',
    })
  }
  const searches = (lab.data ?? []).filter(
    (job) =>
      job.status === 'done' &&
      job.finishedAt &&
      new Date(job.finishedAt).getTime() >= Math.max(since, lastSeen('laboratorio')),
  )
  const lastSearch = searches[0]
  if (lastSearch) {
    lines.push({
      key: 'lab',
      icon: FlaskConicalIcon,
      text:
        searches.length === 1
          ? `Terminó «${lastSearch.label}» en el laboratorio`
          : `Terminaron ${searches.length} pruebas del laboratorio`,
      to: searches.length === 1 ? `/laboratorio/${lastSearch.id}` : '/laboratorio',
    })
  }
  const best = pick.data?.items[0]
  if (best?.tournament) {
    lines.push({
      key: 'pick',
      icon: TrophyIcon,
      text: `Para llevar hoy: ${best.deck.name}`,
      detail: `${Math.round(best.tournament.value)} % esperado contra el meta de la semana`,
      to: '/mazos/hoy',
    })
  }
  const record = today.data?.overall.record
  if (record && record.wins + record.losses + record.ties > 0) {
    lines.push({ key: 'today', icon: SwordsIcon, text: `Hoy: ${formatRecord(record)}`, to: '/partidas/historial' })
  }
  const rising = (trends.data?.archetypes ?? []).filter((row) => row.clear && row.delta > 0)[0]
  if (rising) {
    lines.push({
      key: 'trend',
      icon: TrendingUpIcon,
      text: `Sube: ${rising.archetype.name}`,
      detail: `+${Math.round(rising.delta * 10) / 10} puntos de cuota esta semana`,
      to: '/torneos/semana',
    })
  }

  if (lines.length === 0) return null
  return (
    <section aria-label="Para hoy" className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold text-muted-foreground">Para hoy</h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {lines.map(({ key, icon: Icon, text, detail, to, tone }) => (
          <li key={key}>
            <Link to={to} className="flex items-center gap-3 px-3 py-2 hover:bg-muted">
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  tone === 'turn' ? 'text-primary' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', tone === 'turn' && 'font-semibold text-primary')}>{text}</span>
                {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
