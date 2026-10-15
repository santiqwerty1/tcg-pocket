/**
 * «Cartas que vi» (pedido de Santi del 14/10): the rival's cards seen in a match, picked by name with one or two copies,
 * and the era's archetypes they suggest. Collapsed until asked for, so the quick entry still takes four taps.
 */
import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { useRivalSuggestions } from '@/api/matches'
import type { SeenCard } from '@/api/schemas'
import { CardSearch } from '@/components/CardSearch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The cards seen as the API takes them. */
export function seenCardsBody(cards: readonly SeenCard[]): { cardId: string; count: number }[] {
  return cards.map(({ cardId, count }) => ({ cardId, count }))
}

export function SeenCardsField({
  value,
  onChange,
  opponent,
  onPickRival,
}: {
  value: SeenCard[]
  onChange: (cards: SeenCard[]) => void
  /** The rival typed: with one, no archetype is suggested. */
  opponent: string
  onPickRival: (name: string) => void
}) {
  const [open, setOpen] = useState(value.length > 0)
  const suggestions = useRivalSuggestions(opponent.trim() === '' ? value : [])
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Cartas que vi
      </Button>
    )
  }
  // Only the suggestions of these very cards (Codex on #114).
  const found = suggestions.isSuccess && !suggestions.isPlaceholderData ? suggestions.data.suggestions.slice(0, 3) : []
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-muted-foreground">Cartas que vi del rival</legend>
      {value.length < 20 ? (
        <CardSearch
          placeholder="Agregar una carta que viste…"
          limit={6}
          onPick={(hit) => {
            if (value.some((card) => card.nameEs === hit.card.nameEs)) return
            onChange([...value, { cardId: hit.card.id, count: 1, nameEs: hit.card.nameEs }])
          }}
        />
      ) : null}
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((card) => (
            <li key={card.cardId} className="flex items-center gap-0.5 rounded-md border pl-2 text-sm">
              <span className="max-w-40 truncate">{card.nameEs}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${card.nameEs}: ${card.count === 1 ? 'una copia' : 'dos copias'} (tocá para cambiar)`}
                className="tabular"
                onClick={() =>
                  onChange(value.map((item) => (item === card ? { ...item, count: item.count === 1 ? 2 : 1 } : item)))
                }
              >
                ×{card.count}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Quitar ${card.nameEs}`}
                onClick={() => onChange(value.filter((item) => item !== card))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {opponent.trim() === '' && value.length > 0 ? (
        found.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              {found[0]?.kind === 'fits' ? '¿Era alguno de estos?' : 'Ningún arquetipo de la era encaja del todo:'}
            </p>
            <ul className="flex flex-col gap-1">
              {found.map((fit) => (
                <li key={fit.archetypeId}>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn('h-auto w-full flex-col items-start gap-0 py-1.5 text-left whitespace-normal')}
                    onClick={() => onPickRival(fit.name)}
                  >
                    <span className="font-medium">{fit.name}</span>
                    <span className="text-xs text-muted-foreground">{fit.text}</span>
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Si no es ninguno, dejá el rival vacío: la partida queda «sin clasificar» con sus cartas y la clasificás
              después (Hoy → Clasificar rivales).
            </p>
          </div>
        ) : suggestions.isSuccess ? (
          <p className="text-xs text-muted-foreground">
            Ninguna lista de la era juega esas cartas: queda «sin clasificar» y la clasificás después.
          </p>
        ) : null
      ) : null}
    </fieldset>
  )
}
