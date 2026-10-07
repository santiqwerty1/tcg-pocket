/**
 * «Mejores versiones» (pedido del 7/10/2026): for each functional card of the deck, the rarer or holographic prints
 * the user owns of that same card, to pick when building it in the game. One tap rewrites the list with them as a
 * new revision (restorable from «Revisiones»).
 */
import { SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useUpdateDeck } from '@/api/decks'
import type { DeckDetail } from '@/api/schemas'
import { Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function BestVersionsSection({ deck }: { deck: DeckDetail }) {
  const update = useUpdateDeck()
  const best = deck.bestVersions
  if (!best) return null

  async function apply() {
    if (!best) return
    try {
      const updated = await update.mutateAsync({
        id: deck.id,
        patch: { cards: best.cards, note: 'Mejores versiones de la colección' },
      })
      toast.success(
        `Listo: revisión ${updated.revisionNumber} con las mejores versiones (se puede restaurar la anterior)`,
      )
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Section
      title="Mejores versiones"
      action={
        best.changed ? (
          <Button size="sm" variant="outline" onClick={apply} disabled={update.isPending}>
            {update.isPending ? <Spinner /> : <SparklesIcon data-icon="inline-start" />}
            Usar en la lista
          </Button>
        ) : null
      }
    >
      {best.changed ? (
        <>
          <p className="text-sm text-muted-foreground">
            Al armarlo en el juego, de estas cartas tenés versiones más raras u holográficas. Es la misma carta: el mazo
            juega igual.
          </p>
          <ul className="divide-y rounded-lg border">
            {best.groups.map((group) => (
              <li key={group.groupId} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{group.nameEs}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    en la lista: {group.current.map((entry) => `${entry.count}× ${entry.cardId}`).join(', ')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.recommended.map((pick) => (
                    <Badge key={pick.cardId} variant="secondary" className="h-auto py-0.5 font-normal">
                      <span className="font-mono">
                        {pick.count}× {pick.cardId}
                      </span>
                      <span>{pick.rarity === 'P' ? 'promo' : pick.rarity}</span>
                      {pick.holo ? <span className="text-primary">holográfica</span> : null}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          La lista ya usa la mejor versión que tenés de cada carta (rareza más alta u holográfica).
        </p>
      )}
    </Section>
  )
}
