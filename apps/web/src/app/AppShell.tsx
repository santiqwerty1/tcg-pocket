import { ChevronLeftIcon } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Outlet, useMatches, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { BottomNav } from './BottomNav'

export interface RouteHandle {
  title: string
  /** Where the back button goes when there is no history (deep links from the home screen). */
  back?: string
}

interface TitleContextValue {
  setTitle: (title: string | null) => void
}

const TitleContext = createContext<TitleContextValue>({ setTitle: () => {} })

/** Lets a page replace the static route title (e.g. with the deck name). */
export function usePageTitle(title: string | null | undefined): void {
  const { setTitle } = useContext(TitleContext)
  useEffect(() => {
    setTitle(title ?? null)
    return () => setTitle(null)
  }, [title, setTitle])
}

function useRouteHandle(): RouteHandle | undefined {
  const matches = useMatches()
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle as RouteHandle | undefined
    if (handle?.title) return handle
  }
  return undefined
}

export function AppShell({ children }: { children?: ReactNode }) {
  const handle = useRouteHandle()
  const navigate = useNavigate()
  const [override, setOverride] = useState<string | null>(null)
  const setTitle = useCallback((title: string | null) => setOverride(title), [])
  const value = useMemo(() => ({ setTitle }), [setTitle])
  const title = override ?? handle?.title ?? 'TCG Pocket'

  useEffect(() => {
    document.title = title === 'TCG Pocket' ? title : `${title} · TCG Pocket`
  }, [title])

  function goBack() {
    if (window.history.length > 1) navigate(-1)
    else navigate(handle?.back ?? '/')
  }

  return (
    <TitleContext.Provider value={value}>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-2">
          {handle?.back !== undefined ? (
            <Button variant="ghost" size="icon" aria-label="Volver" onClick={goBack}>
              <ChevronLeftIcon className="size-6" />
            </Button>
          ) : (
            <span className="w-2" />
          )}
          <h1 className="truncate text-lg font-semibold">{title}</h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pt-4 pb-28">{children ?? <Outlet />}</main>
      <BottomNav />
      <Toaster />
    </TitleContext.Provider>
  )
}
