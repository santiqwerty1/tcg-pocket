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
import { type GameLuck, type GameLuckSinceFirst, type GameLuckTier, usePokemonZone } from '@/api/pokemonZone'
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

function Verdict({ check }: { check: Pick<GameLuckTier['low'], 'verdict' | 'lowerTail' | 'upperTail'> }) {
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

/** «1 carta» / «1.234 cartas». */
const cardsText = (count: number) => plural(count, 'carta', 'cartas')

/**
 * Review of pz/import and pz/luck: the check counts over the cards with known odds (n: the packs' and the Wonder
 * Picks'), and the game's count of the tier includes the cards of unknown origin, so it is made at both ends of what
 * those could hold; a verdict only when both agree, and otherwise how many of them would make it normal.
 */
function TierBody({ label, tier }: { label: string; tier: GameLuckTier }) {
  const { min, max } = tier.fromPacks
  const unknown = tier.unknown
  const picks = tier.games - tier.packGames
  return (
    <>
      <p>
        <span className="font-medium">{label}:</span> {formatNumber(tier.observed)}{' '}
        <span className="text-muted-foreground">(del juego, de todas las fuentes)</span>. En las{' '}
        {formatNumber(tier.packGames)} cartas de los sobres (n) se esperaban ~
        {formatNumber(Math.round(tier.packExpected))}
        {picks > 0
          ? `; con ${plural(picks, 'carta', 'cartas')} de Wonder Pick a la tasa de los sobres, ~${formatNumber(Math.round(tier.expected))} en ${formatNumber(tier.games)}`
          : ''}{' '}
        <span className="text-muted-foreground">
          (estimado: {formatRateValue(tier.expectedShare)}, con las tasas de los sobres que abriste)
        </span>
        {picks > 0
          ? `. De los sobres salieron al menos ${formatNumber(min)}; de los sobres y Wonder Pick, a lo sumo ${formatNumber(max)}.`
          : min === max
            ? `; de ellas salieron ${formatNumber(max)}.`
            : `; de ellas salieron entre ${formatNumber(min)} y ${formatNumber(max)}.`}
      </p>
      <p>
        {tier.verdict === 'unknown' ? (
          <span className="text-muted-foreground">
            No se puede saber con lo que da el juego:{' '}
            {unknown === 1
              ? 'según si la carta de origen desconocido'
              : `según cuántas de las ${formatNumber(unknown)} cartas de origen desconocido`}
            {picks > 0 ? ' (Wonder Pick incluido)' : ''} {unknown === 1 ? 'fuera' : 'fueran'} de estas, da{' '}
            {VERDICT[tier.low.verdict]} o {VERDICT[tier.high.verdict]}.
            {tier.normalIf
              ? ` Sería normal si ${
                  tier.normalIf.min === tier.normalIf.max
                    ? `${formatNumber(tier.normalIf.min)} lo ${tier.normalIf.min === 1 ? 'fuera' : 'fueran'}`
                    : `entre ${formatNumber(tier.normalIf.min)} y ${formatNumber(tier.normalIf.max)} lo fueran`
                }; con menos, mejor de lo normal; con más, peor.`
              : ''}
          </span>
        ) : (
          <Verdict
            check={{
              verdict: tier.verdict,
              lowerTail: tier.verdict === 'unlucky' ? (tier.tail ?? 1) : 1,
              upperTail: tier.verdict === 'lucky' ? (tier.tail ?? 1) : 1,
            }}
          />
        )}
      </p>
    </>
  )
}

function GameTier({ label, tier }: { label: string; tier: GameLuckTier | null }) {
  if (!tier) return null
  return (
    <div className="flex flex-col gap-0.5 text-sm" data-testid="game-tier">
      <TierBody label={label} tier={tier} />
    </div>
  )
}

/** pz/luck: where the cards came from — real, estimated, unknown — each said for what it is. */
function Sources({ luck }: { luck: GameLuck }) {
  const { sources } = luck
  const unknownParts = [
    sources.trades !== null && sources.trades > 0
      ? `${plural(sources.trades, 'intercambio', 'intercambios')} (del juego)`
      : null,
    sources.unknownPicks > 0
      ? `${formatNumber(sources.unknownPicks)} de Wonder Pick${
          sources.pickWindows.length > 0 ? ` (${sources.pickWindows.map((window) => window.why).join('; ')})` : ''
        }`
      : null,
    sources.guaranteedPacks > 0
      ? `${sources.guaranteedSeen ? '' : 'a lo sumo '}${plural(sources.guaranteedPacks, 'carta asegurada', 'cartas aseguradas')} de un sobre de aniversario (★★)`
      : null,
    sources.restCards > 0
      ? `~${formatNumber(sources.restCards)} de regalos, premios, canjes de puntos y promos (estimado)`
      : null,
  ].filter((item): item is string => item !== null)
  return (
    <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-muted-foreground" data-testid="game-sources">
      <li>
        Sobres: ~{cardsText(luck.packCards)} <span>(estimado: sobres × cartas por sobre)</span>.
      </li>
      {sources.wonderPicks !== null && sources.wonderPicks > 0 ? (
        <li>
          Wonder Pick: {formatNumber(sources.wonderPicks)} (del juego)
          {sources.pickCards > 0
            ? `; ${formatNumber(sources.pickCards)} cuentan a la tasa de los sobres para «peor de lo normal», y como de origen desconocido para «mejor»`
            : '; ninguna cuenta como carta de sobre'}
          .
        </li>
      ) : null}
      {luck.otherCards > 0 ? (
        <li>
          De origen desconocido: ~{cardsText(luck.otherCards)}
          {unknownParts.length > 0 ? ` — ${unknownParts.join(', ')}` : ''}.
        </li>
      ) : null}
    </ul>
  )
}

/** One span of the game's numbers: since the previous import, or lifetime. */
function GameLuckCard({ title, luck }: { title: string; luck: GameLuck }) {
  const top = luck.byPack.slice(0, 3)
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2" data-testid="game-luck">
      <span className="text-xs text-muted-foreground">{title}</span>
      {luck.packs === 0 && luck.cards === 0 ? (
        <p className="text-sm text-muted-foreground">No abriste sobres ni entraron cartas.</p>
      ) : (
        <>
          <p className="text-sm">
            Abriste <span className="font-medium">{plural(luck.packs, 'sobre', 'sobres')}</span> y obtuviste{' '}
            <span className="font-medium">{cardsText(luck.cards)}</span>{' '}
            <span className="text-muted-foreground">(del juego)</span>.
          </p>
          <Sources luck={luck} />
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
              en lo esperado (sus cartas quedan de origen desconocido).
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/** pz/luck: «desde la primera importación», the spans between imports with few cards of unknown origin, summed. */
function SinceFirstCard({ since }: { since: GameLuckSinceFirst }) {
  const tier = (label: string, value: GameLuckSinceFirst['rare']) =>
    value ? (
      <div className="flex flex-col gap-0.5 text-sm" data-testid="since-first-tier">
        <p className="text-xs text-muted-foreground">
          {label}: {value.counted === since.spans ? 'cuentan' : `cuentan ${value.counted} de`}{' '}
          {plural(since.spans, 'período', 'períodos')} entre importaciones.
        </p>
        <TierBody label={label} tier={value} />
      </div>
    ) : (
      <p className="text-sm text-muted-foreground" data-testid="since-first-tier">
        {label}: todavía no cuenta ninguno de {plural(since.spans, 'período', 'períodos')} entre importaciones.
      </p>
    )
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2" data-testid="game-luck-since-first">
      <span className="text-xs text-muted-foreground">
        Desde la primera importación: {formatDateTime(since.from)} → {formatDateTime(since.to)}
      </span>
      {tier('☆ o más', since.rare)}
      {tier('◊◊◊◊ (ex)', since.ex)}
      <p className="text-xs text-muted-foreground">
        Cuentan los períodos entre importaciones con pocas cartas de origen desconocido: un día en que solo abriste
        sobres (y Wonder Pick) cuenta; uno con muchos intercambios, promos o premios, no. Se elige por esas cartas y lo
        esperado, nunca por lo que salió; en un empate, el más reciente.
      </p>
      <ImportRegularly />
    </div>
  )
}

/**
 * Review of #172: when to import is Santi's choice, and a lucky run could get a span of its own; importing at a
 * fixed time keeps the spans from being chosen by what came out.
 */
function ImportRegularly() {
  return (
    <p className="text-xs text-muted-foreground" data-testid="import-regularly">
      Importá todos los días a la misma hora, después del Sync automático de pokemon-zone: así lo que salió no decide
      qué período cuenta.
    </p>
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
      {luck?.sinceFirst ? <SinceFirstCard since={luck.sinceFirst} /> : null}
      {luck?.lifetime ? (
        <GameLuckCard title={`Desde que jugás, al ${formatDateTime(data.latest.syncedAt)}`} luck={luck.lifetime} />
      ) : null}
      {luck && !luck.sinceFirst ? (
        <>
          <p className="text-xs text-muted-foreground">
            Con la próxima importación empieza «desde la primera importación»: cuentan los períodos entre importaciones
            con pocas cartas de origen desconocido, como un día en que solo abriste sobres.
          </p>
          <ImportRegularly />
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Reales: sobres abiertos, Wonder Pick, intercambios y cartas obtenidas por rareza, como los cuenta el juego.
        Estimado: las cartas de los sobres y lo esperado, con las tasas publicadas de los sobres de cada expansión
        pesadas por los sobres que abriste. En Wonder Pick ves las cinco cartas antes de elegir, así que las tuyas tiran
        a raras: cuentan a la tasa de los sobres para decir «peor de lo normal» (nunca son peores) y como de origen
        desconocido para decir «mejor». De origen desconocido: lo demás; el veredicto sale solo si no cambia con lo que
        esas cartas pudieron tener.
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
