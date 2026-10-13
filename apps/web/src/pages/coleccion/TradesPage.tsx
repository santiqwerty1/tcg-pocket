/**
 * Lista de intercambio (Fase 31): by rarity (trades are one card for another of the same rarity), what the decks
 * lack and what the collection has to spare, and the text to paste in a chat for the rarities picked.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CopyIcon, Share2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { request } from '@/api/client'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const giveSchema = z.object({
  cardId: z.string(),
  groupId: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  rarity: z.string(),
  owned: z.number(),
  spare: z.number(),
})
const wantSchema = z.object({
  groupId: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  missing: z.number(),
  decks: z.array(z.string()),
  options: z.array(z.object({ cardId: z.string(), rarity: z.string() })),
})
const tradesSchema = z.object({
  byRarity: z.array(z.object({ rarity: z.string(), wants: z.array(wantSchema), gives: z.array(giveSchema) })),
  untradeable: z.array(
    z.object({ groupId: z.string(), nameEs: z.string(), missing: z.number(), decks: z.array(z.string()) }),
  ),
  rarities: z.array(z.string()),
  text: z.string(),
  totals: z.object({ wants: z.number(), gives: z.number(), spare: z.number() }),
})

/** Spares shown per rarity before «Ver todas». */
const SHOWN = 12

function useTrades(rarities: string[] | null) {
  return useQuery({
    queryKey: ['trades', rarities?.join(',') ?? ''] as const,
    queryFn: ({ signal }) =>
      request('/api/trades', { query: { rarities: rarities?.join(',') }, schema: tradesSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

export function TradesPage() {
  const [picked, setPicked] = useState<string[] | null>(null)
  const trades = useTrades(picked)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const data = trades.data
  const chosen = picked ?? data?.rarities ?? []

  function toggle(rarity: string) {
    const next = chosen.includes(rarity) ? chosen.filter((item) => item !== rarity) : [...chosen, rarity]
    setPicked(next.length > 0 ? next : chosen)
  }

  async function copy() {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.text)
      toast.success('Lista copiada')
    } catch {
      toast.error('No se pudo copiar; mantené apretado el texto para copiarlo.')
    }
  }

  async function share() {
    if (!data) return
    try {
      await navigator.share({ text: data.text })
    } catch {
      // Cancelled or not available: nothing to do.
    }
  }

  if (trades.isPending) return <LoadingRows rows={6} />
  if (trades.isError) return <ErrorState error={trades.error} onRetry={() => trades.refetch()} />
  if (!data) return null
  const rows = data.byRarity.filter((row) => chosen.includes(row.rarity))

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Un cambio es carta por carta de la misma rareza.{' '}
        {/* Phone review: these are the cards your decks lack, not the collection (which may lack hundreds). */}
        {data.totals.wants === 1
          ? 'A tus mazos les falta 1 carta que se puede intercambiar'
          : `A tus mazos les faltan ${formatNumber(data.totals.wants)} cartas que se pueden intercambiar`}
        ; te sobran {data.totals.spare} copias (guardando una de cada edición y 2 de cada carta).
      </p>
      <fieldset className="flex flex-wrap gap-1.5" aria-label="Rarezas">
        {data.byRarity.map((row) => (
          <Button
            key={row.rarity}
            size="sm"
            variant={chosen.includes(row.rarity) ? 'default' : 'outline'}
            aria-pressed={chosen.includes(row.rarity)}
            onClick={() => toggle(row.rarity)}
          >
            {row.rarity}
            <span className="text-xs opacity-80">
              {row.wants.length > 0 ? `${row.wants.length} busco · ` : ''}
              {row.gives.length} doy
            </span>
          </Button>
        ))}
      </fieldset>

      {rows.length === 0 ? <EmptyState title="Nada en esas rarezas" description="Elegí otras arriba." /> : null}
      {rows.map((row) => {
        const all = open.has(row.rarity)
        return (
          <Section key={row.rarity} title={row.rarity}>
            {row.wants.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-muted-foreground">Busco</h3>
                <ul className="divide-y rounded-lg border">
                  {row.wants.map((want) => (
                    <li key={want.groupId} className="px-3 py-2 text-sm">
                      <Link to={`/cartas/${encodeURIComponent(want.groupId)}`} className="font-medium hover:underline">
                        {want.nameEs}
                      </Link>
                      {want.missing > 1 ? ` ×${want.missing}` : ''}
                      <span className="block text-xs text-muted-foreground">
                        {want.options
                          .filter((option) => option.rarity === row.rarity)
                          .map((option) => option.cardId)
                          .join(', ')}{' '}
                        · para {want.decks.join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-muted-foreground">Doy</h3>
              {row.gives.length === 0 ? (
                <p className="text-sm text-muted-foreground">No te sobra nada de esta rareza.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {(all ? row.gives : row.gives.slice(0, SHOWN)).map((give) => (
                    <li key={give.cardId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <Link
                        to={`/cartas/${encodeURIComponent(give.cardId)}`}
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        {give.nameEs} <span className="text-xs text-muted-foreground">{give.cardId}</span>
                      </Link>
                      <span className={cn('tabular text-xs', give.spare > 1 && 'font-semibold')}>×{give.spare}</span>
                    </li>
                  ))}
                </ul>
              )}
              {row.gives.length > SHOWN ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    setOpen((current) => {
                      const next = new Set(current)
                      if (all) next.delete(row.rarity)
                      else next.add(row.rarity)
                      return next
                    })
                  }
                >
                  {all ? 'Ver menos' : `Ver las ${row.gives.length}`}
                </Button>
              ) : null}
            </div>
          </Section>
        )
      })}

      {data.untradeable.length > 0 ? (
        <Section title="Faltan y no se intercambian">
          <p className="text-sm text-muted-foreground">Solo salen de sobres, la tienda o eventos.</p>
          <ul className="text-sm">
            {data.untradeable.map((row) => (
              <li key={row.groupId}>
                {row.nameEs}
                {row.missing > 1 ? ` ×${row.missing}` : ''} · para {row.decks.join(', ')}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title="Para pegar en un chat"
        action={
          <div className="flex gap-1">
            {typeof navigator.share === 'function' ? (
              <Button variant="outline" size="sm" onClick={share}>
                <Share2Icon data-icon="inline-start" />
                Compartir
              </Button>
            ) : null}
            <Button size="sm" onClick={copy}>
              <CopyIcon data-icon="inline-start" />
              Copiar
            </Button>
          </div>
        }
      >
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs">
          {data.text}
        </pre>
      </Section>
    </div>
  )
}
