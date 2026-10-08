/**
 * One archetype of the era (BRIEF M5): its record against the era mean, the cards its lists play, «con y sin» a card
 * (two rows with their own n and interval, never a difference as one number) and its most played exact lists. The
 * owner can fold another Limitless archetype into this one (their slugs change).
 */
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useArchetype, useArchetypes, useSetArchetypeAlias } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RateHeadline, RateRows } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatRateValue } from '@/lib/matches'
import { cardLabels, formatCount, formatShare, scopeFromSearch, scopeSearch } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

export function ArchetypePage() {
  const { id = '' } = useParams()
  const [search] = useSearchParams()
  const scope = scopeFromSearch(search)
  const [card, setCard] = useState<string | null>(null)
  const [minCount, setMinCount] = useState(1)
  const detail = useArchetype(id, scope, card, minCount)
  const all = useArchetypes(scope)
  const setAlias = useSetArchetypeAlias()
  const query = scopeSearch(scope)

  async function alias(archetypeId: string, canonicalId: string | null) {
    try {
      await setAlias.mutateAsync({ id: archetypeId, canonicalId })
      toast.success(canonicalId ? 'Arquetipos fusionados.' : 'Arquetipo separado.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (detail.isPending) return <LoadingRows />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
  const { archetype, scope: info, withWithout } = detail.data
  const total = archetype.lists
  const labels = cardLabels(detail.data.cards)
  const label = (groupId: string | null, nameEs: string) => (groupId ? labels.get(groupId) : undefined) ?? nameEs
  const others = (all.data?.rows ?? []).filter((row) => row.archetype.id && row.archetype.id !== archetype.archetype.id)

  return (
    <div className="flex flex-col gap-5">
      <Section title={archetype.archetype.name}>
        <RateHeadline
          label="Récord del arquetipo"
          record={archetype.record}
          rate={archetype.rate}
          hint={
            <>
              {formatCount(total)} listas ({formatShare(archetype.share)} de la era {info.era.code}) · media de la era{' '}
              {info.mean.rate ? formatRateValue(info.mean.rate.value) : 'sin datos'}
            </>
          }
        />
        {detail.data.merged.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Incluye {detail.data.merged.length === 1 ? 'el arquetipo' : 'los arquetipos'} de Limitless:
            {detail.data.merged.map((merged) => (
              <Button key={merged} size="xs" variant="outline" onClick={() => alias(merged, null)}>
                {merged} · separar
              </Button>
            ))}
          </div>
        ) : null}
      </Section>

      <Section title="Con y sin una carta">
        <p className="text-xs text-muted-foreground">
          Elegí una carta: las listas del arquetipo se parten entre las que la juegan (al menos {minCount}{' '}
          {minCount === 1 ? 'copia' : 'copias'}) y las que no.
        </p>
        {withWithout ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{label(withWithout.card.groupId, withWithout.card.nameEs)}</span>
              <div className="flex gap-1">
                <Button size="xs" variant={minCount === 1 ? 'default' : 'outline'} onClick={() => setMinCount(1)}>
                  1+
                </Button>
                <Button size="xs" variant={minCount === 2 ? 'default' : 'outline'} onClick={() => setMinCount(2)}>
                  2
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setCard(null)}>
                  Quitar
                </Button>
              </div>
            </div>
            <RateRows
              rows={[
                {
                  id: 'with',
                  label: `Con ${label(withWithout.card.groupId, withWithout.card.nameEs)}`,
                  hint: `${formatCount(withWithout.with.lists)} listas`,
                  record: withWithout.with.record,
                  rate: withWithout.with.rate,
                },
                {
                  id: 'without',
                  label: `Sin ${label(withWithout.card.groupId, withWithout.card.nameEs)}`,
                  hint: `${formatCount(withWithout.without.lists)} listas`,
                  record: withWithout.without.record,
                  rate: withWithout.without.rate,
                },
              ]}
            />
          </div>
        ) : null}
        <ul className="divide-y rounded-lg border">
          {detail.data.cards.map((usage) => (
            <li key={usage.groupId}>
              <button
                type="button"
                onClick={() => setCard(usage.groupId)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted',
                  card === usage.groupId && 'bg-muted',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{label(usage.groupId, usage.nameEs)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular">
                  {formatShare(usage.share)} · {usage.byCopies[1] ?? 0}×1 · {usage.byCopies[2] ?? 0}×2
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Listas más jugadas">
        <RateRows
          rows={detail.data.lists.map((row) => ({
            id: row.key,
            label: row.cards
              .filter((line) => line.cardType === 'pokemon')
              .map((line) => `${line.count} ${label(line.groupId, line.nameEs)}`)
              .join(', '),
            hint: `${formatCount(row.lists)} ${row.lists === 1 ? 'lista' : 'listas'}`,
            to: `/torneos/listas/${row.key}${query}`,
            record: row.record,
            rate: row.rate,
          }))}
        />
      </Section>

      {archetype.archetype.id ? (
        <Section title="Fusionar">
          <p className="text-xs text-muted-foreground">
            Limitless cambia sus arquetipos sin aviso. Fusionar muestra otro arquetipo como parte de este en todas las
            estadísticas; se puede separar después.
          </p>
          <Select
            value=""
            onValueChange={(other) => {
              if (archetype.archetype.id) void alias(other, archetype.archetype.id)
            }}
          >
            <SelectTrigger aria-label="Fusionar otro arquetipo con este" className="w-full">
              <SelectValue placeholder="Sumar otro arquetipo a este…" />
            </SelectTrigger>
            <SelectContent>
              {others.map((row) => (
                <SelectItem key={row.archetype.id} value={row.archetype.id as string}>
                  {row.archetype.name} ({row.lists})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      ) : null}

      <Link to={`/torneos${query}`} className="text-sm text-primary hover:underline">
        Volver a la era {info.era.code}
      </Link>
    </div>
  )
}
