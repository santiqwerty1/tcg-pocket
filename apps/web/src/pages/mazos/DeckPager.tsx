/**
 * ← → between decks (pedido del 8/10/2026): steps through the list the deck was opened from, with its filters, from
 * the header and with the keyboard arrows. Each step replaces the history entry, so «Volver» still goes to the list.
 */
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { deckDetailQuery, useDecks } from '@/api/decks'
import type { DeckSummary } from '@/api/schemas'
import { HeaderActions } from '@/app/AppShell'
import { Button } from '@/components/ui/button'
import { deckListSearch, deckNeighbors, deckPath, filterDecks, readDeckListFilters } from './deckList'

/** Where the arrow keys already mean something: text fields, menus, tabs, selects, sliders, dialogs. */
const ARROW_KEY_OWNERS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  '[role="slider"]',
].join(', ')

function arrowKeysTaken(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(ARROW_KEY_OWNERS)) return true
  // An open menu or sheet keeps the arrows even if focus slipped to the page behind it.
  return document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null
}

function deckLabel(deck: DeckSummary): string {
  return `#${deck.id} ${deck.name}`
}

export function DeckPager({ deckId }: { deckId: string }) {
  const [params] = useSearchParams()
  const filters = useMemo(() => readDeckListFilters(params), [params])
  const search = deckListSearch(filters)
  const decks = useDecks({ archived: filters.archived })
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const neighbors = useMemo(
    () => (decks.data ? deckNeighbors(filterDecks(decks.data, filters), deckId) : null),
    [decks.data, filters, deckId],
  )
  const prev = neighbors?.prev ?? null
  const next = neighbors?.next ?? null

  useEffect(() => {
    for (const deck of [prev, next]) if (deck) void queryClient.prefetchQuery(deckDetailQuery(deck.id))
  }, [prev, next, queryClient])

  const go = useCallback(
    (deck: DeckSummary) => {
      window.scrollTo({ top: 0 })
      navigate(deckPath(deck.id, search), { replace: true })
    },
    [navigate, search],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      // Alt+← is the browser's «back»; the other modifiers select or jump text.
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (arrowKeysTaken(event.target)) return
      const deck = event.key === 'ArrowLeft' ? prev : next
      if (!deck) return
      event.preventDefault()
      go(deck)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [prev, next, go])

  if (!neighbors || (!prev && !next)) return null
  const where = [filters.archived && 'archivados', filters.onlyBuilt && 'en el juego', filters.tag && `#${filters.tag}`]
    .filter(Boolean)
    .join(', ')

  return (
    <HeaderActions>
      <nav aria-label="Otros mazos" className="flex items-center">
        <PagerButton deck={prev} search={search} direction="prev" />
        {neighbors.position !== null ? (
          <span
            className="px-0.5 text-xs text-muted-foreground tabular"
            title={`Mazo ${neighbors.position} de ${neighbors.total}${where ? ` (${where})` : ''}`}
          >
            {neighbors.position}/{neighbors.total}
          </span>
        ) : null}
        <PagerButton deck={next} search={search} direction="next" />
      </nav>
    </HeaderActions>
  )
}

function PagerButton({
  deck,
  search,
  direction,
}: {
  deck: DeckSummary | null
  search: string
  direction: 'prev' | 'next'
}) {
  const Icon = direction === 'prev' ? ArrowLeftIcon : ArrowRightIcon
  const what = direction === 'prev' ? 'Mazo anterior' : 'Mazo siguiente'
  if (!deck) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label={`${what}: no hay`}>
        <Icon className="size-5" />
      </Button>
    )
  }
  const label = `${what}: ${deckLabel(deck)}`
  return (
    <Button variant="ghost" size="icon" asChild>
      <Link
        to={deckPath(deck.id, search)}
        replace
        onClick={() => window.scrollTo({ top: 0 })}
        aria-label={label}
        title={`${label} (${direction === 'prev' ? '←' : '→'})`}
      >
        <Icon className="size-5" />
      </Link>
    </Button>
  )
}
