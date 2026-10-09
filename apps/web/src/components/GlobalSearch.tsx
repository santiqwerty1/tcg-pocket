/**
 * Buscador único (Fase 27): the magnifier in the header (or «/» on a keyboard) opens one box for cards, decks,
 * tournament archetypes, your matches, notes by rival and events. Enter opens the first result.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { SearchIcon } from 'lucide-react'
import { type KeyboardEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { request } from '@/api/client'
import { cardSearchHitSchema, isoDate } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/format'
import { RESULT_LABEL } from '@/lib/matches'
import { useDebouncedValue } from '@/lib/useDebounce'

const searchSchema = z.object({
  q: z.string(),
  cards: z.array(cardSearchHitSchema),
  decks: z.array(z.object({ id: z.string(), name: z.string(), archived: z.boolean() })),
  archetypes: z.array(z.object({ id: z.string(), name: z.string() })),
  matches: z.array(
    z.object({
      id: z.string(),
      deck: z.string(),
      opponent: z.string().nullable(),
      result: z.enum(['win', 'loss', 'tie']),
      playedAt: isoDate,
      note: z.string(),
    }),
  ),
  notes: z.array(
    z.object({ key: z.string(), label: z.string(), archetypeId: z.string().nullable(), text: z.string() }),
  ),
  events: z.array(z.object({ id: z.string(), name: z.string() })),
})
type SearchResult = z.infer<typeof searchSchema>

interface Hit {
  key: string
  label: string
  detail?: string | undefined
  to: string
}

function groupsOf(data: SearchResult): { title: string; hits: Hit[] }[] {
  return [
    {
      title: 'Cartas',
      hits: data.cards.map((hit) => ({
        key: `card-${hit.card.id}`,
        label: hit.card.nameEs,
        detail: `${hit.card.id}${hit.card.nameEn !== hit.card.nameEs ? ` · ${hit.card.nameEn}` : ''}`,
        to: `/cartas/${encodeURIComponent(hit.card.id)}`,
      })),
    },
    {
      title: 'Mazos',
      hits: data.decks.map((deck) => ({
        key: `deck-${deck.id}`,
        label: deck.name,
        detail: deck.archived ? 'archivado' : undefined,
        to: `/mazos/${deck.id}`,
      })),
    },
    {
      title: 'Arquetipos',
      hits: data.archetypes.map((archetype) => ({
        key: `archetype-${archetype.id}`,
        label: archetype.name,
        to: `/torneos/arquetipos/${encodeURIComponent(archetype.id)}`,
      })),
    },
    {
      title: 'Partidas',
      hits: data.matches.map((match) => ({
        key: `match-${match.id}`,
        label: `${RESULT_LABEL[match.result]} con ${match.deck}${match.opponent ? ` contra ${match.opponent}` : ''}`,
        detail: [formatDate(match.playedAt), match.note].filter(Boolean).join(' · '),
        to: `/partidas/${match.id}`,
      })),
    },
    {
      title: 'Notas por rival',
      hits: data.notes.map((note) => ({
        key: `note-${note.key}`,
        label: note.label,
        detail: note.text,
        to: note.archetypeId ? `/torneos/arquetipos/${encodeURIComponent(note.archetypeId)}` : '/mas/notas',
      })),
    },
    {
      title: 'Eventos',
      hits: data.events.map((event) => ({ key: `event-${event.id}`, label: event.name, to: `/eventos/${event.id}` })),
    },
  ].filter((group) => group.hits.length > 0)
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const q = useDebouncedValue(text.trim(), 250)
  const search = useQuery({
    queryKey: ['search', q] as const,
    queryFn: ({ signal }) => request('/api/search', { query: { q }, schema: searchSchema, signal }),
    enabled: open && q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const groups = search.data && q.length >= 2 ? groupsOf(search.data) : []
  const first = groups[0]?.hits[0]

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (target?.isContentEditable) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(to: string) {
    setOpen(false)
    setText('')
    navigate(to)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && first) {
      event.preventDefault()
      go(first.to)
    }
  }

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Buscar" onClick={() => setOpen(true)}>
        <SearchIcon className="size-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-4 max-h-[85vh] translate-y-0 overflow-y-auto sm:top-12">
          <DialogHeader>
            <DialogTitle>Buscar</DialogTitle>
            <DialogDescription>Cartas, mazos, arquetipos, partidas, notas y eventos.</DialogDescription>
          </DialogHeader>
          <Input
            type="search"
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Escribí un nombre (sin importar tildes)"
            aria-label="Buscar en toda la app"
          />
          {q.length >= 2 && search.data && groups.length === 0 && !search.isFetching ? (
            <p className="text-sm text-muted-foreground">Nada con «{q}».</p>
          ) : null}
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <section key={group.title} className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-muted-foreground">{group.title}</h3>
                <ul className="flex flex-col">
                  {group.hits.map((hit) => (
                    <li key={hit.key}>
                      <button
                        type="button"
                        onClick={() => go(hit.to)}
                        className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      >
                        <span className="text-sm">{hit.label}</span>
                        {hit.detail ? (
                          <span className="truncate text-xs text-muted-foreground">{hit.detail}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
