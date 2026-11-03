/**
 * Suerte de los sobres (Fase 17): what came in between the last two imports of the CSV, and since the first one, by
 * rarity, against what packs give. Approximate: the CSV says what you own, not where it came from.
 *
 * 2/11: with a pokemon-zone import, the same check on the game's own numbers — packs really opened per expansion and
 * cards obtained by rarity (real), since the previous import and lifetime — against the rates of those packs
 * (estimated). Each number says which it is.
 */
import { CloverIcon } from 'lucide-react'
import { Link } from 'react-router'
import { usePackLuck } from '@/api/collection'
import { type GameLuck, type GameLuckTier, usePokemonZone } from '@/api/pokemonZone'
import type { PackLuckView } from '@/api/schemas'
import { Section } from '@/components/Section'
import { formatDate, formatDateTime, formatNumber, plural } from '@/lib/format'
import { formatRateValue } from '@/lib/matches'
import { cn } from '@/lib/utils'

type Interval = PackLuckView['intervals'][number]

const VERDICT = {
  too_few: 'pocas cartas para decir algo',
  normal: 'dentro de lo normal',
  unlucky: 'peor de lo normal',
  lucky: 'mejor de lo normal',
} as const

const oneDecimal = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

function oneIn(probability: number): number {
  return probability <= 0 ? 0 : Math.max(1, Math.round(1 / probability))
}

function Verdict({ check }: { check: Pick<GameLuckTier['check'], 'verdict' | 'lowerTail' | 'upperTail'> }) {
  const verdict = check.verdict
  const tail = verdict === 'unlucky' ? check.lowerTail : verdict === 'lucky' ? check.upperTail : null
  return (
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
  )
}

function Tier({ label, tier }: { label: string; tier: Interval['luck']['rare'] }) {
  return (
    <p className="text-sm">
      {/* The expected is a count of copies, the share a percentage of what came in. */}
      <span className="font-medium">{label}:</span> {tier.observed} (se esperaban {oneDecimal.format(tier.expected)},{' '}
      {formatRateValue(tier.expectedShare)} de lo que entró) · <Verdict check={tier.check} />
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
      {luck.ambiguous > 0 ? (
        <p className="text-xs text-muted-foreground">
          {luck.ambiguous}{' '}
          {luck.ambiguous === 1 ? 'copia de una reimpresión no cuenta' : 'copias de reimpresiones no cuentan'} (como las
          del Deluxe): pudieron salir de dos sobres distintos.
        </p>
      ) : null}
    </div>
  )
}

function GameTier({ label, tier }: { label: string; tier: GameLuckTier | null }) {
  if (!tier) return null
  return (
    <p className="text-sm">
      <span className="font-medium">{label}:</span> {formatNumber(tier.observed)}{' '}
      <span className="text-muted-foreground">(del juego)</span> · se esperaban ~
      {formatNumber(Math.round(tier.expected))}{' '}
      <span className="text-muted-foreground">
        (estimado: {formatRateValue(tier.expectedShare)} de las cartas, con las tasas de los sobres que abriste)
      </span>{' '}
      · <Verdict check={tier.check} />
    </p>
  )
}

/** One span of the game's numbers: since the previous import, or lifetime. */
function GameLuckCard({ title, luck }: { title: string; luck: GameLuck }) {
  const top = luck.byPack.slice(0, 3)
  const other = [
    luck.wonderPicks !== null ? `Wonder Pick: ${formatNumber(luck.wonderPicks)}` : null,
    luck.trades !== null ? `intercambios: ${formatNumber(luck.trades)}` : null,
  ].filter((item): item is string => item !== null)
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2" data-testid="game-luck">
      <span className="text-xs text-muted-foreground">{title}</span>
      {luck.packs === 0 && luck.cards === 0 ? (
        <p className="text-sm text-muted-foreground">No abriste sobres ni entraron cartas.</p>
      ) : (
        <>
          <p className="text-sm">
            Abriste <span className="font-medium">{plural(luck.packs, 'sobre', 'sobres')}</span> y obtuviste{' '}
            <span className="font-medium">{plural(luck.cards, 'carta', 'cartas')}</span>{' '}
            <span className="text-muted-foreground">(del juego)</span>.
          </p>
          {luck.otherCards > 0 ? (
            <p className="text-xs text-muted-foreground">
              {luck.otherCards === 1
                ? '1 carta no salió de esos sobres'
                : `Unas ${formatNumber(luck.otherCards)} no salieron de esos sobres`}{' '}
              (estimado: los sobres dan {formatNumber(luck.packCards)})
              {other.length > 0 ? `; ${other.join(', ')} (del juego)` : ''}, y también regalos y premios. Se cuentan con
              la misma mezcla que los sobres.
            </p>
          ) : null}
          <GameTier label="☆ o más" tier={luck.rare} />
          <GameTier label="◊◊◊◊ (ex)" tier={luck.ex} />
          {top.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Los que más abriste:{' '}
              {top.map((pack) => `${pack.nameEs ?? pack.nameEn} ${formatNumber(pack.opened)}`).join(' · ')}.
            </p>
          ) : null}
          {luck.unknownPacks > 0 ? (
            <p className="text-xs text-muted-foreground">
              {luck.unknownPacks === 1
                ? '1 sobre de una expansión que el catálogo todavía no tiene no cuenta'
                : `${formatNumber(luck.unknownPacks)} sobres de expansiones que el catálogo todavía no tiene no cuentan`}{' '}
              en lo esperado (sus cartas sí están entre las obtenidas).
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

function FromGame() {
  const zone = usePokemonZone()
  const data = zone.data
  if (!data) return null
  if (!data.latest) {
    return (
      <p className="text-xs text-muted-foreground">
        Con los números reales del juego (sobres abiertos y cartas por rareza):{' '}
        <Link to="/coleccion/pokemon-zone" className="underline">
          traelos de pokemon-zone
        </Link>
        .
      </p>
    )
  }
  const luck = data.luck
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Según el juego (pokemon-zone)</h3>
      {luck?.since && data.previous ? (
        <GameLuckCard
          title={`Desde la importación anterior: ${formatDateTime(data.previous.syncedAt)} → ${formatDateTime(data.latest.syncedAt)}`}
          luck={luck.since}
        />
      ) : null}
      {luck?.lifetime ? (
        <GameLuckCard title={`Desde que jugás, al ${formatDateTime(data.latest.syncedAt)}`} luck={luck.lifetime} />
      ) : null}
      <p className="text-xs text-muted-foreground">
        Reales: sobres abiertos y cartas obtenidas por rareza, como los cuenta el juego (incluyen Wonder Pick,
        intercambios y regalos). Estimado: lo esperado, con las tasas publicadas de los sobres de cada expansión pesadas
        por los sobres que abriste.
      </p>
    </div>
  )
}

export function PackLuckSection() {
  const luck = usePackLuck()
  const zone = usePokemonZone()
  if (!luck.data && !zone.data?.latest) return null
  const latest = luck.data?.intervals[0]
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <CloverIcon className="size-4" aria-hidden="true" />
          Suerte de los sobres
        </span>
      }
    >
      <FromGame />
      {!luck.data ? null : luck.data.imports < 2 || !latest ? (
        <p className="text-sm text-muted-foreground">
          Con la próxima importación del CSV te digo cómo te fue: qué entró entre una y otra contra lo que dan los
          sobres.
        </p>
      ) : (
        <>
          <h3 className="text-sm font-semibold">Según tu colección</h3>
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
