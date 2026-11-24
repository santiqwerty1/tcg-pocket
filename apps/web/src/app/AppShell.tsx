import { ChevronLeftIcon, SlidersHorizontalIcon } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, Outlet, ScrollRestoration, useLocation, useMatches, useNavigate, useNavigationType } from 'react-router'
import { useAlerts } from '@/api/alerts'
import { OfflineSync } from '@/components/OfflineSync'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { useLook } from '@/lib/look'
import { useOnline } from '@/lib/offlineMatches'
import { cn } from '@/lib/utils'
import { FixedRow, ViewTabs } from './FixedRow'
import { frameFor, isMenuPath } from './frame'
import { FrameMemory, scrollWhenTallEnough } from './frameMemory'
import { TabBar } from './TabBar'

export interface RouteHandle {
  title: string
  /**
   * The screen above this one: where «Volver» goes when it goes up. A route without it is a root (a tab's start or one
   * of its views) and its header has no «Volver».
   */
  back?: string
}

interface TitleContextValue {
  setTitle: (title: string | null) => void
}

const TitleContext = createContext<TitleContextValue>({ setTitle: () => {} })

/** The spot at the right of the header title where a page can put its own controls. */
const HeaderSlotContext = createContext<HTMLElement | null>(null)

/** The shell's memory, for a «Volver» asked from inside a page; null outside a shell (a page mounted on its own). */
const FrameMemoryContext = createContext<FrameMemory | null>(null)

/** Lets a page replace the static route title (e.g. with the deck name). */
export function usePageTitle(title: string | null | undefined): void {
  const { setTitle } = useContext(TitleContext)
  useEffect(() => {
    setTitle(title ?? null)
    return () => setTitle(null)
  }, [title, setTitle])
}

/** Renders `children` at the right of the header (e.g. the deck pager), while the page is mounted. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlotContext)
  return slot ? createPortal(children, slot) : null
}

function useRouteHandle(): RouteHandle | undefined {
  const matches = useMatches()
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle as RouteHandle | undefined
    if (handle?.title) return handle
  }
  return undefined
}

/**
 * True when the history has an entry of the app behind this one. react-router numbers its own entries (`idx`), so a
 * «Volver» on the first screen of a visit never leaves the app for whatever the browser tab showed before; without
 * that number (the memory router of the tests) the length of the history has to do.
 */
function hasAppEntryBehind(): boolean {
  const index: unknown = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof index === 'number' ? index > 0 : window.history.length > 1
}

/**
 * «Volver», the one rule for the header and for a page that leaves after saving.
 * - An entry opened by a tab's memory, or by a «Volver» that went up, has the wrong screen behind it (another tab, or
 *   the child just left): it goes UP to its parent, in the entry's place.
 * - Otherwise, with a screen of the app behind: back to it, as the phone's «atrás».
 * - Otherwise (a deep link): up to the parent; `replace` says whether in this entry's place.
 * Going up opens the parent as it was last seen (its query string and its scroll), and marks it: it was not reached
 * from its own parent either, so its «Volver» goes up again.
 */
export function useGoBack(): (options?: { replace?: boolean }) => void {
  const memory = useContext(FrameMemoryContext)
  const navigate = useNavigate()
  const { key } = useLocation()
  const parent = useRouteHandle()?.back ?? '/'
  return useCallback(
    (options) => {
      const up = (replace: boolean) => {
        const to = parent + (memory?.queryFor(parent) ?? '')
        memory?.planRestore(to)
        navigate(to, { replace, state: { tabReturn: true } })
      }
      if (memory?.isMarked(key)) up(true)
      else if (hasAppEntryBehind()) navigate(-1)
      else up(options?.replace ?? false)
    },
    [memory, navigate, key, parent],
  )
}

const MENU_NAME = 'Menú: aspecto, ajustes y sistema'

/** The way to the Menú, with the dot of the warnings that used to hang on the «Más» tab. */
function MenuLink() {
  const alerts = useAlerts()
  const warnings = (alerts.data ?? []).filter((alert) => alert.level === 'warning').length
  return (
    <Link
      to="/mas"
      aria-label={warnings > 0 ? `${MENU_NAME} · ${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}` : MENU_NAME}
      className="relative grid size-11 shrink-0 place-items-center rounded-lg text-foreground-2 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <SlidersHorizontalIcon className="size-[22px]" aria-hidden="true" />
      {warnings > 0 ? (
        <span
          className="absolute top-2 right-2 size-2.5 rounded-full bg-warning ring-2 ring-background"
          aria-hidden="true"
        />
      ) : null}
    </Link>
  )
}

/** The frame of mock-up D around every screen: the header, the page, and the fixed row and the tab bar at the bottom. */
export function AppShell({ children }: { children?: ReactNode }) {
  // One memory per shell, for as long as it is mounted: a reload forgets where the tabs were.
  const [memory] = useState(() => new FrameMemory())
  return (
    <FrameMemoryContext.Provider value={memory}>
      <Frame memory={memory}>{children}</Frame>
    </FrameMemoryContext.Provider>
  )
}

function Frame({ memory, children }: { memory: FrameMemory; children?: ReactNode }) {
  const handle = useRouteHandle()
  const location = useLocation()
  const navigationType = useNavigationType()
  const matches = useMatches()
  const goBack = useGoBack()
  const look = useLook()
  const online = useOnline()
  const [override, setOverride] = useState<string | null>(null)
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  const header = useRef<HTMLElement>(null)
  const main = useRef<HTMLElement>(null)
  const setTitle = useCallback((title: string | null) => setOverride(title), [])
  const value = useMemo(() => ({ setTitle }), [setTitle])
  const title = override ?? handle?.title ?? 'TCG Pocket'

  const frame = frameFor(location.pathname)
  const inner = handle?.back !== undefined
  const viewsOnTop = frame.views !== null && look.views === 'top'
  const rowViews = viewsOnTop ? null : frame.views
  const hasRow = rowViews !== null || frame.action !== null
  // An address no route declares (the `*` route) is not a place a tab returns to.
  const known = !('*' in (matches[matches.length - 1]?.params ?? {}))

  useEffect(() => {
    document.title = title === 'TCG Pocket' ? title : `${title} · TCG Pocket`
  }, [title])

  // A layout effect of the shell itself: it runs after <ScrollRestoration />'s (its child) in the same commit, so the
  // memory takes the scroll the router has just applied, and a scroll a tab asked to put back is applied over it.
  useLayoutEffect(() => {
    const y = memory.arrive(location, { replaced: navigationType === 'REPLACE', known, scrollY: window.scrollY })
    if (y === null) return
    memory.restoring = true
    return scrollWhenTallEnough(y, () => {
      memory.restoring = false
    })
  }, [memory, location, navigationType, known])

  useEffect(() => {
    const onScroll = () => memory.scrolled(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [memory])

  // The header grows with the views «arriba» and with the offline line: the page's scroll padding follows its real
  // height. Nothing is written where there is no layout (the tests).
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are what changes the header's height.
  useLayoutEffect(() => {
    const height = header.current?.offsetHeight ?? 0
    if (height > 0) document.documentElement.style.setProperty('--header-now', `${height}px`)
  }, [location.pathname, look.views, online])
  useEffect(() => () => void document.documentElement.style.removeProperty('--header-now'), [])

  return (
    <TitleContext.Provider value={value}>
      <HeaderSlotContext.Provider value={headerSlot}>
        {/* It only moves the focus: the click is prevented, so the address never takes «#principal». */}
        <Link
          to="#principal"
          onClick={(event) => {
            event.preventDefault()
            main.current?.focus()
          }}
          className="fixed top-2 left-2 z-100 flex min-h-11 -translate-y-[200%] items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground focus:translate-y-0"
        >
          Saltar al contenido
        </Link>
        {/* One header for a root and for an inner screen: the same element with the same children in the same order,
            so no navigation remounts what lives in it (`OfflineSync` is also the sender of the matches that wait). */}
        <header ref={header} className="sticky top-0 z-20 bg-background">
          <div className={cn('flex min-h-(--header-h) items-center gap-0.5', inner ? 'p-1' : 'py-1 pr-1 pl-4')}>
            {inner ? (
              <Button variant="ghost" size="icon" aria-label="Volver" onClick={() => goBack()}>
                <ChevronLeftIcon className="size-6" />
              </Button>
            ) : null}
            <h1
              className={cn(
                'min-w-0 flex-1 truncate',
                inner ? 'text-lg font-semibold' : 'text-2xl leading-[1.2] font-bold tracking-[0.01em]',
              )}
            >
              {title}
            </h1>
            <div ref={setHeaderSlot} className="flex shrink-0 items-center empty:hidden" />
            {/* On every screen but the Menú and its pages: the deck's own «⋯» will take it over on the inner ones. */}
            {isMenuPath(location.pathname) ? null : <MenuLink />}
          </div>
          {viewsOnTop && frame.views ? (
            <div className="px-3 pt-0.5 pb-2 shadow-[0_1px_0_var(--border)]">
              <ViewTabs views={frame.views} label={frame.viewsLabel ?? 'Vistas'} place="top" />
            </div>
          ) : null}
          <OfflineSync />
        </header>
        {/* `isolate`: whatever z-index a page uses stays under the header and the bottom zone. */}
        <main
          ref={main}
          id="principal"
          tabIndex={-1}
          className={cn(
            'isolate px-4 pt-1.5 outline-none',
            hasRow
              ? 'pb-[calc(var(--bar-h)+var(--row-h)+54px+env(safe-area-inset-bottom))]'
              : 'pb-[calc(var(--bar-h)+26px+env(safe-area-inset-bottom))]',
          )}
        >
          {children ?? <Outlet />}
        </main>
        {/* After <main>, so the focus goes header, page, row, tabs. It takes no taps outside its two children. */}
        <div
          data-slot="bottom-zone"
          data-row={hasRow ? '' : undefined}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-(--frame)"
        >
          <FixedRow views={rowViews} viewsLabel={frame.viewsLabel} action={frame.action} />
          <TabBar memory={memory} />
        </div>
        <Toaster />
        {/* Back returns to where the list was; a new screen opens at the top (Fase 41). */}
        <ScrollRestoration />
      </HeaderSlotContext.Provider>
    </TitleContext.Provider>
  )
}
