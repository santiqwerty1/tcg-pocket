/**
 * Calculadora de mano (Fase 10): the same odds as a deck's «Mano inicial», from counts typed by hand — how many Basic
 * Pokémon the deck has and how many copies of the card (or of two cards). For «¿1 o 2 copias?» before building.
 */
import { useState } from 'react'
import { useManualDrawOdds } from '@/api/decks'
import { DrawOddsTable } from '@/components/DrawOddsTable'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Stepper } from '@/components/Stepper'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface Piece {
  copies: number
  basic: boolean
}

function PieceInput({ title, piece, onChange }: { title: string; piece: Piece; onChange: (next: Piece) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <span className="text-sm font-medium">{title}</span>
      <div className="flex flex-wrap items-center gap-4">
        <Stepper
          label={`Copias de ${title.toLowerCase()}`}
          value={piece.copies}
          min={1}
          max={2}
          onChange={(copies) => onChange({ ...piece, copies })}
        />
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={piece.basic} onCheckedChange={(basic) => onChange({ ...piece, basic })} />
          Es un Pokémon Básico
        </Label>
      </div>
    </div>
  )
}

export function HandCalculatorPage() {
  const [basics, setBasics] = useState(5)
  const [first, setFirst] = useState<Piece>({ copies: 2, basic: true })
  const [useSecond, setUseSecond] = useState(false)
  const [second, setSecond] = useState<Piece>({ copies: 2, basic: false })
  const pieces = useSecond ? [first, second] : [first]
  const neededBasics = pieces.reduce((sum, piece) => sum + (piece.basic ? piece.copies : 0), 0)
  const effectiveBasics = Math.max(basics, neededBasics, 1)
  const odds = useManualDrawOdds({
    basics: effectiveBasics,
    groups: pieces.map((piece) =>
      piece.basic ? { basic: piece.copies, other: 0 } : { basic: 0, other: piece.copies },
    ),
  })

  return (
    <div className="flex flex-col gap-4">
      <Section title="Calculadora de mano">
        <p className="text-sm text-muted-foreground">
          Mazo de 20 cartas. Cuántos Pokémon Básicos tiene y cuántas copias de la carta que querés: la chance de tenerla
          en la mano inicial y en cada turno. Para la lista de un mazo guardado, mirá «Mano inicial» en su ficha.
        </p>
        <div className="flex items-center gap-3">
          <Stepper label="Pokémon Básicos en el mazo" value={basics} min={1} max={20} onChange={setBasics} />
          <span className="text-sm">Pokémon Básicos en el mazo</span>
        </div>
        {effectiveBasics !== basics ? (
          <p className="text-xs text-warning">
            Se cuentan {effectiveBasics}: las cartas Básicas de abajo son parte de ellos.
          </p>
        ) : null}
        <PieceInput title="Carta" piece={first} onChange={setFirst} />
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={useSecond} onCheckedChange={setUseSecond} />Y otra carta a la vez
        </Label>
        {useSecond ? <PieceInput title="Otra carta" piece={second} onChange={setSecond} /> : null}
      </Section>
      {odds.isPending ? <LoadingRows rows={4} /> : null}
      {odds.isError ? <ErrorState error={odds.error} onRetry={() => odds.refetch()} /> : null}
      {odds.data ? <DrawOddsTable data={odds.data} labels={useSecond ? ['Carta', 'Otra carta'] : ['Carta']} /> : null}
    </div>
  )
}
