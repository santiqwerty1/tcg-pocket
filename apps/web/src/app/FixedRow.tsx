/**
 * The fixed row of mock-up D, one line above the tab bar: the views of the screen on the left and its main action on
 * the right. The shell decides what goes in it (`frameFor`, what the page declared and the look of this device); with
 * the views «arriba» the same tablist is drawn under the header instead.
 */
import { type KeyboardEvent, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { cn } from '@/lib/utils'
import { type FrameAction, type FrameView, isPlainClick, normalizePath } from './frame'
import type { PageActionState } from './pageAction'
import {
  ROW_BOX,
  ROW_VIEWS,
  RowAction,
  type RowActionLayout,
  type RowActionProps,
  VIEW_CHOSEN_IN_ROW,
  VIEW_TAB,
  VIEW_TAB_IN_ROW,
} from './RowAction'

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
          ? ROW_VIEWS
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
              place === 'row' ? VIEW_TAB_IN_ROW : 'h-11 rounded-[14px]',
              selected && (place === 'row' ? VIEW_CHOSEN_IN_ROW : 'bg-primary font-bold text-primary-foreground'),
            )}
          >
            {view.label}
          </Link>
        )
      })}
    </div>
  )
}

/**
 * The route's action with what the page declared over it: the page's label, name and pending text win, and a button
 * takes the page's handler (without one it is drawn and does nothing). Beside the views it is its icon alone, unless
 * the route keeps its text; alone in the row, its text.
 */
export function rowActionProps(
  action: FrameAction,
  page: PageActionState | null,
  besideViews: boolean,
): RowActionProps {
  const { spec, params } = action
  const layout: RowActionLayout = !besideViews ? 'full' : spec.display === 'text' ? 'text' : 'icon'
  const shared = {
    label: page?.label ?? spec.label,
    // A page that writes its own label and no name drops the route's name: the name must hold the words on screen
    // (WCAG 2.5.3), and the route's longer one was written for the route's label.
    name: page?.ariaLabel ?? (page?.label === undefined ? spec.ariaLabel : undefined),
    icon: spec.icon,
    layout,
    pending: page?.pending ?? false,
    pendingLabel: page?.pendingLabel ?? spec.pendingLabel,
    disabled: page?.disabled ?? false,
  }
  return spec.kind === 'link'
    ? { ...shared, kind: 'link', to: spec.to(params) }
    : { ...shared, kind: 'button', onSelect: page?.onSelect, opensDialog: spec.opens === 'dialog' }
}

/**
 * Views and an action: the views and the action beside them. Only an action: the action, full width. Neither: no
 * row. The action comes as the shell leaves it: one the page hid is not given.
 */
export function FixedRow({
  views,
  viewsLabel,
  action,
  page = null,
}: {
  views: readonly FrameView[] | null
  viewsLabel: string | null
  action: FrameAction | null
  page?: PageActionState | null
}) {
  if (!views && !action) return null
  return (
    <div data-slot="fixed-row" className={cn('pointer-events-auto mx-[12px] mb-[8px]', ROW_BOX)}>
      {views ? <ViewTabs views={views} label={viewsLabel ?? 'Vistas'} place="row" /> : null}
      {action ? <RowAction {...rowActionProps(action, page, views !== null)} /> : null}
    </div>
  )
}
