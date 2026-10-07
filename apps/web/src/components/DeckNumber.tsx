import { cn } from '@/lib/utils'

/** True when the deck name already starts with its number («13. Hoopa ex …»), so «#13» would repeat it. */
export function nameStartsWithNumber(id: string, name: string): boolean {
  return /^\d+$/.test(id) && new RegExp(`^${id}(?:[.)\\s:-]|$)`).test(name.trim())
}

/**
 * «#13»: the deck number Claude uses («mazo 13»). It is the deck id; the 40 lists were imported in order, so it
 * matches mazos_40_listas.md, and new decks continue at 41, 42… (DECISIONES 3.4).
 */
export function DeckNumber({ id, name, className }: { id: string; name: string; className?: string }) {
  if (nameStartsWithNumber(id, name)) return null
  return (
    <span className={cn('shrink-0 font-mono text-muted-foreground tabular', className)} title={`Mazo ${id}`}>
      #{id}
    </span>
  )
}
