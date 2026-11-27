/**
 * The three sources of a deck's comparison (mock-up D, «Tres fuentes»): own matches, tournaments and bots, one under
 * the other and never added up, each under its seal, and the one legend of the three. It is given the columns of the
 * API's answer and asks for nothing: the deck's «Rendimiento» brings them, and «Piezas de la interfaz» draws the same
 * thing with test data.
 */
import type { ReactNode } from 'react'
import type { ComparisonColumn } from '@/api/schemas'
import { SourceBlock } from '@/components/figures/SourceBlock'
import { SourceLegend } from '@/components/figures/SourceLegend'
import { RateRows } from '@/components/RateSummary'
import { figureFromColumn } from '@/lib/figure'

/**
 * One source of the comparison, with everything in sight: the percentage, the interval drawn on 0–100 and written,
 * the n and the record. What the API says of the number is its note; when the source has no number to give, the same
 * text is the reason, and the block takes its dashed edge.
 *
 * A column that brings rows (the tournament one: the exact list, the archetype) has them inside its block, under
 * «Torneo, en detalle», and what the screen adds to that column (`children`: the choice of the deck's archetype) goes
 * under them. The rows are drawn here, by the same source that counts them for the legend, so the legend never
 * explains an «orientativo» that is not on the card.
 */
export function SourceLane({
  column,
  children,
}: {
  column: ComparisonColumn
  /** More of this source, under its rows. Nothing at all when the screen has nothing to add. */
  children?: ReactNode
}) {
  const rows = column.rows ?? []
  return (
    <SourceBlock
      source={column.source}
      name={column.label}
      figure={figureFromColumn(column)}
      size="lane"
      {...(column.available ? { note: column.note } : { unavailable: column.note })}
      // H-055: «posible punto ciego del bot», right under the figures of the bots.
      warning={column.source === 'simulation' ? column.blindSpot?.text : undefined}
    >
      {rows.length > 0 || children ? (
        <div className="flex flex-col gap-1.5 pt-1.5">
          <h3 className="text-sm font-medium">{column.label}, en detalle</h3>
          {rows.length > 0 ? (
            <RateRows
              rows={rows.map((row) => ({
                id: row.label,
                // The name of an archetype whole, on a second line if it takes one: inside the block a row is
                // narrower than a row of the page, and the list would cut the name with «…».
                label: <span className="wrap-anywhere whitespace-normal">{row.label}</span>,
                hint: row.note,
                record: row.record,
                rate: row.rate,
              }))}
            />
          ) : null}
          {children}
        </div>
      ) : null}
    </SourceBlock>
  )
}

export function SourceLanes({
  columns,
  lane,
  label = 'Tres fuentes, nunca mezcladas',
}: {
  /** The columns of `GET /api/decks/:id/comparison`, in the order they are drawn. */
  columns: readonly ComparisonColumn[]
  /**
   * A column the screen draws itself, as a `SourceLane` with what it adds (the tournament one, with the choice of
   * the deck's archetype); nothing to draw it as it comes.
   */
  lane?: (column: ComparisonColumn) => ReactNode
  /** The name of the region, for a page that draws more than one. */
  label?: string
}) {
  // Every rate a lane writes: the headline of each source and the rows of the ones that bring them (`SourceLane`
  // draws both). The legend says what «orientativo» counted in the ones that carry it, and which interval is
  // written when there is one.
  const rates = columns.flatMap((column) => [column.rate, ...(column.rows ?? []).map((row) => row.rate)])
  const written = rates.filter((rate) => rate !== null)
  return (
    <section aria-label={label} className="overflow-hidden rounded-lg border bg-card">
      {columns.map((column) => (
        // The padding and the line of a lane are of what holds the block: a block with no source draws its own box.
        <div key={column.source} className="border-t px-[14px] py-3 first:border-t-0">
          {lane?.(column) ?? <SourceLane column={column} />}
        </div>
      ))}
      <SourceLegend
        sources={columns.map((column) => column.source)}
        marks={{ orientative: written.filter((rate) => rate.orientative).map((rate) => rate.sampleKind) }}
        interval={written.length > 0}
      />
    </section>
  )
}
