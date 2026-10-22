/**
 * Jugar contra un bot (Fase 8): pick your deck, the bot's deck (one of yours or an archetype of the meta) and how
 * strong the bot is; the game runs on the PC and you play it from here, or (T-015) in this very browser with the
 * engine in WebAssembly, without the PC. Below, the games so far.
 */
import { SwordsIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDecks } from '@/api/decks'
import { useLabBank } from '@/api/lab'
import { useCreateGame, usePlayGames } from '@/api/play'
import { usePuzzles } from '@/api/puzzles'
import type { LiveGameItem, LiveGameRunner, PlaySource } from '@/api/schemas'
import { useEngineInfo } from '@/api/simulations'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Field, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { browserCanRunEngine, useBrowserEngine } from '@/engine/browserEngine'
import { formatDateTime } from '@/lib/format'
import { formatShare } from '@/lib/tournaments'
import { RecentListPicker } from './RecentListPicker'

const BOTS = [
  { code: 'e2', label: 'Normal (expectiminimax 2)' },
  { code: 'e3', label: 'Fuerte (expectiminimax 3, piensa más)' },
  // T-021: it does not see your hand or the order of your deck, as a person would play.
  { code: 'g2', label: 'Sin trampa (g2: no ve tu mano ni tu mazo)' },
  { code: 'v', label: 'Simple (función de valor)' },
  { code: 'r', label: 'Al azar' },
] as const

const STATUS: Record<LiveGameItem['status'], string> = {
  queued: 'esperando a la PC',
  running: 'juega el bot',
  waiting: 'tu turno',
  done: 'terminada',
  abandoned: 'abandonada',
  failed: 'falló',
  engine_changed: 'terminada porque cambió el motor',
}

function resultLabel(game: LiveGameItem): string {
  if (game.status !== 'done') return STATUS[game.status]
  return game.winner === 'you' ? 'ganaste' : game.winner === 'bot' ? 'perdiste' : 'empate'
}

function GamesList() {
  const games = usePlayGames()
  if (games.isLoading) return <LoadingRows rows={3} />
  if (games.isError) return <ErrorState error={games.error} onRetry={() => void games.refetch()} />
  if (!games.data || games.data.length === 0) {
    return <EmptyState title="Todavía no jugaste" description="Tus partidas contra el bot aparecen acá." />
  }
  return (
    <ul className="divide-y rounded-lg border">
      {games.data.map((game) => (
        <li key={game.id}>
          <Link to={`/jugar/${game.id}`} className="flex flex-col gap-1 px-3 py-2.5 hover:bg-muted">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {game.human} <span className="text-muted-foreground">contra</span> {game.rival}
              </span>
              <Badge variant={game.status === 'waiting' ? 'default' : 'outline'}>{resultLabel(game)}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              #{game.id} · bot {game.botEs}
              {game.runner === 'browser' ? ' · en el navegador' : ''}
              {game.coach ? ' · entrenador' : ''} · {formatDateTime(game.createdAt)}
              {game.turns ? ` · ${game.turns} turnos` : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Fase 24: the situations to solve from your games with the coach. */
function PuzzlesLink() {
  const puzzles = usePuzzles()
  const counts = puzzles.data?.counts
  return (
    <Section title="Para practicar">
      <Link
        to="/jugar/situaciones"
        className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted"
      >
        <span className="min-w-0 flex-1">
          {counts && counts.total > 0
            ? `${counts.pending} para resolver · ${counts.solved} resueltas`
            : 'Tus errores de las partidas con entrenador, para volver a jugarlos'}
        </span>
        <span className="text-primary">Ver</span>
      </Link>
      <Link
        to="/jugar/ejercicios"
        className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted"
      >
        <span className="min-w-0 flex-1">
          Ejercicios de cálculo: ¿qué tan probable es robarla? ¿llega al KO? Con tus mazos.
        </span>
        <span className="text-primary">Practicar</span>
      </Link>
    </Section>
  )
}

export function JugarPage() {
  const navigate = useNavigate()
  const decks = useDecks({ archived: false })
  const bank = useLabBank(15)
  const engine = useEngineInfo()
  const create = useCreateGame()
  const [mine, setMine] = useState('')
  // Fase 23: «Jugar contra esta lista» from Torneos arrives as ?lista=&era=&formato=.
  const [search] = useSearchParams()
  const [rivalKind, setRivalKind] = useState<'meta' | 'list' | 'deck'>(search.get('lista') ? 'list' : 'meta')
  const [rival, setRival] = useState(search.get('lista') ?? '')
  const [listScope, setListScope] = useState<{ era?: string; format?: string }>({
    ...(search.get('era') ? { era: search.get('era') as string } : {}),
    ...(search.get('formato') ? { format: search.get('formato') as string } : {}),
  })
  const [bot, setBot] = useState('e2')
  const [coach, setCoach] = useState(false)
  const online = (engine.data?.workers ?? []).some((worker) => worker.online)
  // T-015: where the bot plays. Until the owner picks, this device when no worker is on and it has the engine.
  const browserEngine = useBrowserEngine()
  const canBrowser = Boolean(browserEngine.data)
  const [picked, setPicked] = useState<LiveGameRunner | null>(null)
  const runner: LiveGameRunner = canBrowser ? (picked ?? (online ? 'worker' : 'browser')) : 'worker'

  const rivalSource: PlaySource | null = rival
    ? rivalKind === 'deck'
      ? { deckId: rival }
      : rivalKind === 'list'
        ? {
            listKey: rival,
            ...(listScope.era ? { era: listScope.era } : {}),
            ...(listScope.format ? { format: listScope.format as 'STANDARD' | 'NOEX' } : {}),
          }
        : { listKey: rival, ...(bank.data ? { era: bank.data.era } : {}) }
    : null

  async function start() {
    if (!mine || !rivalSource) return
    try {
      const game = await create.mutateAsync({
        human: { deckId: mine },
        rival: rivalSource,
        bot,
        coach,
        ...(runner === 'browser' && browserEngine.data
          ? {
              runner,
              engineRev: browserEngine.data.engineRev,
              gamesRev: browserEngine.data.gamesRev,
              build: browserEngine.data.build,
            }
          : {}),
      })
      navigate(`/jugar/${game.id}`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title="Nueva partida">
        {canBrowser ? (
          <Field label="Dónde juega el bot">
            <Tabs value={runner} onValueChange={(value) => setPicked(value as LiveGameRunner)}>
              <TabsList className="w-full">
                <TabsTrigger value="worker">En la PC</TabsTrigger>
                <TabsTrigger value="browser">En este dispositivo</TabsTrigger>
              </TabsList>
            </Tabs>
          </Field>
        ) : null}
        {runner === 'browser' ? (
          <p className="text-sm text-muted-foreground">
            El bot juega acá mismo con el motor deckgym (sin la PC) mientras la pantalla de la partida esté abierta; si
            la cerrás, sigue donde quedó cuando la abras. La partida se termina en el navegador: no pasa a la PC.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            La partida corre en la PC con el motor deckgym; desde acá ves la mesa y elegís cada jugada. Si la PC se
            apaga, sigue donde quedó cuando se prenda.
          </p>
        )}
        {!browserCanRunEngine() ? (
          <p className="text-xs text-muted-foreground">
            Este navegador no puede jugar el bot sin la PC (le falta WebAssembly): las partidas se juegan en la PC.
          </p>
        ) : null}
        {runner === 'worker' && !online ? (
          <p className="text-xs text-warning">
            Ningún worker en línea: podés empezarla igual, arranca cuando prendas la PC
            {canBrowser ? ', o jugarla en este dispositivo' : ''}.
          </p>
        ) : null}
        <Field label="Tu mazo">
          <Select value={mine} onValueChange={setMine}>
            <SelectTrigger aria-label="Tu mazo" className="w-full">
              <SelectValue placeholder="Elegí un mazo" />
            </SelectTrigger>
            <SelectContent>
              {(decks.data ?? []).map((deck) => (
                <SelectItem key={deck.id} value={deck.id}>
                  {deck.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="El mazo del bot">
          <Tabs
            value={rivalKind}
            onValueChange={(value) => {
              setRivalKind(value as 'meta' | 'list' | 'deck')
              setRival('')
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="meta">Arquetipo</TabsTrigger>
              <TabsTrigger value="list">Lista de torneo</TabsTrigger>
              <TabsTrigger value="deck">Mis mazos</TabsTrigger>
            </TabsList>
          </Tabs>
          {rivalKind === 'list' ? (
            <RecentListPicker
              value={rival}
              onChange={(listKey, era, format) => {
                setRival(listKey)
                setListScope({ era, format })
              }}
            />
          ) : (
            <Select value={rival} onValueChange={setRival}>
              <SelectTrigger aria-label="El mazo del bot" className="w-full">
                <SelectValue placeholder={rivalKind === 'meta' ? 'Elegí un arquetipo' : 'Elegí un mazo'} />
              </SelectTrigger>
              <SelectContent>
                {rivalKind === 'meta'
                  ? (bank.data?.rivals ?? []).map((item) => (
                      <SelectItem key={item.listKey} value={item.listKey}>
                        {item.archetypeName} ({formatShare(item.share)})
                      </SelectItem>
                    ))
                  : (decks.data ?? []).map((deck) => (
                      <SelectItem key={deck.id} value={deck.id}>
                        {deck.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Bot">
          <Select value={bot} onValueChange={setBot}>
            <SelectTrigger aria-label="Bot" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOTS.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Label className="flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3">
          <span>
            <span className="block font-medium">Modo entrenador</span>
            <span className="block text-xs text-muted-foreground">
              Después de cada jugada te dice qué habría hecho el motor y cuánto se pierde; podés pedir una pista.
            </span>
          </span>
          <Switch checked={coach} onCheckedChange={setCoach} />
        </Label>
        <Button type="button" disabled={!mine || !rivalSource || create.isPending} onClick={() => void start()}>
          <SwordsIcon aria-hidden="true" />
          Empezar
        </Button>
      </Section>
      <PuzzlesLink />
      <Section title="Partidas">
        <GamesList />
      </Section>
    </div>
  )
}
