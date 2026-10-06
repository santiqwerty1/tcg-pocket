import { useParams } from 'react-router'
import { useCard } from '@/api/catalog'
import { usePageTitle } from '@/app/AppShell'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Thumb } from '@/components/Thumb'
import { CardFacts, CardRules, GroupDetailView } from './GroupDetailView'

export function CardPage() {
  const { cardId } = useParams()
  const query = useCard(cardId)
  usePageTitle(query.data?.card.nameEs)

  if (query.isPending) return <LoadingRows />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const { card, group } = query.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <Thumb src={card.imageUrl} alt="" className="h-[84px] w-[60px]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{card.nameEs}</h2>
          <div className="text-sm text-muted-foreground">
            {card.nameEn} · <code className="font-mono">{card.id}</code> · {card.expansionId} #{card.number}
          </div>
          <div className="mt-2">
            <CardFacts card={card} />
          </div>
        </div>
      </div>

      <Section title="Reglas">
        <CardRules card={card} />
      </Section>

      <GroupDetailView group={group} highlightCardId={card.id} />
    </div>
  )
}
