import { useParams } from 'react-router'
import { useCard, useGroup } from '@/api/catalog'
import { usePageTitle } from '@/app/AppShell'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Thumb } from '@/components/Thumb'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CardFacts, CardRules, GroupDetailView } from './GroupDetailView'

export function GroupPage() {
  const { groupId } = useParams()
  const group = useGroup(groupId)
  // The rules text lives on the editions; the display edition speaks for the group.
  const display = useCard(group.data?.displayCardId)
  usePageTitle(group.data?.nameEs)

  if (group.isPending) return <LoadingRows />
  if (group.isError) return <ErrorState error={group.error} onRetry={() => group.refetch()} />
  const data = group.data

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <Thumb src={display.data?.card.imageUrl} alt="" className="h-[84px] w-[60px]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{data.nameEs}</h2>
          <div className="text-sm text-muted-foreground">
            {data.nameEn} · <code className="font-mono">{data.id}</code> ·{' '}
            {data.editionCount === 1 ? '1 edición' : `${data.editionCount} ediciones`}
          </div>
          <div className="mt-2">
            {display.data ? (
              <CardFacts card={display.data.card} />
            ) : (
              <Badge variant="outline">{data.cardType === 'pokemon' ? 'Pokémon' : 'Entrenador'}</Badge>
            )}
          </div>
        </div>
      </div>

      <Section title="Reglas">
        {display.data ? <CardRules card={display.data.card} /> : <Skeleton className="h-24" />}
      </Section>

      <GroupDetailView group={data} />
    </div>
  )
}
