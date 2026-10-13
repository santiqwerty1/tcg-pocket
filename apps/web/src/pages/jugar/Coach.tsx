/**
 * Modo entrenador (Fase 20): what the engine thought of each of your choices. It plays every option 12 times to the
 * end of your turn (your deck shuffled: it does not know the order either) and scores the table like the bots do; a
 * prize point weighs 10.000, a Pokémon ready to attack 500. A hint for learning, not a verdict.
 */
import type { CoachReview, CoachSummary, CoachVerdict, LiveGame } from '@/api/schemas'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { PERCENT } from '@/lib/format'
import type { ReplayReader, ReplayState } from '@/lib/replay'
import { cn } from '@/lib/utils'

export const VERDICT_ES: Record<CoachVerdict, string> = {
  best: 'Como el entrenador',
  close: 'Casi igual',
  inaccuracy: 'Un poco peor',
  mistake: 'Peor',
  blunder: 'Error grave',
}

const TONE: Record<CoachVerdict, string> = {
  best: 'border-success/50 text-success',
  close: 'border-success/50 text-success',
  inaccuracy: 'border-warning/50 text-warning',
  mistake: 'border-destructive/50 text-destructive',
  blunder: 'border-destructive text-destructive',
}

const NOTE =
  'El entrenador prueba cada opción 12 veces hasta el final de tu turno (con tu mazo mezclado: tampoco sabe qué viene) y mira cómo queda la mesa, como los bots del motor. Es una pista para aprender, no un veredicto.'

/** Names an option of a review like the game's log does. */
function describe(reader: ReplayReader, review: CoachReview, which: 'chosen' | 'best'): string {
  const action = which === 'chosen' ? review.chosenAction : review.bestAction
  const text = which === 'chosen' ? review.chosenText : review.bestText
  const ctx = review.ctx ?? { in_play: [[], []], stadium: null }
  const slot = (card: string | null) =>
    card ? { card, hp: 0, max_hp: 0, energy: [], tools: [], status: [], played_this_turn: false } : null
  const player = (cards: (string | null)[] | undefined) => ({
    hand: [],
    hand_count: 0,
    deck_count: 0,
    discard: [],
    discard_energies: [],
    energy_zone: { current: null, next: null },
    in_play: (cards ?? []).map(slot),
  })
  const state: ReplayState = {
    turn: review.turn,
    current_player: 0,
    points: [0, 0],
    winner: null,
    players: [player(ctx.in_play[0]), player(ctx.in_play[1])],
    stadium: ctx.stadium,
  }
  return reader.describe(action ?? text, state, 0, text)
}

export function VerdictBadge({ verdict }: { verdict: CoachVerdict }) {
  return (
    <Badge variant="outline" className={cn('shrink-0', TONE[verdict])}>
      {VERDICT_ES[verdict]}
    </Badge>
  )
}

function ReviewLine({ review, reader }: { review: CoachReview; reader: ReplayReader }) {
  const same = review.verdict === 'best'
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground">{review.turn === 0 ? 'Inicio' : `Turno ${review.turn}`}: </span>
          {describe(reader, review, 'chosen')}
        </span>
        <VerdictBadge verdict={review.verdict} />
      </div>
      {same ? null : (
        <p className="text-xs text-muted-foreground">
          El entrenador: {describe(reader, review, 'best')} · {review.rank}.ª de {review.options} opciones
          {review.hinted ? ' · habías pedido la pista' : ''}
        </p>
      )}
    </div>
  )
}

/** Your last choice and what the coach thought of it. */
export function CoachLast({ game, reader }: { game: LiveGame; reader: ReplayReader }) {
  const last = game.coachReviews.at(-1)
  if (!last) return null
  return (
    <div className="rounded-lg border px-3 py-2" role="status">
      <p className="pb-1 text-xs font-medium text-muted-foreground">Tu última jugada</p>
      <ReviewLine review={last} reader={reader} />
    </div>
  )
}

export function CoachSummarySection({
  summary,
  reader,
  final,
}: {
  summary: CoachSummary
  reader: ReplayReader
  final: boolean
}) {
  const verdicts = Object.keys(VERDICT_ES) as CoachVerdict[]
  return (
    <Section title={final ? 'Entrenador: resumen de la partida' : 'Entrenador: hasta ahora'}>
      <p className="text-sm">
        Jugaste como el entrenador (o casi) en {summary.counts.best + summary.counts.close} de {summary.decisions}{' '}
        {summary.decisions === 1 ? 'decisión' : 'decisiones'} ({Math.round(summary.agreement)}
        {PERCENT}){summary.hints > 0 ? `; pediste ${summary.hints} ${summary.hints === 1 ? 'pista' : 'pistas'}` : ''}.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {verdicts
          .filter((verdict) => (summary.counts[verdict] ?? 0) > 0)
          .map((verdict) => (
            <Badge key={verdict} variant="outline" className={TONE[verdict]}>
              {VERDICT_ES[verdict]}: {summary.counts[verdict]}
            </Badge>
          ))}
      </div>
      {summary.worst.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Las jugadas que más costaron</p>
          {summary.worst.map((review) => (
            <ReviewLine key={review.ply} review={review} reader={reader} />
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{NOTE}</p>
    </Section>
  )
}
