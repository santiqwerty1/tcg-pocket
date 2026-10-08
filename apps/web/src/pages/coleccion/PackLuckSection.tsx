/**
 * Suerte de los sobres (Fase 17): what came in between the last two imports of the CSV, and since the first one, by
 * rarity, against what packs give. Approximate: the CSV says what you own, not where it came from.
 */
import { CloverIcon } from 'lucide-react'
import { usePackLuck } from '@/api/collection'
import type { PackLuckView } from '@/api/schemas'
import { Section } from '@/components/Section'
import { formatDate } from '@/lib/format'
import { formatRateValue } from '@/lib/matches'
import { cn } from '@/lib/utils'

type Interval = PackLuckView['intervals'][number]

const VERDICT = {
  too_few: 'pocas cartas para decir algo',
  normal: 'dentro de lo normal',
  unlucky: 'peor de lo normal',
  lucky: 'mejor de lo normal',
} as const

function oneIn(probability: number): number {
  return probability <= 0 ? 0 : Math.max(1, Math.round(1 / probability))
}

function Tier({ label, tier }: { label: string; tier: Interval['luck']['rare'] }) {
  const verdict = tier.check.verdict
  const tail = verdict === 'unlucky' ? tier.check.lowerTail : verdict === 'lucky' ? tier.check.upperTail : null
  return (
    <p className="text-sm">
      <span className="font-medium">{label}:</span> {tier.observed} (se esperaban {formatRateValue(tier.expected)},{' '}
      {formatRateValue(tier.expectedShare)} de lo que entró) ·{' '}
      <span
        className={cn(
          verdict === 'lucky' && 'text-success',
          verdict === 'unlucky' && 'text-destructive',
          verdict === 'too_few' && 'text-muted-foreground',
        )}
      >
        {VERDICT[verdict]}
        {tail !== null ? ` (pasa 1 de cada ${oneIn(tail)})` : ''}
      </span>
    </p>
  )
}

function IntervalCard({ title, interval }: { title: string; interval: Interval }) {
  const { luck } = interval
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {title}: {formatDate(interval.from.appliedAt)} → {formatDate(interval.to.appliedAt)}
      </span>
      {luck.gained === 0 ? (
        <p className="text-sm text-muted-foreground">No entraron cartas nuevas.</p>
      ) : (
        <>
          <p className="text-sm">
            Entraron <span className="font-medium">{luck.gained}</span> copias (≈ {Math.round(luck.packsEstimate)}{' '}
            sobres si todo vino de sobres).
          </p>
          <Tier label="☆ o más" tier={luck.rare} />
          <Tier label="◊◊◊◊ (ex)" tier={luck.ex} />
        </>
      )}
    </div>
  )
}

export function PackLuckSection() {
  const luck = usePackLuck()
  if (!luck.data) return null
  const latest = luck.data.intervals[0]
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <CloverIcon className="size-4" aria-hidden="true" />
          Suerte de los sobres
        </span>
      }
    >
      {luck.data.imports < 2 || !latest ? (
        <p className="text-sm text-muted-foreground">
          Con la próxima importación del CSV te digo cómo te fue: qué entró entre una y otra contra lo que dan los
          sobres.
        </p>
      ) : (
        <>
          <IntervalCard title="Última importación" interval={latest} />
          {luck.data.overall && luck.data.intervals.length > 1 ? (
            <IntervalCard title="Desde la primera" interval={luck.data.overall} />
          ) : null}
          <p className="text-xs text-muted-foreground">
            Aproximado: el CSV dice qué tenés, no de dónde vino; cuentan también intercambios, Wonder Pick y premios
            (las promos no). Lo esperado sale de las tasas publicadas de los sobres de cada expansión.
          </p>
        </>
      )}
    </Section>
  )
}
