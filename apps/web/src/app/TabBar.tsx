/**
 * The tab bar of mock-up D: Hoy · Mazos · Cartas · Meta · Pruebas and the magnifier, fixed at the bottom of the
 * column on every screen. Each tab remembers where it was (`FrameMemory`); a tap on the lit one goes back to its start,
 * and from there to the top of the page.
 */
import type { MouseEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { GlobalSearch } from '@/components/GlobalSearch'
import { scrollBehavior } from '@/lib/look'
import { cn } from '@/lib/utils'
import { frameFor, isPlainClick, normalizePath, TABS } from './frame'
import type { FrameMemory } from './frameMemory'

export function TabBar({ memory }: { memory: FrameMemory }) {
  const location = useLocation()
  const frame = frameFor(location.pathname)
  const path = normalizePath(location.pathname)

  return (
    <nav
      aria-label="Secciones"
      data-slot="tab-bar"
      className="pointer-events-auto grid h-[calc(var(--bar-h)+env(safe-area-inset-bottom))] grid-cols-[repeat(5,minmax(0,1fr))_50px] items-center border-t bg-card pr-2 pb-safe"
    >
      {TABS.map((tab) => {
        const lit = frame.tab?.key === tab.key
        const atRoot = lit && path === tab.root
        // A tab that is not lit leads to where it was. The lit one leads to its start; already there (whatever the
        // query string says) it does not navigate, so the filters written in the address stay.
        const target = lit ? null : memory.targetFor(tab)
        const Icon = tab.icon
        return (
          // A `Link`, not a `NavLink`: that one writes `aria-current` from its own comparison of `to` with the
          // address, wrong whenever the tab is lit by another prefix or leads to a remembered place.
          <Link
            key={tab.key}
            to={
              atRoot
                ? { pathname: location.pathname, search: location.search, hash: location.hash }
                : (target?.to ?? tab.root)
            }
            state={target?.state ?? null}
            // From a sibling view (Colección, when the start is Sobres) the start takes the entry's place: a view is
            // not a step back.
            {...(lit && !atRoot && frame.views !== null ? { replace: true } : {})}
            {...(lit ? { 'aria-current': 'page' as const } : {})}
            onClick={(event: MouseEvent) => {
              // With a modifier the tab opens in another window, as any link: nothing happens in this one.
              if (!isPlainClick(event)) return
              if (atRoot) {
                event.preventDefault()
                window.scrollTo({ top: 0, behavior: scrollBehavior() })
              } else if (target) {
                // Its scroll comes back too; the lit tab's start opens at the top.
                memory.planRestore(target.to)
              }
            }}
            className={cn(
              'flex h-full min-h-11 flex-col items-center justify-center gap-[3px] font-heading text-sm leading-none tracking-[0.01em] select-none focus-visible:outline-2 focus-visible:-outline-offset-2',
              lit ? 'font-bold text-foreground' : 'font-semibold text-foreground-3',
            )}
          >
            <span
              data-slot="tab-pill"
              className={cn(
                'grid h-7 w-12 place-items-center rounded-[14px]',
                lit && 'bg-surface-3 shadow-[inset_0_1px_0_var(--edge)]',
              )}
            >
              <Icon className="size-[22px]" strokeWidth={lit ? 2.3 : 2} aria-hidden="true" />
            </span>
            {tab.label}
          </Link>
        )
      })}
      {/* Always rendered, at this place of the tree: it owns the «/» key. */}
      <GlobalSearch />
    </nav>
  )
}
