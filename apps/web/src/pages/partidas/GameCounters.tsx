/**
 * «Según el juego» (2/11/2026): the game's own battle counters, read by pokemon-zone, next to the matches logged in the
 * app — never added up with them. Lifetime, and between the two latest imports: how many the game counted and how
 * many were logged, so Santi sees what he did not log. Versus (against people) includes the competitive ones, so it
 * is compared with every logged match, and competitive with the competitive ones.
 */
import { Link } from 'react-router'
import { type LoggedComparison, type PokemonZoneSummary, usePokemonZone } from '@/api/pokemonZone'
import { Section } from '@/components/Section'
import { formatDate, formatDateTime, formatNumber, plural } from '@/lib/format'
import { gameRateText } from '@/lib/pokemonZone'

const KIND = {
  ranked: ['competitiva', 'competitivas'],
  versus: ['partida contra personas', 'partidas contra personas'],
} as const

/** «jugaste 3 competitivas y registraste 1: te faltan 2»; «jugaste 1 competitiva y registraste 1: está». */
function comparisonText(row: LoggedComparison): string {
  const [one, many] = KIND[row.kind]
  const played = `jugaste ${plural(row.game, one, many)}`
  const logged = `registraste ${formatNumber(row.logged)}`
  if (row.notLogged === 0) return `${played} y ${logged}: ${row.game === 1 ? 'está' : 'están todas'}`
  return `${played} y ${logged}: ${row.notLogged === 1 ? 'te falta 1' : `te faltan ${formatNumber(row.notLogged)}`}`
}

function Counters({ data }: { data: PokemonZoneSummary }) {
  const latest = data.latest
  const battles = data.battles
  if (!latest || !battles) return null
  const { game, logged, window } = battles
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-muted-foreground">
        Contadores del juego leídos por pokemon-zone el {formatDateTime(latest.syncedAt)}: de por vida y aparte de tus
        partidas registradas (no se suman). El juego no cuenta los empates aparte: el porcentaje es victorias sobre
        partidas.
      </p>
      <ul className="divide-y rounded-lg border">
        <li className="flex flex-col gap-0.5 px-3 py-2">
          <span className="font-medium">Competitivas</span>
          <span>{gameRateText(game.ranked)}</span>
          {game.rankedPoints !== null ? (
            <span className="text-xs text-muted-foreground">
              {plural(game.rankedPoints, 'punto ganado', 'puntos ganados')}
            </span>
          ) : null}
          {/* Review of pz/import: up to the read, as the game's counters (Estadísticas counts until now). */}
          <span className="text-xs text-muted-foreground">
            En la app, hasta el {formatDateTime(latest.syncedAt)}:{' '}
            {plural(logged.competitive, 'competitiva registrada', 'competitivas registradas')}
          </span>
        </li>
        <li className="flex flex-col gap-0.5 px-3 py-2">
          <span className="font-medium">Versus (contra personas, competitivas incluidas)</span>
          <span>{gameRateText(game.versus)}</span>
          <span className="text-xs text-muted-foreground">
            En la app, hasta el {formatDateTime(latest.syncedAt)}:{' '}
            {plural(logged.all, 'partida registrada', 'partidas registradas')}
            {logged.firstAt ? ` (la primera, del ${formatDate(logged.firstAt)})` : ''}
          </span>
        </li>
        <li className="flex flex-col gap-0.5 px-3 py-2">
          <span className="font-medium">Solo (contra la CPU)</span>
          <span>{gameRateText(game.solo)}</span>
          <span className="text-xs text-muted-foreground">La app no registra partidas contra la CPU.</span>
        </li>
        {game.rental ? (
          <li className="flex flex-col gap-0.5 px-3 py-2">
            <span className="font-medium">Mazos de alquiler</span>
            <span>{gameRateText(game.rental)}</span>
          </li>
        ) : null}
      </ul>
      {window ? (
        <div className="flex flex-col gap-0.5 rounded-lg border bg-muted/40 px-3 py-2" data-testid="game-window">
          <span className="text-xs text-muted-foreground">
            Entre la importación del {formatDateTime(window.from)} y la del {formatDateTime(window.to)}
          </span>
          {window.comparison.map((row) => (
            <span key={row.kind}>{comparisonText(row)}.</span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Con la próxima importación te digo cuántas partidas jugaste desde esta y cuántas no registraste.
        </p>
      )}
    </div>
  )
}

export function GameCountersSection() {
  const zone = usePokemonZone()
  if (!zone.data) return null
  return (
    <Section title="Según el juego">
      {zone.data.latest ? (
        <Counters data={zone.data} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Para ver tus partidas según el juego (y cuántas no registraste),{' '}
          <Link to="/coleccion/pokemon-zone" className="underline">
            traelas de pokemon-zone
          </Link>
          .
        </p>
      )}
    </Section>
  )
}
