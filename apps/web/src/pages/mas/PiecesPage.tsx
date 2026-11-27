/**
 * «Piezas de la interfaz» (Menú → Acerca de): the pieces of mock-up D that the app has so far, each drawn once in
 * every state it can take, so they are seen together, in both themes and on a phone, before they reach a screen.
 *
 * Everything it shows is test data (pieces/fixtures.ts): it asks the API for nothing, and it says so on top and in
 * every section. It is also the address the screens suite measures the pieces at (e2e/piezas.spec.ts). It grows with
 * each piece and goes away when the last screen of the renewal is done.
 */
import type { ReactNode } from 'react'
import { FigureValue } from '@/components/figures/FigureValue'
import { IntervalBar, referenceText } from '@/components/figures/IntervalBar'
import { MarkWords, NoData } from '@/components/figures/Marks'
import { BarMark, IntervalMark, RecordBar, recordSegments } from '@/components/figures/MiniCharts'
import { SourceBlock } from '@/components/figures/SourceBlock'
import { SourceLegend } from '@/components/figures/SourceLegend'
import { SourceSeal } from '@/components/figures/SourceSeal'
import { figureText, NO_COVERAGE, orientativeText, type SampleKind, SOURCE_NAME, type SourceKey } from '@/lib/figure'
import { formatNumber } from '@/lib/format'
import { formatRateValue, formatRecord } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { SourceLanes } from '@/pages/mazos/SourceLanes'
import {
  ARCHETYPE,
  BOTS,
  COLLECTION,
  COVERED,
  DECK,
  DECK_EMPTY,
  EXACT_LIST,
  EXPECTED,
  FEW,
  LONG_NAME,
  LOST_ONCE,
  MINE,
  NOTES,
  POPULAR,
  RECORDS,
  SHARES,
  STALE,
  WON_TWICE,
} from './pieces/fixtures'

const SOURCES: readonly SourceKey[] = ['matches', 'tournament', 'simulation']
const KINDS: readonly SampleKind[] = ['matches', 'lists', 'simulations']

/** What the page says of all of its numbers, on top and in every section. */
const NOTICE = 'Datos de prueba: ninguna cifra de esta página es tuya'

/** A value to compare with, for the pieces that draw one: what the deck should score against the meta. */
const REFERENCE = { value: 55.8, label: 'esperable' } as const
/** A scale cut to the range where the figures of a table fall. */
const CUT = [40, 70] as const

const COLLECTION_PARTS = [
  { value: COLLECTION.complete, tone: 'strong', label: `${formatNumber(COLLECTION.complete)} completas` },
  { value: COLLECTION.started, tone: 'soft', label: `${formatNumber(COLLECTION.started)} empezadas` },
  { value: COLLECTION.missing, tone: 'none', label: `${formatNumber(COLLECTION.missing)} sin tener` },
] as const
const COLLECTION_TEXT = COLLECTION_PARTS.map((part) => part.label).join(' · ')

function Notice({ className }: { className?: string }) {
  return (
    <p data-notice="" className={className}>
      {NOTICE}
    </p>
  )
}

/** One piece: what it is, the notice, and its states. */
function Piece({ id, title, what, children }: { id: string; title: string; what: string; children: ReactNode }) {
  return (
    <section data-section={id} aria-labelledby={`pieza-${id}`} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 id={`pieza-${id}`} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="type-sub text-pretty text-foreground-2">{what}</p>
        <Notice className="type-n text-foreground-3" />
      </div>
      {children}
    </section>
  )
}

/** The states of a piece, one under the other on the surface the pieces are drawn on. */
function States({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-lg border bg-card">{children}</div>
}

/**
 * One state of a piece, under the name of the state. `flush`: the piece reaches the edges of the card (the legend of
 * a card, which draws its own line and padding).
 */
function State({ name, flush = false, children }: { name: string; flush?: boolean; children: ReactNode }) {
  return (
    <div data-state={name} className={cn('grid gap-2 border-t first:border-t-0', flush ? 'pt-3' : 'px-[14px] py-3')}>
      <h3 className={cn('type-label text-pretty text-foreground-3', flush && 'px-[14px]')}>{name}</h3>
      <div className="grid min-w-0 gap-1.5">{children}</div>
    </div>
  )
}

/** A state that is a card of its own, under the name of the state. */
function Whole({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-state={name} className="grid gap-2">
      <h3 className="type-label text-pretty text-foreground-3">{name}</h3>
      {children}
    </div>
  )
}

/** What a chart shows, in words: a chart never says something that is not written too. */
function Words({ children }: { children: ReactNode }) {
  return <p className="type-sub text-pretty text-foreground-2">{children}</p>
}

/** How each kind of sample is named in the name of a state. */
const ORIENTATIVE_BY: Record<SampleKind, string> = {
  matches: 'por partidas',
  lists: 'por listas de torneo',
  simulations: 'por partidas simuladas',
}

/** The box of a cell of a table, where the small charts go. */
const CELL = 'w-[116px]'

export function PiecesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Notice className="rounded-lg border border-dashed px-3 py-2 type-row text-foreground" />
        <p className="type-sub text-pretty text-foreground-2">
          Las piezas nuevas con las que se arman las pantallas, cada una en los estados que puede tomar. Van de la más
          chica a la más grande: el sello, las marcas, los mini-gráficos y la barra de intervalo, la cifra, el bloque de
          una fuente con su leyenda y las tres fuentes de un mazo.
        </p>
      </div>

      <Piece
        id="sellos"
        title="Sellos"
        what="El sello dice de quién es un número: M, mis partidas; T, torneos; B, bots. Son tres formas, así no depende del color."
      >
        <States>
          <State name="18 px, junto al nombre de la fuente">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {SOURCES.map((source) => (
                <li key={source} className="inline-flex items-center gap-[6px] type-row text-foreground-2">
                  <SourceSeal source={source} />
                  {SOURCE_NAME[source]}
                </li>
              ))}
            </ul>
          </State>
          <State name="16 px, solo: en una celda o en un renglón">
            <div className="flex gap-3">
              {SOURCES.map((source) => (
                <SourceSeal key={source} source={source} size={16} named />
              ))}
            </div>
          </State>
          <State name="La M de una columna larga, más callada">
            <SourceSeal source="matches" size={16} named quiet />
          </State>
          <State name="Con un nombre más exacto que el de su fuente">
            <SourceSeal source="tournament" size={16} label="Torneo, lista exacta" />
          </State>
        </States>
      </Piece>

      <Piece
        id="marcas"
        title="Marcas"
        what="Lo que acompaña a una cifra que hay que leer con cuidado, y lo que va donde no hay cifra."
      >
        <States>
          {KINDS.map((kind) => (
            <State key={kind} name={`Orientativo: ${ORIENTATIVE_BY[kind]}`}>
              <Words>
                <MarkWords mark="orientative" text={orientativeText(kind)} />
              </Words>
            </State>
          ))}
          <State name="Sin cruces con datos">
            <Words>
              <MarkWords mark="coverage" text={NO_COVERAGE} />
            </Words>
          </State>
          <State name="Sin datos">
            <NoData />
          </State>
          <State name="Sin datos, con su motivo">
            <NoData text="sin partidas" />
          </State>
        </States>
      </Piece>

      <Piece
        id="mini-graficos"
        title="Mini-gráficos"
        what="Un punto con su intervalo, una barra contra un máximo y la barra de un récord. Acompañan a un número escrito: no dicen nada que no esté también en palabras."
      >
        <States>
          {/* The point is drawn over the tick of the middle: a state that shows the tick draws a figure away from 50. */}
          <State name="Punto e intervalo sobre 0–100, con la marca del medio">
            <IntervalMark figure={ARCHETYPE} className={CELL} />
            <Words>{figureText(ARCHETYPE)}</Words>
          </State>
          <State name={`Un ${formatRateValue(0)} real: el punto en el extremo`}>
            <IntervalMark figure={LOST_ONCE} className={CELL} />
            <Words>{figureText(LOST_ONCE)}</Words>
          </State>
          <State name={`Un ${formatRateValue(100)}: el punto en el otro extremo`}>
            <IntervalMark figure={WON_TWICE} className={CELL} />
            <Words>{figureText(WON_TWICE)}</Words>
          </State>
          <State name="Sin intervalo: solo el punto">
            <IntervalMark figure={EXPECTED} className={CELL} />
            <Words>{figureText(EXPECTED)}</Words>
          </State>
          <State name="Sin datos: la guía punteada">
            <IntervalMark figure={null} className={CELL} />
            <Words>{figureText(null)}</Words>
          </State>
          <State name={`Escala cortada a ${CUT[0]}–${CUT[1]}, con una referencia`}>
            <IntervalMark figure={MINE} scale={CUT} reference={REFERENCE.value} className={CELL} />
            <Words>
              {figureText(MINE)}; {referenceText(REFERENCE)}
            </Words>
          </State>
          <State name={`Escala cortada a ${CUT[0]}–${CUT[1]}, con la marca del medio pedida`}>
            <IntervalMark figure={FEW} scale={CUT} tick={50} className={CELL} />
            <Words>{figureText(FEW)}</Words>
          </State>
          <State name="Barra contra la mayor de su columna">
            <ul className="grid gap-2">
              {SHARES.map((share) => (
                <li key={share} className="flex items-center gap-3">
                  <BarMark value={share} max={SHARES[0]} className={CELL} />
                  <span className="type-n text-foreground-2">{formatRateValue(share)}</span>
                </li>
              ))}
            </ul>
          </State>
          <State name="Récord, 6 px: al pie de un número">
            <RecordBar segments={recordSegments(RECORDS.mine)} className={CELL} />
            <Words>{formatRecord(RECORDS.mine)}</Words>
          </State>
          <State name="Récord, 12 px: con un renglón propio">
            <RecordBar segments={recordSegments(RECORDS.bots)} size={12} />
            <Words>{formatRecord(RECORDS.bots)}</Words>
          </State>
          <State name="Partes que no son un récord">
            <RecordBar segments={COLLECTION_PARTS} size={12} label={COLLECTION_TEXT} />
            <Words>{COLLECTION_TEXT}</Words>
          </State>
          <State name="Sin nada que contar">
            <RecordBar segments={[]} className={CELL} />
            <Words>sin partidas</Words>
          </State>
        </States>
      </Piece>

      <Piece
        id="barra-de-intervalo"
        title="Barra de intervalo"
        what="El intervalo en grande, para el bloque de una fuente o el resultado de una prueba. A quien no la ve le dice su valor y su intervalo en palabras."
      >
        <States>
          <State name="Sobre 0–100">
            <IntervalBar figure={MINE} />
            <Words>{figureText(MINE)}</Words>
          </State>
          <State name="Con una referencia y sus rótulos">
            <IntervalBar
              figure={FEW}
              reference={REFERENCE}
              above={
                <>
                  <SourceSeal source="matches" size={16} named />
                  <span>vos {formatRateValue(FEW.value)}</span>
                </>
              }
              below={
                <span>
                  {REFERENCE.label} {formatRateValue(REFERENCE.value)}
                </span>
              }
            />
            <Words>{figureText(FEW)}</Words>
          </State>
          <State name={`Escala cortada a ${CUT[0]}–${CUT[1]}, con la marca del medio`}>
            <IntervalBar figure={MINE} scale={CUT} tick={50} />
            <Words>{figureText(MINE)}</Words>
          </State>
          <State name="Con un nombre propio, que dice de quién es">
            <IntervalBar figure={MINE} label={`Mis partidas: ${figureText(MINE)}`} />
            <Words>Mis partidas: {figureText(MINE)}</Words>
          </State>
        </States>
      </Piece>

      <Piece
        id="cifra"
        title="Cifra"
        what="Un porcentaje con su n, en los cuatro tamaños en que se escribe. No hay forma de darle uno sin el otro; sin datos dice «sin datos», nunca un cero."
      >
        <States>
          <State name="Celda de una tabla">
            <FigureValue figure={MINE} size="cell" seal="matches" sealNamed />
          </State>
          <State name="Cabecera de un mazo">
            <FigureValue figure={MINE} size="header" seal="matches" sealNamed />
          </State>
          <State name="Resumen de un mazo">
            <FigureValue figure={MINE} size="hero" seal="matches" sealNamed />
          </State>
          <State name="Número grande, sobre su pie">
            <FigureValue figure={MINE} size="score" />
          </State>
          <State name="Orientativa por partidas">
            <FigureValue figure={FEW} size="cell" seal="matches" sealNamed />
          </State>
          <State name="Orientativa por listas">
            <FigureValue figure={EXACT_LIST} size="cell" seal="tournament" sealNamed />
          </State>
          <State name="Más de 30 partidas en pocas listas: sigue orientativa">
            <FigureValue figure={ARCHETYPE} size="cell" seal="tournament" sealNamed />
          </State>
          <State name="Sin datos">
            <FigureValue figure={null} size="cell" seal="matches" sealNamed />
          </State>
          <State name="Sin datos, con su motivo">
            <FigureValue figure={null} size="cell" seal="matches" sealNamed noData="sin partidas" />
          </State>
          <State name={`Un ${formatRateValue(0)} real, con una partida`}>
            <FigureValue figure={LOST_ONCE} size="cell" seal="matches" sealNamed />
          </State>
          <State name="Sin intervalo y sin cruces con datos">
            <FigureValue figure={EXPECTED} size="cell" seal="tournament" sealNamed />
          </State>
          <State name="De otra era: no se compara con las demás">
            <FigureValue figure={STALE} size="cell" seal="simulation" sealNamed />
          </State>
          <State name="En una tabla ordenada por n">
            <FigureValue figure={MINE} size="cell" seal="matches" sealNamed lead="n" />
          </State>
          <State name="Una celda suelta: un decimal como mucho">
            <FigureValue figure={BOTS} size="cell" seal="simulation" sealNamed decimals="auto" />
          </State>
          <State name="Un decimal fijo, para que una columna se alinee">
            <FigureValue figure={BOTS} size="cell" seal="simulation" sealNamed />
          </State>
          <State name="Un decimal como mucho, fuera de una columna">
            <FigureValue figure={BOTS} size="hero" seal="simulation" sealNamed />
          </State>
        </States>
      </Piece>

      <Piece
        id="bloque"
        title="Bloque de una fuente"
        what="Una fuente entera: el sello, el porcentaje con su n, el intervalo dibujado y escrito, el récord y, en palabras, por qué es orientativa. Es lo que se abre al tocar una fila."
      >
        <States>
          <State name="Con datos">
            <SourceBlock source="matches" name="Mis partidas" figure={MINE} />
          </State>
          <State name="Orientativo por partidas">
            <SourceBlock source="matches" name="Vos contra Gyarados ex" figure={FEW} />
          </State>
          <State name="Orientativo por listas">
            <SourceBlock source="tournament" name="En torneos" figure={ARCHETYPE} />
          </State>
          <State name="Sin datos">
            <SourceBlock source="matches" name="Mis partidas" figure={null} note={NOTES.noMatches} />
          </State>
          <State name={`Una franja sobre una escala cortada a ${CUT[0]}–${CUT[1]}: escribe sus dos extremos`}>
            <SourceBlock source="matches" name="Mis partidas" figure={MINE} size="lane" scale={CUT} />
          </State>
          <State name={`Un ${formatRateValue(0)} real, con una partida`}>
            <SourceBlock source="matches" name="Vos contra Mega-Altaria ex" figure={LOST_ONCE} />
          </State>
          <State name="Sin intervalo y sin cruces con datos">
            <SourceBlock source="tournament" name="Esperable contra el meta" figure={EXPECTED} />
          </State>
          <State name="Con cruces en una parte del meta">
            <SourceBlock source="tournament" name="Esperable contra el meta" figure={COVERED} />
          </State>
          <State name="De otra era">
            <SourceBlock source="simulation" name="Laboratorio: bots g2" figure={STALE} />
          </State>
          <State name="Fuente no disponible">
            <SourceBlock source="tournament" name="Torneo" figure={null} unavailable={NOTES.noTournaments} />
          </State>
          <State name="Con un aviso y su nota">
            <SourceBlock
              source="simulation"
              name="Simulación"
              figure={BOTS}
              warning={NOTES.blindSpot}
              note={NOTES.bots}
            />
          </State>
          <State name="Nombre largo: baja de renglón, no se corta">
            <SourceBlock source="tournament" name={LONG_NAME} figure={EXACT_LIST} />
          </State>
          <State name="Con miles de partidas en muchas listas: el número baja de renglón, el nombre no se aprieta">
            <SourceBlock source="tournament" name="Su arquetipo en torneos" figure={POPULAR} />
          </State>
          <State name="Con una referencia">
            <SourceBlock source="matches" name="Vos contra Gyarados ex" figure={FEW} reference={REFERENCE} />
          </State>
        </States>
      </Piece>

      <Piece
        id="leyenda"
        title="Leyenda"
        what="Una por pantalla: qué es cada sello, qué contó «orientativo» en las cifras que lo llevan y qué intervalo se escribe."
      >
        <States>
          <State name="Al pie de una tarjeta, con todo" flush>
            <SourceLegend sources={SOURCES} bot="g2" marks={{ orientative: KINDS, coverage: true }} />
          </State>
          <State name="Al pie de una vista">
            <SourceLegend sources={SOURCES} marks={{ orientative: ['matches', 'lists'] }} variant="page" />
          </State>
          <State name="De una sola fuente, sin intervalos escritos">
            <SourceLegend sources={['matches']} interval={false} variant="page" />
          </State>
          <State name="Todo orientativo: las cifras sin su marca, y la leyenda lo dice una vez">
            <ul className="grid gap-1.5">
              <li>
                <FigureValue figure={FEW} size="cell" seal="matches" sealNamed marks={false} />
              </li>
              <li>
                <FigureValue figure={LOST_ONCE} size="cell" seal="matches" sealNamed marks={false} />
              </li>
            </ul>
            <SourceLegend sources={['matches']} interval={false} variant="page">
              <span data-key="sentence">{`Todo lo de arriba es ${orientativeText('matches')}.`}</span>
            </SourceLegend>
          </State>
        </States>
      </Piece>

      <Piece
        id="tres-fuentes"
        title="Las tres fuentes de un mazo"
        what="Así queda «Rendimiento» en la ficha de un mazo: un bloque por fuente, nunca un número combinado, y una sola leyenda."
      >
        <Whole name="Con un número en cada fuente">
          <SourceLanes columns={DECK} />
        </Whole>
        <Whole name="Un mazo sin partidas, sin torneos y sin simulación">
          <SourceLanes columns={DECK_EMPTY} label="Tres fuentes de un mazo sin datos" />
        </Whole>
      </Piece>
    </div>
  )
}
