/**
 * Packs (BRIEF M4, Fase 4): which pack to open for the target decks and the collection goal. The knobs are saved
 * in the app settings (`packModel`, `alpha`, `rarityFilter`, `limitedBoost`, `packDeckTarget`) so Claude's `packs_recommend` uses
 * the same ones.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRecommendation } from '@/api/packs'
import type { CollectionGoal, DeckTarget, PackModel, RecommendBody } from '@/api/schemas'
import { useSetSetting, useSettings } from '@/api/settings'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { limitedLabel } from '@/lib/packs'
import { useDebouncedValue } from '@/lib/useDebounce'
import { GoalsSection } from './GoalsSection'
import { PackSettings } from './PackSettings'
import { DeckCompletions, MissingCards, PackTable } from './Results'

const DEFAULT_COLLECTION: CollectionGoal = { rarities: [], copies: 1 }

interface Knobs {
  model: PackModel
  alpha: number
  collection: CollectionGoal | null
  limitedBoost: number
  deckTarget: DeckTarget
}

function knobsFrom(settings: Record<string, unknown>): Knobs {
  const model = settings.packModel === 'tracker' ? 'tracker' : 'corrected'
  const alpha = typeof settings.alpha === 'number' && settings.alpha >= 0 && settings.alpha <= 1 ? settings.alpha : 0.7
  const raw = settings.rarityFilter
  let collection: CollectionGoal | null = DEFAULT_COLLECTION
  if (raw === null) collection = null
  else if (raw && typeof raw === 'object' && Array.isArray((raw as CollectionGoal).rarities)) {
    collection = raw as CollectionGoal
  }
  const boost = settings.limitedBoost
  const limitedBoost = typeof boost === 'number' && boost >= 1 && boost <= 5 ? boost : 3
  const deckTarget: DeckTarget = settings.packDeckTarget === 'tournament' ? 'tournament' : 'saved'
  return { model, alpha, collection, limitedBoost, deckTarget }
}

export function SobresPage() {
  const settings = useSettings()
  const setSetting = useSetSetting()
  const [knobs, setKnobs] = useState<Knobs | null>(null)
  const [onlyAvailable, setOnlyAvailable] = useState(true)

  useEffect(() => {
    if (knobs === null && settings.data) setKnobs(knobsFrom(settings.data))
  }, [knobs, settings.data])

  const alpha = useDebouncedValue(knobs?.alpha ?? 0.7, 300)
  const body = useMemo<RecommendBody | null>(
    () =>
      knobs
        ? {
            model: knobs.model,
            alpha,
            collection: knobs.collection,
            onlyAvailable,
            limitedBoost: knobs.limitedBoost,
            deckTarget: knobs.deckTarget,
          }
        : null,
    [knobs, alpha, onlyAvailable],
  )
  const recommendation = useRecommendation(body)

  function update(patch: Partial<Knobs>) {
    if (!knobs) return
    const next = { ...knobs, ...patch }
    setKnobs(next)
    if (patch.model !== undefined) setSetting.mutate({ key: 'packModel', value: patch.model })
    if (patch.collection !== undefined) setSetting.mutate({ key: 'rarityFilter', value: patch.collection })
    if (patch.limitedBoost !== undefined) setSetting.mutate({ key: 'limitedBoost', value: patch.limitedBoost })
    if (patch.deckTarget !== undefined) setSetting.mutate({ key: 'packDeckTarget', value: patch.deckTarget })
  }

  const data = recommendation.data
  const limitedPacks = (data?.rows ?? [])
    .filter((row) => row.limited && row.available)
    .map(
      (row) =>
        `${row.nameEs}: ${limitedLabel(row.limited ?? { until: null, daysLeft: null }, data?.today ?? '').toLowerCase()}`,
    )

  if (settings.isPending || !knobs) return <LoadingRows />
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />

  return (
    <div className="flex flex-col gap-6">
      <GoalsSection
        decks={recommendation.data?.goals.decks ?? []}
        collection={knobs.collection}
        onCollectionChange={(collection) => update({ collection })}
        alpha={knobs.alpha}
        onAlphaChange={(value) => setKnobs({ ...knobs, alpha: value })}
        onAlphaCommit={() => setSetting.mutate({ key: 'alpha', value: knobs.alpha })}
        model={knobs.model}
        onModelChange={(model) => update({ model })}
        onlyAvailable={onlyAvailable}
        onOnlyAvailableChange={setOnlyAvailable}
        limitedBoost={knobs.limitedBoost}
        onLimitedBoostChange={(limitedBoost) => update({ limitedBoost })}
        limitedPacks={limitedPacks}
        deckTarget={knobs.deckTarget}
        onDeckTargetChange={(deckTarget) => update({ deckTarget })}
      />

      {recommendation.isPending ? <LoadingRows /> : null}
      {recommendation.isError ? (
        <ErrorState error={recommendation.error} onRetry={() => recommendation.refetch()} />
      ) : null}
      {recommendation.data ? (
        <div className={recommendation.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
          <div className="flex flex-col gap-6">
            <PackTable recommendation={recommendation.data} />
            <MissingCards items={recommendation.data.missing} />
            <DeckCompletions decks={recommendation.data.decks} />
          </div>
        </div>
      ) : null}

      <PackSettings />

      {recommendation.data ? (
        <section className="flex flex-col gap-1 text-xs text-muted-foreground">
          <h2 className="text-sm font-medium text-foreground">Supuestos</h2>
          <ul className="list-disc pl-5">
            {recommendation.data.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
