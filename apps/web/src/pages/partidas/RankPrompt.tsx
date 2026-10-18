/**
 * «¿Cambiaste de rango?» (14/10): after a competitive match in a ranked season, one tap notes the rank after it — up
 * after a win, down after a loss (this season loses no points, but others may), or «sigo igual» to dismiss. Without a
 * rank noted in the season yet, it asks which one.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { neighbourRanks, useAddRank, useRanked } from '@/api/ranked'
import type { MatchResult } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import { RankPicker } from './SeasonPage'

export function RankPrompt({ result, onDone }: { result: MatchResult; onDone: () => void }) {
  const ranked = useRanked()
  const add = useAddRank()
  const [busy, setBusy] = useState(false)
  const current = ranked.data?.current
  if (!current || !ranked.data) return null
  const rank = current.rank
  const { up, down } = neighbourRanks(ranked.data.ranks, rank?.rank ?? null)
  const next = result === 'win' ? up : result === 'loss' ? down : null
  async function note(code: string) {
    setBusy(true)
    try {
      const noted = await add.mutateAsync({ rank: code })
      toast.success(`Anotado: ${noted.label}.`)
      onDone()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-sm" aria-label="¿Cambiaste de rango?">
      <p className="font-medium">
        {rank ? `¿Cambiaste de rango? Estás en ${rank.label}.` : `¿En qué rango estás en ${current.name}?`}
      </p>
      {rank ? (
        <div className="flex flex-wrap gap-2">
          {next ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => note(next.code)}>
              {result === 'win' ? `Subí a ${next.label}` : `Bajé a ${next.label}`}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Sigo en {rank.label}
          </Button>
          <Button type="button" variant="link" size="sm" asChild>
            <Link to="/partidas/temporada">Otro…</Link>
          </Button>
        </div>
      ) : (
        <RankPicker ranks={ranked.data.ranks} current={null} onDone={onDone} />
      )}
    </fieldset>
  )
}
