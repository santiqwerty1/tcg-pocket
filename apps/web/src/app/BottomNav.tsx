import { LayersIcon, LibraryBigIcon, MenuIcon, PackageIcon, SwordsIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { cn } from '@/lib/utils'

export interface NavDestination {
  to: string
  label: string
  icon: typeof LayersIcon
  /** Other path prefixes that count as this destination (card pages live under Colección). */
  also?: string[]
}

export const NAV_DESTINATIONS: NavDestination[] = [
  { to: '/partidas', label: 'Partidas', icon: SwordsIcon },
  { to: '/mazos', label: 'Mazos', icon: LayersIcon },
  { to: '/coleccion', label: 'Colección', icon: LibraryBigIcon, also: ['/cartas', '/grupos'] },
  { to: '/sobres', label: 'Sobres', icon: PackageIcon },
  { to: '/mas', label: 'Más', icon: MenuIcon, also: ['/torneos'] },
]

export function destinationFor(pathname: string): NavDestination | undefined {
  return NAV_DESTINATIONS.find((d) =>
    [d.to, ...(d.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`)),
  )
}

/** Five thumb-reachable destinations, fixed to the bottom with the safe-area inset. */
export function BottomNav() {
  const { pathname } = useLocation()
  const active = destinationFor(pathname)
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-safe backdrop-blur supports-backdrop-filter:bg-background/80"
    >
      <ul className="mx-auto flex max-w-3xl">
        {NAV_DESTINATIONS.map((destination) => {
          const Icon = destination.icon
          const isActive = active?.to === destination.to
          return (
            <li key={destination.to} className="flex-1">
              <NavLink
                to={destination.to}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium select-none',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-6" aria-hidden="true" />
                <span>{destination.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
