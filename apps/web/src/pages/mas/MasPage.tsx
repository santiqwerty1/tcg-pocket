import {
  CalendarRangeIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CpuIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  HandIcon,
  ImageIcon,
  KeyRoundIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  SwordsIcon,
  TrophyIcon,
  UserIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { useAlerts } from '@/api/alerts'
import { cn } from '@/lib/utils'

const ENTRIES = [
  { to: '/torneos', label: 'Torneos', hint: 'Limitless: arquetipos, listas y qué podés armar', icon: TrophyIcon },
  { to: '/simulacion', label: 'Simulación', hint: 'Mazos contra mazos con deckgym en la PC', icon: CpuIcon },
  {
    to: '/jugar',
    label: 'Jugar contra un bot',
    hint: 'Una partida desde el celu, el motor corre en la PC',
    icon: SwordsIcon,
  },
  {
    to: '/laboratorio',
    label: 'Laboratorio de mazos',
    hint: 'Probar ideas contra el meta y buscar variantes',
    icon: FlaskConicalIcon,
  },
  {
    to: '/eventos',
    label: 'Eventos',
    hint: 'Reglas de un evento: qué mazos cumplen y qué podés armar',
    icon: CalendarRangeIcon,
  },
  { to: '/mas/notas', label: 'Notas por rival', hint: 'Cómo jugarle a cada arquetipo', icon: NotebookPenIcon },
  {
    to: '/mas/mano',
    label: 'Calculadora de mano',
    hint: 'La chance de tener una carta en la mano inicial y en cada turno',
    icon: HandIcon,
  },
  { to: '/mas/catalogo', label: 'Catálogo', hint: 'Commit, conteos y sincronización', icon: RefreshCwIcon },
  { to: '/mas/backup', label: 'Copia de seguridad', hint: 'Exportar e importar todos tus datos', icon: DatabaseIcon },
  { to: '/mas/tokens', label: 'Tokens de API', hint: 'Para el worker y el conector de Claude', icon: KeyRoundIcon },
  { to: '/mas/sesion', label: 'Sesión', hint: 'Contraseña y cerrar sesión', icon: UserIcon },
  { to: '/mas/ajustes', label: 'Ajustes de la app', hint: 'Notificaciones y miniaturas de cartas', icon: ImageIcon },
  { to: '/mas/acerca', label: 'Acerca de', hint: 'Versión y licencias', icon: CircleHelpIcon },
]

function Alerts() {
  const alerts = useAlerts()
  if (!alerts.data || alerts.data.length === 0) return null
  return (
    <section aria-label="Avisos" className="flex flex-col gap-2">
      {alerts.data.map((alert) => {
        const body = (
          <>
            <span className="font-medium">{alert.title}</span>
            <span className="text-xs text-muted-foreground">{alert.detail}</span>
          </>
        )
        const className = cn(
          'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm',
          alert.level === 'warning' ? 'border-warning/60' : 'border-border',
        )
        return alert.link ? (
          <Link key={alert.code + alert.title} to={alert.link} className={cn(className, 'hover:bg-muted')}>
            {body}
          </Link>
        ) : (
          <div key={alert.code + alert.title} className={className}>
            {body}
          </div>
        )
      })}
    </section>
  )
}

export function MasPage() {
  return (
    <div className="flex flex-col gap-4">
      <Alerts />
      <MenuList />
    </div>
  )
}

function MenuList() {
  return (
    <ul className="divide-y rounded-lg border">
      {ENTRIES.map((entry) => {
        const Icon = entry.icon
        return (
          <li key={entry.to}>
            <Link to={entry.to} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted">
              <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{entry.label}</span>
                <span className="block text-xs text-muted-foreground">{entry.hint}</span>
              </span>
              <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
