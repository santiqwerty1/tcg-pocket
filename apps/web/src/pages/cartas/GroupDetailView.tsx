import { SlidersHorizontalIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { CardEdition, GroupDetail } from '@/api/schemas'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { WhereToGet } from './WhereToGet'

const EVOLUTION_LABEL: Record<string, string> = {
  basic: 'Básico',
  stage1: 'Fase 1',
  stage2: 'Fase 2',
  supporter: 'Partidario',
  item: 'Objeto',
  tool: 'Herramienta',
  stadium: 'Estadio',
}

const ENERGY_LABEL: Record<string, string> = {
  grass: 'Planta',
  fire: 'Fuego',
  water: 'Agua',
  lightning: 'Rayo',
  psychic: 'Psíquico',
  fighting: 'Lucha',
  darkness: 'Oscuridad',
  metal: 'Metal',
  dragon: 'Dragón',
  colorless: 'Incoloro',
  trainer: 'Entrenador',
}

export function evolutionLabel(type: string): string {
  return EVOLUTION_LABEL[type] ?? type
}

export function energyTypeLabel(type: string): string {
  return ENERGY_LABEL[type] ?? type
}

function costText(cost: readonly string[]): string {
  if (cost.length === 0) return '—'
  return cost.map((c) => energyTypeLabel(c)).join(' + ')
}

/** Rules text as the engine reads it (English), in a monospace block (DECISIONES 0.14). */
export function CardRules({ card }: { card: CardEdition }) {
  const lines: string[] = []
  if (card.ability) lines.push(`[Ability] ${card.ability.name}`, card.ability.effect, '')
  for (const attack of card.attacks) {
    lines.push(`${attack.name}${attack.damage ? `  ${attack.damage}` : ''}  (${costText(attack.cost)})`)
    if (attack.effect) lines.push(attack.effect)
    lines.push('')
  }
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">Sin texto de reglas.</p>
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm leading-snug whitespace-pre-wrap">
      {lines.join('\n').trimEnd()}
    </pre>
  )
}

export function CardFacts({ card }: { card: CardEdition }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-sm">
      <Badge variant="outline">{card.rarity}</Badge>
      <Badge variant="outline">{card.cardType === 'pokemon' ? 'Pokémon' : 'Entrenador'}</Badge>
      <Badge variant="outline">{evolutionLabel(card.evolutionType)}</Badge>
      {card.energy && card.energy !== 'trainer' ? (
        <Badge variant="outline">{energyTypeLabel(card.energy)}</Badge>
      ) : null}
      {card.hp ? <Badge variant="outline">{card.hp} PS</Badge> : null}
      {card.ex ? <Badge>ex</Badge> : null}
      {card.cardType === 'pokemon' ? (
        <Badge variant="secondary">
          {card.prizePoints} {card.prizePoints === 1 ? 'punto' : 'puntos'} en juego
        </Badge>
      ) : null}
      {card.weakness ? <Badge variant="outline">debilidad {energyTypeLabel(card.weakness)}</Badge> : null}
      {card.retreat !== null && card.retreat !== undefined ? (
        <Badge variant="outline">retirada {card.retreat}</Badge>
      ) : null}
    </div>
  )
}

/** Playable copies, editions table, decks that use the group and the «crear ajuste» action. */
export function GroupDetailView({ group, highlightCardId }: { group: GroupDetail; highlightCardId?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <div className="text-sm text-muted-foreground">Copias jugables</div>
          <div className="text-3xl font-semibold tabular">{group.playable}</div>
          <div className="text-xs text-muted-foreground">
            stock {group.fromStock}
            {group.adjustment ? ` · ajuste ${group.adjustment.playableCopies} («${group.adjustment.reason}»)` : ''}
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link to={`/coleccion/ajustes?grupo=${encodeURIComponent(group.id)}`}>
            <SlidersHorizontalIcon data-icon="inline-start" />
            {group.adjustment ? 'Ver ajuste' : 'Crear ajuste'}
          </Link>
        </Button>
      </div>

      <Section title={`Ediciones (${group.editions.length})`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Rareza</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Col.</TableHead>
              <TableHead>Gemelas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.editions.map((edition) => {
              const twins = edition.twinCardIds.filter((id) => id !== edition.card.id)
              return (
                <TableRow key={edition.card.id} className={cn(edition.card.id === highlightCardId && 'bg-muted/60')}>
                  <TableCell>
                    <Link to={`/cartas/${encodeURIComponent(edition.card.id)}`} className="font-mono hover:underline">
                      {edition.card.id}
                    </Link>
                    {edition.card.isDisplayEdition ? (
                      <span className="ml-1 text-xs text-muted-foreground">★</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{edition.card.rarity}</TableCell>
                  <TableCell className="text-right tabular">{edition.owned}</TableCell>
                  <TableCell>{edition.collected ? '✓' : '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{twins.join(', ') || '—'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          ★ edición que se usa al armar mazos. Las gemelas comparten el stock.
        </p>
      </Section>

      <WhereToGet group={group} />

      <Section title={`Mazos que la usan (${group.decks.length})`}>
        {group.decks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ningún mazo usa esta carta.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {group.decks.map((deck) => (
              <li key={deck.id}>
                <Link
                  to={`/mazos/${encodeURIComponent(deck.id)}`}
                  className="flex min-h-12 items-center gap-2 px-3 py-2 hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{deck.name}</span>
                  {deck.builtInGame ? <Badge variant="secondary">en el juego</Badge> : null}
                  <span className="tabular">×{deck.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
