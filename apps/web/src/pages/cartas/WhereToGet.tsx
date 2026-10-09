/**
 * «Dónde se consigue» (Fase 41): for each edition of a functional card, the pack that gives it and whether it is on
 * sale, what it costs in pack points and whether it can be traded — the step between «falta» in a deck and Sobres.
 */
import { Link } from 'react-router'
import { useExpansions } from '@/api/catalog'
import { usePacks, useRarityRules } from '@/api/packs'
import type { Expansion, GroupDetail, PackInfo, RarityRuleInfo } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import { formatDay } from '@/lib/packs'

export interface EditionSource {
  cardId: string
  rarity: string
  promo: boolean
  /** Packs that give this edition (all of the set's packs for «everypack»). */
  packs: PackInfo[]
  onSale: boolean
  limitedUntil: string | null
  points: number | null
  pointsVerified: boolean
  tradeable: boolean
}

/** Pure: the source of each edition from the catalog's packs, rarity rules and expansions. */
export function editionSources(
  group: GroupDetail,
  packs: readonly PackInfo[],
  rules: readonly RarityRuleInfo[],
  expansions: readonly Expansion[],
  /** YYYY-MM-DD in the owner's zone: a limited pack past its last day is no longer on sale (like the recommender). */
  today: string,
): EditionSource[] {
  return group.editions.map(({ card }) => {
    const expansion = expansions.find((item) => item.id === card.expansionId)
    const promo = Boolean(expansion?.isPromo) || card.rarity === 'P'
    const ofSet = packs.filter((pack) => pack.expansionId === card.expansionId)
    // Only «everypack» means every pack of the set; a pack the catalog does not declare (or an older API without
    // `pack`) is «unknown», never «any pack».
    const sources = promo
      ? []
      : card.pack === 'everypack'
        ? ofSet
        : ofSet.filter((pack) => pack.id === `${card.expansionId}/${card.pack}`)
    const onSale = sources.filter(
      (pack) => pack.available && !(pack.limited && pack.limitedUntil && pack.limitedUntil < today),
    )
    // A deadline only when every pack still selling it is limited: then the last of their last days.
    const deadlines = onSale.map((pack) => (pack.limited ? pack.limitedUntil : null))
    const limitedUntil =
      deadlines.length > 0 && deadlines.every((day): day is string => day !== null)
        ? deadlines.reduce((last, day) => (day > last ? day : last))
        : null
    const rule = rules.find((item) => item.rarity === card.rarity)
    return {
      cardId: card.id,
      rarity: card.rarity,
      promo,
      packs: sources,
      onSale: onSale.length > 0,
      limitedUntil,
      points: promo ? null : (rule?.points ?? null),
      pointsVerified: rule?.verified ?? false,
      tradeable: Boolean(rule?.tradeable) && expansion?.tradeable !== false && !promo,
    }
  })
}

function packNames(packs: readonly PackInfo[]): string {
  if (packs.length === 0) return 'sobre desconocido en el catálogo'
  const expansion = packs[0]?.expansionNameEs ?? ''
  const names = [...new Set(packs.map((pack) => pack.nameEs))]
  return names.length > 1 ? `cualquier sobre de ${expansion}` : `${names[0]} (${expansion})`
}

export function WhereToGet({ group }: { group: GroupDetail }) {
  const packs = usePacks()
  const rules = useRarityRules()
  const expansions = useExpansions()
  const ready = packs.data && rules.data && expansions.data
  const failed = [packs, rules, expansions].find((query) => query.isError)
  // The calendar day here (YYYY-MM-DD), not UTC: the last sale day is a date in the owner's zone.
  const today = new Date().toLocaleDateString('sv-SE')
  return (
    <Section
      title="Dónde se consigue"
      action={
        <Button size="sm" variant="outline" asChild>
          <Link to="/sobres">Qué sobre abrir</Link>
        </Button>
      }
    >
      {failed ? (
        <ErrorState
          error={failed.error}
          onRetry={() => {
            for (const query of [packs, rules, expansions]) if (query.isError) void query.refetch()
          }}
        />
      ) : null}
      {!ready && !failed ? <LoadingRows rows={2} /> : null}
      {ready ? (
        <ul className="divide-y rounded-lg border text-sm">
          {editionSources(group, packs.data, rules.data, expansions.data, today).map((source) => (
            <li key={source.cardId} className="flex flex-col gap-1 px-3 py-2">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link to={`/cartas/${encodeURIComponent(source.cardId)}`} className="font-mono hover:underline">
                  {source.cardId}
                </Link>
                <span>{source.rarity}</span>
                <span className="min-w-0 flex-1">
                  {source.promo ? 'promo: no sale de sobres' : packNames(source.packs)}
                </span>
                {source.promo || source.packs.length === 0 ? null : source.onSale ? (
                  <Badge variant="secondary">
                    {source.limitedUntil
                      ? `a la venta hasta el ${formatDay(source.limitedUntil, today)}`
                      : 'a la venta'}
                  </Badge>
                ) : (
                  <Badge variant="outline">ya no se vende</Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {source.points !== null
                  ? `${formatNumber(source.points)} puntos de sobre${source.pointsVerified ? '' : ' (sin verificar)'}`
                  : 'no se compra con puntos'}
                {' · '}
                {source.tradeable ? 'se puede intercambiar' : 'no se intercambia'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}
