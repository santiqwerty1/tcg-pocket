/**
 * The half of the fixed row's action that only the page knows. The route says what the action is and where it goes
 * (`ROW_ACTIONS` in `frame.ts`), so the row and the room the page leaves for it are known before the page mounts; the
 * page adds what depends on it: the handler of a button, a request on its way, an action that does not apply (an
 * archived deck), a label from its data. What the page declares wins over the route's.
 *
 * A declaration lives as long as the page that made it, and on its path: it is dropped when the page unmounts, and
 * never reaches the next screen.
 */
import { createContext, type ReactNode, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

export interface PageActionState {
  /** A button's handler. Until the page gives one, the button is drawn and does nothing (`aria-disabled`). */
  onSelect?: () => void
  /** A request on its way: a spinner in the icon's place, `aria-busy`, the pending text spoken, taps ignored. */
  pending?: boolean
  /** What a screen reader hears while it is pending, when the page can say it better than the route. */
  pendingLabel?: string
  disabled?: boolean
  /** The action does not apply here (an archived deck): no action, and the room for it is not kept either. */
  hidden?: boolean
  /** From loaded data: «Actualizar el mazo #1». */
  label?: string
  ariaLabel?: string
}

type Declare = (owner: string, declared: { path: string; state: PageActionState } | null) => void

const PageActionContext = createContext<Declare | null>(null)

/**
 * The shell's side: holds what the page on screen declared and gives it back for the path at hand only, so a
 * declaration that has not been dropped yet is never applied to another screen.
 */
export function usePageActionHost(pathname: string): { declared: PageActionState | null; declare: Declare } {
  const [held, setHeld] = useState<{ owner: string; path: string; state: PageActionState } | null>(null)
  const declare = useCallback<Declare>((owner, declared) => {
    setHeld((current) => {
      if (declared) return { owner, ...declared }
      // Only its own: a page that leaves after the next one declared does not take that one away.
      return current?.owner === owner ? null : current
    })
  }, [])
  return { declared: held && held.path === pathname ? held.state : null, declare }
}

/** Where the pages of a shell declare their action. */
export function PageActionScope({ declare, children }: { declare: Declare; children: ReactNode }) {
  return <PageActionContext.Provider value={declare}>{children}</PageActionContext.Provider>
}

/**
 * Declares what the page knows of the fixed row's action; `null` declares nothing (the route's action as it is).
 * The handler is read when the action is used: a new function on every render does not declare again.
 */
export function usePageAction(state: PageActionState | null): void {
  const declare = useContext(PageActionContext)
  const owner = useId()
  const { pathname } = useLocation()
  const handler = useRef(state?.onSelect)
  useLayoutEffect(() => {
    handler.current = state?.onSelect
  })
  const declared = state !== null
  const handled = state?.onSelect !== undefined
  const { pending, pendingLabel, disabled, hidden, label, ariaLabel } = state ?? {}
  // A layout effect: the row takes the declaration before the screen is painted, so it never shows the route's
  // action for a frame and then changes.
  useLayoutEffect(() => {
    if (!declare) return
    if (!declared) {
      declare(owner, null)
      return
    }
    declare(owner, {
      path: pathname,
      state: {
        ...(handled ? { onSelect: () => handler.current?.() } : {}),
        pending,
        pendingLabel,
        disabled,
        hidden,
        label,
        ariaLabel,
      },
    })
  }, [declare, owner, pathname, declared, handled, pending, pendingLabel, disabled, hidden, label, ariaLabel])
  useLayoutEffect(() => () => declare?.(owner, null), [declare, owner])
}
