/**
 * The fixed row of mock-up D, one line above the tab bar: the views of the screen on the left and its main action on
 * the right. The shell decides what goes in it (`frameFor` and the look of this device); with the views «arriba» the
 * same tablist is drawn under the header instead.
 */
import { type KeyboardEvent, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { cn } from '@/lib/utils'
import { type FrameAction, type FrameView, isPlainClick, normalizePath } from './frame'

const VIEW_TAB =
  'flex items-center justify-center px-1 text-[15px] leading-none font-semibold tracking-[0.01em] text-foreground-2 transition-colors duration-(--dur-2) select-none focus-visible:outline-2 focus-visible:outline-offset-2'

/** Where ← → Home End lead from the tab at `at`, going round; null for any other key. */
function stepTo(key: string, at: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (at + 1) % count
    case 'ArrowLeft':
      return (at - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The views of a screen as tabs. They are links (each view is a URL of its own) that replace the history entry: a
 * view is not a step back. The selected one does not navigate, so its filters (the query string) and its scroll stay.
 */
export function ViewTabs({
  views,
  label,
  place,
}: {
  views: readonly FrameView[]
  label: string
  place: 'row' | 'top'
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const links = useRef<(HTMLAnchorElement | null)[]>([])
  const current = normalizePath(location.pathname)

  function open(view: FrameView) {
    if (view.path !== current) navigate(view.path, { replace: true })
  }

  function onKeyDown(event: KeyboardEvent<HTMLAnchorElement>, at: number) {
    // With a modifier the key is the browser's (Alt + ← is «atrás»).
    if (event.altKey || event.ctrlKey || event.metaKey) return
    // An anchor does not click on Space, a tab does.
    if (event.key === ' ') {
      event.preventDefault()
      const view = views[at]
      if (view) open(view)
      return
    }
    const target = stepTo(event.key, at, views.length)
    const view = target === null ? undefined : views[target]
    if (target === null || !view) return
    event.preventDefault()
    open(view)
    // The links belong to the shell and are not remounted: the focus stays on the chosen tab while its screen loads.
    links.current[target]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={
        place === 'row'
          ? 'grid min-w-0 flex-1 auto-cols-[minmax(min-content,1fr)] grid-flow-col gap-0.5'
          : 'grid auto-cols-fr grid-flow-col gap-0.5 rounded-[17px] border border-input bg-row p-[3px]'
      }
    >
      {views.map((view, at) => {
        const selected = view.path === current
        return (
          <Link
            key={view.path}
            ref={(element) => {
              links.current[at] = element
            }}
            role="tab"
            id={`vista-${view.path.slice(1)}`}
            aria-selected={selected}
            aria-controls="principal"
            tabIndex={selected ? 0 : -1}
            to={selected ? { pathname: location.pathname, search: location.search } : view.path}
            replace
            onClick={(event) => {
              // A plain click only: with a modifier the view still opens in another window.
              if (selected && isPlainClick(event)) event.preventDefault()
            }}
            // The key is computed from the tab that has the focus, not from the selected one: a screen that is still
            // loading has not moved the selection yet.
            onKeyDown={(event) => onKeyDown(event, at)}
            className={cn(
              VIEW_TAB,
              place === 'row' ? 'h-12 min-w-[60px] rounded-[15px]' : 'h-11 rounded-[14px]',
              selected &&
                (place === 'row'
                  ? 'bg-row-selected font-bold text-foreground shadow-[inset_0_0_0_1.5px_var(--input)]'
                  : 'bg-primary font-bold text-primary-foreground'),
            )}
          >
            {view.label}
          </Link>
        )
      })}
    </div>
  )
}

function RowAction({ action, iconOnly }: { action: FrameAction; iconOnly: boolean }) {
  const Icon = action.icon
  return (
    <Link
      to={action.to}
      {...(iconOnly ? { 'aria-label': action.label, title: action.label } : {})}
      className={cn(
        'flex h-12 min-w-12 items-center justify-center gap-2 rounded-[15px] bg-primary font-heading text-[17px] leading-none font-bold tracking-[0.01em] whitespace-nowrap text-primary-foreground transition-transform duration-(--dur-1) select-none focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[.97]',
        // Next to the views the action takes only what it needs: its icon alone, 48 × 48.
        iconOnly ? 'w-12 flex-none' : 'flex-1 px-4',
      )}
    >
      <Icon className={iconOnly ? 'size-6' : 'size-5'} aria-hidden="true" />
      {iconOnly ? null : action.label}
    </Link>
  )
}

/** Views and an action: the views and the action as an icon. Only an action: the action, full width. Neither: no row. */
export function FixedRow({
  views,
  viewsLabel,
  action,
}: {
  views: readonly FrameView[] | null
  viewsLabel: string | null
  action: FrameAction | null
}) {
  if (!views && !action) return null
  return (
    <div
      data-slot="fixed-row"
      className="pointer-events-auto mx-3 mb-2 flex h-(--row-h) items-center gap-1.5 rounded-[20px] border border-input bg-row p-[5px] shadow-(--shadow-row)"
    >
      {views ? <ViewTabs views={views} label={viewsLabel ?? 'Vistas'} place="row" /> : null}
      {action ? <RowAction action={action} iconOnly={views !== null} /> : null}
    </div>
  )
}
