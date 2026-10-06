import {
  ChevronRightIcon,
  CircleHelpIcon,
  DatabaseIcon,
  ImageIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  UserIcon,
} from 'lucide-react'
import { Link } from 'react-router'

const ENTRIES = [
  { to: '/mas/catalogo', label: 'Catálogo', hint: 'Commit, conteos y sincronización', icon: RefreshCwIcon },
  { to: '/mas/backup', label: 'Copia de seguridad', hint: 'Exportar e importar todos tus datos', icon: DatabaseIcon },
  { to: '/mas/tokens', label: 'Tokens de API', hint: 'Para el worker y el conector de Claude', icon: KeyRoundIcon },
  { to: '/mas/sesion', label: 'Sesión', hint: 'Contraseña y cerrar sesión', icon: UserIcon },
  { to: '/mas/ajustes', label: 'Ajustes de la app', hint: 'Miniaturas de cartas', icon: ImageIcon },
  { to: '/mas/acerca', label: 'Acerca de', hint: 'Versión y licencias', icon: CircleHelpIcon },
]

export function MasPage() {
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
