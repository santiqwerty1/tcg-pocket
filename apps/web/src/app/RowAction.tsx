/**
 * The main action of a screen, as the fixed row draws it (mock-up D, `.fr-action`), and the look of the row around it.
 * It is given what to say and what to do, already resolved: the shell resolves the route's action and what the page
 * declared (`FixedRow`), and the gallery «Piezas de la interfaz» draws each of its looks with invented data, beside
 * views that are only a picture of them. So it reads nothing of the frame, of the router's place or of the API.
 */
import { type LucideIcon, RefreshCwIcon } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

/**
 * The box of the fixed row, and of each drawing of it. The row is measured in pixels, as its height (`--row-h`), its
 * text and the room the page leaves for it are: in rem, a larger default font of the browser would grow what is
 * inside it, and not the row, until the views and the action no longer fit and the page scrolls sideways.
 */
export const ROW_BOX =
  'flex h-(--row-h) items-center gap-[6px] rounded-[20px] border border-input bg-row p-[5px] shadow-(--shadow-row)'
/** The views inside the row: they share what the action leaves, each 60 px at least. */
export const ROW_VIEWS = 'grid min-w-0 flex-1 auto-cols-[minmax(min-content,1fr)] grid-flow-col gap-[2px]'
/**
 * A view, wherever it goes. The display face is written here and not left to the stylesheet's `[role="tab"]`: a
 * drawing of the row in the gallery has no tabs, and has to be as wide as the row it shows.
 */
export const VIEW_TAB =
  'flex items-center justify-center px-[4px] font-heading text-[15px] leading-none font-semibold tracking-[0.01em] text-foreground-2 transition-colors duration-(--dur-2) select-none focus-visible:outline-2 focus-visible:outline-offset-2'
/** A view in the row, and the chosen one: a pill a little softer than the action, which stays the brightest thing. */
export const VIEW_TAB_IN_ROW = 'h-[48px] min-w-[60px] rounded-[15px]'
export const VIEW_CHOSEN_IN_ROW = 'bg-row-selected font-bold text-foreground shadow-[inset_0_0_0_1.5px_var(--input)]'

/**
 * In pixels too, as the row: in rem the «+» would be 72 × 72 with a default font of 24 px, out of its row of 60. Where
 * the system forces its colours it drops the fill, the only edge the action has: then it draws one, which the system
 * paints in its colour of text.
 */
const ACTION =
  'flex h-[48px] min-w-[48px] items-center justify-center gap-[8px] rounded-[15px] bg-primary font-heading text-[17px] leading-none font-bold tracking-[0.01em] whitespace-nowrap text-primary-foreground transition-transform duration-(--dur-1) select-none focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[.97] forced-colors:border-2'

/** What a screen reader hears while an action works, when nobody said anything better. */
export const PENDING = 'Un momento…'

/**
 * How the action takes its place: `full`, the whole row with its text (no views beside it); `text`, its text beside
 * the views («Sincronizar»); `icon`, its icon alone, 48 × 48, beside the views, named for a screen reader and for the
 * pointer.
 */
export type RowActionLayout = 'full' | 'text' | 'icon'

interface Shared {
  /** The visible text; with `icon`, the name. */
  label: string
  /** The accessible name, when it says more than the label (it starts with it). */
  name?: string
  icon?: LucideIcon
  layout: RowActionLayout
  /** On its way: a spinner in the icon's place, `aria-busy`, the pending text spoken, taps ignored. */
  pending?: boolean
  pendingLabel?: string
  disabled?: boolean
}

export type RowActionProps = Shared &
  (
    | { kind: 'link'; to: string }
    | {
        kind: 'button'
        /** Without it the button does nothing yet: it is drawn, and says it is not available (`aria-disabled`). */
        onSelect?: () => void
        /** It opens a dialog or a sheet. */
        opensDialog?: boolean
      }
  )

export function RowAction(props: RowActionProps) {
  const { label, name, icon: Icon, pending = false, pendingLabel, disabled = false } = props
  // Its icon alone only with an icon to show: without one, the text takes the place.
  const layout = props.layout === 'icon' && !Icon ? 'text' : props.layout
  const alone = layout === 'icon'
  const idle = disabled || (props.kind === 'button' && props.onSelect === undefined)
  const inert = pending || idle
  const glyph = alone ? 'size-[24px]' : 'size-[20px]'
  const named = alone ? { 'aria-label': name ?? label, title: name ?? label } : name ? { 'aria-label': name } : {}
  const shared = {
    'data-layout': layout,
    'aria-busy': pending || undefined,
    'aria-disabled': inert || undefined,
    ...named,
    className: cn(
      ACTION,
      // Beside the views the action takes only what it needs: its icon alone, or its icon and its text.
      alone ? 'w-[48px] flex-none' : layout === 'text' ? 'flex-none px-[16px]' : 'flex-1 px-[16px]',
      // What takes no tap does not answer to one either.
      inert && 'cursor-default active:scale-100',
      idle && !pending && 'opacity-50',
    ),
  }
  const content = (
    <>
      {pending ? (
        <RefreshCwIcon className={cn(glyph, 'animate-spin')} aria-hidden="true" />
      ) : Icon ? (
        <Icon className={glyph} aria-hidden="true" />
      ) : null}
      {alone ? null : label}
    </>
  )
  return (
    <>
      {props.kind === 'link' ? (
        <Link
          data-slot="row-action"
          to={props.to}
          {...shared}
          // A link that waits or does not apply does not go anywhere, with or without a modifier.
          onClick={inert ? (event) => event.preventDefault() : undefined}
        >
          {content}
        </Link>
      ) : (
        <button
          data-slot="row-action"
          type="button"
          {...shared}
          aria-haspopup={props.opensDialog ? 'dialog' : undefined}
          onClick={inert ? undefined : props.onSelect}
        >
          {content}
        </button>
      )}
      {/* Always there, so what it says when the action starts to work is announced: an empty region says nothing. */}
      <span role="status" className="sr-only">
        {pending ? (pendingLabel ?? PENDING) : ''}
      </span>
    </>
  )
}
