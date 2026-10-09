/**
 * MCP tools of M8 (PLAN §3.8, Apéndice D), defined once: name, title, Spanish description and zod input schema.
 * The API registers them with handlers that call the same services as the REST endpoints. Read tools only
 * (Fase 3); the write tools arrive in Fase 7.
 *
 * Names use `_` instead of the `.` of the plan: Claude's API only accepts `[a-zA-Z0-9_-]` in tool names, and
 * Claude Code and the Claude apps expose MCP tools under those names (DECISIONES 3.2).
 */
import { z } from 'zod'
import { RARITIES, SELECTABLE_ENERGIES } from '../catalog/types.js'
import { MATCH_MODES } from '../matches/types.js'
import { TOURNAMENT_FORMATS } from '../tournaments/eras.js'

const query = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe(
    'Nombre de la carta en español o inglés («Copiona», «Copycat»), código de edición («B4-103») o id de carta funcional',
  )

const deckRef = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    'Mazo: su número («13» o «mazo 13»: el número con que empieza el nombre o, si no, el id del mazo) o parte del nombre',
  )

const tournamentScope = {
  era: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional()
    .describe('Era: código del último set del formato («B4a»); por defecto la vigente'),
  format: z.enum(TOURNAMENT_FORMATS).optional().describe('STANDARD (por defecto) o NOEX'),
}

const TOURNAMENT_NOTE =
  'Datos de torneo de Limitless (play.limitlesstcg.com), por era: cada fila trae listas, partidas e intervalo; con menos de 30 listas es orientativo; comparar contra la media de la era (no contra 50 %, porque cuenta empates y abandonos).'

export const MCP_READ_TOOLS = {
  collectionSummary: {
    name: 'collection_summary',
    title: 'Resumen de la colección',
    description:
      'Totales de la colección: copias, cartas funcionales con al menos 1 y 2 copias, cartas que faltan, ajustes manuales activos y fecha del último CSV importado.',
    input: z.object({}),
  },
  cardsSearch: {
    name: 'cards_search',
    title: 'Buscar cartas',
    description:
      'Busca cartas del catálogo por nombre (español o inglés, sin importar tildes), código de edición o texto de reglas. Devuelve ediciones con su carta funcional, rareza, expansión, puntos de premio y el texto de ataques y habilidad (en inglés).',
    input: z.object({
      q: z.string().trim().min(1).max(100).describe('Texto a buscar'),
      lang: z.enum(['es', 'en', 'any']).optional().describe('Idioma de los nombres a comparar (por defecto ambos)'),
      limit: z.number().int().min(1).max(25).optional().describe('Máximo de ediciones (por defecto 10)'),
    }),
  },
  collectionPlayableCopies: {
    name: 'collection_playable_copies',
    title: 'Copias jugables',
    description:
      'Copias jugables de una carta funcional (todas sus ediciones suman; un ajuste manual activo pisa la suma), con las ediciones que tengo y los mazos que la usan. Un nombre puede corresponder a varias cartas funcionales con distinto texto (por ejemplo Riolu A2-91 y Riolu B3-79): se devuelven todas.',
    input: z.object({ query }),
  },
  collectionEditions: {
    name: 'collection_editions',
    title: 'Cantidades por edición',
    description:
      'Cantidades por edición de una carta: cuántas tengo de cada código, si está marcada como conseguida y qué ediciones comparten la misma fila del tracker (gemelas como A1-1 y A4b-1).',
    input: z.object({ query }),
  },
  decksList: {
    name: 'decks_list',
    title: 'Listar mazos',
    description:
      'Lista los mazos con energías, etiquetas, si es válido, si está completo contra la colección (y cuántas copias faltan), si está armado en el juego y el récord de mis partidas.',
    input: z.object({
      archived: z.boolean().optional().describe('true para listar solo los archivados (por defecto, los activos)'),
      builtInGame: z.boolean().optional().describe('Filtrar por «armado en el juego»'),
      tag: z.string().trim().max(50).optional().describe('Filtrar por etiqueta (competitivo, casual, misión…)'),
    }),
  },
  decksGet: {
    name: 'decks_get',
    title: 'Ver un mazo',
    description:
      'Detalle de un mazo: las 20 cartas con nombre y código, energías, validación con mensajes, qué falta contra la colección, revisiones, notas, el texto en el formato de mazos_40_listas.md y el resumen de mis partidas.',
    input: z.object({ deck: deckRef }),
  },
  decksFindByCard: {
    name: 'decks_find_by_card',
    title: 'Mazos que usan una carta',
    description:
      'Mazos activos cuya versión actual usa alguna edición de la carta funcional buscada, con cuántas copias lleva cada uno.',
    input: z.object({ query }),
  },
  decksValidate: {
    name: 'decks_validate',
    title: 'Validar una lista',
    description:
      'Valida una lista sin guardarla: 20 cartas, máximo 2 por nombre, al menos un Básico, líneas de evolución y energías; y qué falta contra la colección. Acepta texto (formato de Limitless o deckgym «2 Riolu A2 91», formato en español con códigos, o JSON) o una lista de cartas con códigos.',
    input: z.object({
      text: z.string().max(200_000).optional().describe('La lista pegada, en cualquiera de los formatos'),
      format: z
        .enum(['auto', 'spanish', 'spanish-file', 'limitless', 'json'])
        .optional()
        .describe('Formato del texto (por defecto se detecta)'),
      cards: z
        .array(z.object({ cardId: z.string().trim().min(1).max(20), count: z.number().int().min(1).max(60) }))
        .max(60)
        .optional()
        .describe('Alternativa al texto: cartas con su código de edición'),
      energies: z
        .array(z.enum(['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal']))
        .max(8)
        .optional()
        .describe('Energías del mazo cuando se manda `cards`'),
    }),
  },
  decksMissing: {
    name: 'decks_missing',
    title: 'Qué le falta a un mazo',
    description:
      'Cartas que le faltan a un mazo contra la colección: cuántas copias, la edición más barata en puntos de sobre (con la rareza y si es intercambiable) y el total de puntos.',
    input: z.object({ deck: deckRef }),
  },
  decksClosest: {
    name: 'decks_closest',
    title: 'Mazo armado más cercano',
    description:
      'Para armar una lista nueva con la menor cantidad de cambios: qué mazo ya armado en el juego (o guardado) se parece más, cuántas cartas hay que cambiar, cuáles sacar, cuáles poner y si cambia la energía. Cuenta por carta funcional: otra edición de la misma carta no es un cambio. La lista nueva puede ser un mazo guardado o un texto pegado.',
    input: z.object({
      deck: deckRef.optional().describe('La lista nueva, si ya está guardada como mazo'),
      text: z.string().max(200_000).optional().describe('La lista nueva pegada (Limitless, deckgym o español)'),
      scope: z
        .enum(['built', 'all'])
        .optional()
        .describe('Candidatos: «built» (por defecto) solo los armados en el juego; «all» todos los guardados activos'),
      limit: z.number().int().min(1).max(10).optional().describe('Cuántos candidatos devolver (por defecto 3)'),
    }),
  },
  decksRandom: {
    name: 'decks_random',
    title: 'Mazo al azar',
    description:
      'Elige un mazo guardado al azar (activos). Puede limitarse a los armados en el juego o a una etiqueta, y con leastPlayed elige solo entre los que tienen menos partidas registradas.',
    input: z.object({
      builtInGame: z.boolean().optional().describe('Solo los armados en el juego'),
      tag: z.string().trim().max(50).optional().describe('Solo los que tienen esta etiqueta'),
      leastPlayed: z.boolean().optional().describe('Elegir entre los que tienen menos partidas'),
    }),
  },
  matchesStats: {
    name: 'matches_stats',
    title: 'Estadísticas de mis partidas',
    description:
      'Porcentaje de victorias de mis partidas registradas, en total, por mazo, por rival, por quién empezó, por modalidad y por revisión del mazo. Cada porcentaje trae su n, intervalo de confianza de Wilson del 95 % y la marca «orientativo» con menos de 30 partidas: citá siempre el campo `text`. Son solo mis partidas: no las mezcles con torneos ni simulaciones.',
    input: z.object({
      deck: deckRef.optional(),
      mode: z.enum(MATCH_MODES).optional().describe('Modalidad'),
      days: z.number().int().min(1).max(3650).optional().describe('Solo las partidas de los últimos N días'),
    }),
  },
  matchesList: {
    name: 'matches_list',
    title: 'Últimas partidas',
    description:
      'Mis últimas partidas registradas, la más reciente primero, con mazo, resultado, rival, quién empezó, modalidad y nota.',
    input: z.object({
      deck: deckRef.optional(),
      opponent: z.string().trim().max(80).optional().describe('Parte del nombre del rival'),
      limit: z.number().int().min(1).max(50).optional().describe('Cantidad (por defecto 20)'),
    }),
  },
  packsRecommend: {
    name: 'packs_recommend',
    title: 'Recomendar sobres',
    description:
      'Qué sobres conviene abrir. Por sobre: probabilidad de al menos una carta buscada, cartas buscadas esperadas, puntaje de 0 a 1 según los objetivos (cada objetivo medido contra su mejor sobre) y sobres para 50 % y 90 %. Objetivos: los mazos con prioridad de sobres (1 a 3, se marca en cada mazo) y la colección con filtro de rarezas, pesados con alpha. Incluye las cartas que faltan con su costo en puntos, si son intercambiables y si conviene canjearlas con los puntos ya guardados de su expansión (se cargan en Sobres → Ajustes y valen aunque sus sobres ya no se vendan), comprarlas, abrir o intercambiarlas (cuando ningún sobre a la venta las da), y los sobres esperados para completar cada mazo objetivo. Los sobres por tiempo limitado (el Deluxe Mega, hasta el 28/10/2026) dicen su último día, los días que quedan y qué cartas solo dan ellos: para los mazos cuenta la carta funcional (cualquier versión sirve), para la colección cada versión (arte u holo nuevo; dos números con el mismo internal_id son la misma versión); esas exclusivas pesan limitedBoost veces más mientras dure. Modelo «corrected» por defecto; «tracker» reproduce los números de la web del tracker. Con deckTarget «tournament», cada mazo objetivo apunta a su versión de torneo (la lista de su arquetipo más sólida de la era) en vez de a su lista guardada: sirve cuando los mazos ya están completos con reemplazos. Sin parámetros usa lo guardado en la app.',
    input: z.object({
      model: z
        .enum(['corrected', 'tracker'])
        .optional()
        .describe('Modelo de probabilidades (por defecto el guardado, «corrected»)'),
      alpha: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Peso de los mazos frente a la colección (0 a 1; por defecto 0,7)'),
      collection: z
        .object({
          rarities: z.array(z.enum(RARITIES)).describe('Rarezas que cuentan; vacío = todas'),
          copies: z.number().int().min(1).max(5).describe('Copias por edición que se buscan'),
        })
        .nullable()
        .optional()
        .describe('Objetivo colección; null lo apaga'),
      onlyAvailable: z.boolean().optional().describe('Solo sobres disponibles hoy (por defecto true)'),
      limitedBoost: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe('Peso de lo que solo da un sobre por tiempo limitado (1 a 5; por defecto el guardado, 3)'),
      deckTarget: z
        .enum(['saved', 'tournament'])
        .optional()
        .describe(
          'A qué apuntan los mazos objetivo: «saved» (su lista guardada) o «tournament» (su versión de torneo); por defecto el guardado',
        ),
      limit: z.number().int().min(1).max(29).optional().describe('Sobres a devolver (por defecto 8)'),
    }),
  },
  tournamentsStats: {
    name: 'tournaments_stats',
    title: 'Estadísticas de torneo',
    description: `Récord por arquetipo («by: archetype», por defecto) o por lista exacta («by: list»: mismas 20 cartas, por carta funcional). Con «archetype» devuelve ese arquetipo: récord, sus listas más jugadas y qué cartas usa; si además se pasa «card», el récord con y sin esa carta (al menos «minCopies» copias), en dos filas separadas. ${TOURNAMENT_NOTE}`,
    input: z.object({
      ...tournamentScope,
      by: z.enum(['archetype', 'list']).optional().describe('archetype (por defecto) o list'),
      archetype: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe('Arquetipo: parte del nombre en inglés («Mega Blaziken») o su id de Limitless'),
      card: query.optional().describe('Carta para «con y sin» (requiere archetype): nombre o código de edición'),
      minCopies: z.number().int().min(1).max(2).optional().describe('Copias mínimas para contar «con» (1 o 2)'),
      limit: z.number().int().min(1).max(50).optional().describe('Filas a devolver (por defecto 15)'),
    }),
  },
  matchesLuck: {
    name: 'matches_luck',
    title: '¿Mala racha o mal matchup?',
    description:
      'Si el récord de Santi con un mazo (en general o contra un rival) es raro para lo que dicen los torneos: compara contra el matchup del arquetipo del mazo contra ese rival en torneos (10 partidas o más) o, si no, el récord del arquetipo, con una prueba binomial exacta, y dice si lleva una racha de derrotas y qué tan común es. Devuelve el veredicto en palabras: «dentro de lo normal», «raro», «mejor de lo esperable».',
    input: z.object({
      deck: deckRef,
      opponent: z.string().trim().min(1).max(120).optional().describe('Rival: arquetipo como Santi lo anota'),
    }),
  },
  eventsCheck: {
    name: 'events_check',
    title: 'Eventos con restricciones',
    description:
      'Los eventos que Santi cargó con sus reglas de mazo (tipos, sin ex, rarezas, expansiones, cartas prohibidas). Sin «event», la lista. Con «event» (nombre o id): las reglas, qué mazos suyos cumplen (y qué rompe las reglas en los otros, con otra edición si la hay) y qué listas de torneo de la era cumplen y cuántas copias le faltan para armarlas.',
    input: z.object({
      event: z.string().trim().min(1).max(120).optional().describe('Nombre (o parte) o id del evento'),
    }),
  },
  rivalsNotes: {
    name: 'rivals_notes',
    title: 'Notas por rival',
    description:
      'Las notas de Santi sobre cómo jugar contra cada rival (arquetipo), escritas en la app o por Claude. Con «opponent» la nota de ese rival (sin importar mayúsculas, tildes ni guiones); sin él, todas. Usalas antes de aconsejar contra un rival.',
    input: z.object({
      opponent: z.string().trim().min(1).max(200).optional().describe('Rival: arquetipo o como Santi lo anota'),
    }),
  },
  decksPickToday: {
    name: 'decks_pick_today',
    title: '¿Qué mazo llevo hoy?',
    description:
      'Los mazos armados en el juego con tres números separados: el récord de Santi con cada uno, lo que su arquetipo de torneo debería sacar contra el meta de los últimos 14 días (matchups de torneo pesados por la cuota de cada rival) y el último puntaje del Laboratorio (bots contra el banco del meta). No los combines en uno: explicá qué dice cada fuente y dónde coinciden. «sort» ordena por una de las tres.',
    input: z.object({
      sort: z.enum(['tournament', 'matches', 'lab']).optional().describe('tournament (por defecto), matches o lab'),
      limit: z.number().int().min(1).max(40).optional().describe('Mazos a devolver (por defecto 10)'),
    }),
  },
  decksDrawOdds: {
    name: 'decks_draw_odds',
    title: 'Probabilidad de robar una carta',
    description:
      'Probabilidad exacta de tener una carta del mazo (cualquier edición; varias cartas = cualquiera de ellas) en la mano inicial y en cada turno propio, y de tener dos cartas a la vez («alsoCards»), con las reglas del juego: mano inicial de 5 con al menos un Pokémon Básico (se reparte de nuevo si no hay) y una carta por turno propio, también en el primero. Solo robo natural: no cuenta cartas que roban o buscan (Investigación de Profesores, Poké Ball). Sin «cards», el atacante del mazo que más puntos da. También dice cuántos Básicos suele traer la mano inicial.',
    input: z.object({
      deck: deckRef,
      cards: z.array(query).min(1).max(5).optional().describe('Cartas (nombre o código); cualquiera de ellas cuenta'),
      alsoCards: z.array(query).min(1).max(5).optional().describe('Segunda carta para «las dos a la vez»'),
      turns: z.number().int().min(1).max(15).optional().describe('Turnos propios a mostrar (por defecto 6)'),
    }),
  },
  tournamentsTrends: {
    name: 'tournaments_trends',
    title: 'Meta semanal',
    description: `Qué se juega más y qué menos en torneos: la última semana (termina en el torneo más nuevo de la era) contra la anterior, por arquetipo y por carta, en puntos de cuota de listas. «clear» = el cambio pasa una prueba de dos proporciones al 95 % (con pocas listas, un salto de 2 o 3 no es tendencia). «isNew» = no se jugó la semana anterior. ${TOURNAMENT_NOTE}`,
    input: z.object({
      ...tournamentScope,
      days: z.number().int().min(3).max(30).optional().describe('Días de cada ventana (por defecto 7)'),
      limit: z.number().int().min(1).max(30).optional().describe('Filas por lista (por defecto 8)'),
    }),
  },
  tournamentsMatchups: {
    name: 'tournaments_matchups',
    title: 'Matchups de torneo',
    description: `Enfrentamientos entre arquetipos en torneos reales de la era (rondas de Limitless: quién jugó contra quién), contados por partida (un BO1 o un BO3 entero); sin byes, ausencias ni dobles derrotas. Con «archetype»: ese arquetipo contra cada rival (los más jugados primero) y lo que debería sacar contra el meta (cada matchup pesado por la cuota del rival; un matchup con pocas partidas se acerca a su récord contra todos, como si tuviera 10 partidas más a ese ritmo; «coversMeta» = cuota de los rivales con 10 partidas o más). Sin «archetype»: los «top» arquetipos más jugados entre sí. Son partidas de personas, no de bots. ${TOURNAMENT_NOTE}`,
    input: z.object({
      ...tournamentScope,
      archetype: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe('Arquetipo: parte del nombre en inglés («Mega Blaziken») o su id de Limitless'),
      top: z.number().int().min(2).max(30).optional().describe('Arquetipos de la tabla (por defecto 10)'),
    }),
  },
  tournamentsBuildable: {
    name: 'tournaments_buildable',
    title: 'Listas de torneo que puedo armar',
    description: `Listas exactas de torneo de la era que se pueden armar hoy con la colección (por carta funcional, cada lista contra la colección entera), las más jugadas primero, y las que quedan a 1 o 2 copias, con qué reemplazar cada carta que falta entre lo que Santi tiene (otra versión de la misma carta, o lo que juegan las listas del arquetipo que no la llevan). ${TOURNAMENT_NOTE}`,
    input: z.object({
      ...tournamentScope,
      limit: z.number().int().min(1).max(50).optional().describe('Listas a devolver por grupo (por defecto 10)'),
    }),
  },
  tournamentsUnlockCards: {
    name: 'tournaments_unlock_cards',
    title: 'Cartas que destraban listas',
    description: `Qué carta sola destraba más listas de torneo de la era: para cada carta, cuántas listas exactas pasan a poder armarse si se consiguen las copias que faltan de esa carta (y ninguna otra), con el récord combinado de esas listas. ${TOURNAMENT_NOTE}`,
    input: z.object({
      ...tournamentScope,
      limit: z.number().int().min(1).max(50).optional().describe('Cartas a devolver (por defecto 10)'),
    }),
  },
  simulationsResults: {
    name: 'simulations_results',
    title: 'Resultados de simulación',
    description:
      'Resultados de las simulaciones entre mazos con el motor deckgym (juegan bots, no personas). Sin «job»: las simulaciones recientes con estado, progreso, bots, partidas por cruce, semilla y motor. Con «job»: el ranking de mazos de esa simulación (victorias, derrotas y empates aparte; % con n e intervalo) o, si es de tipo optimizar, las combinaciones de cartas probadas. Con «deck»: la columna de simulación de ese mazo (la misma que la comparativa de la ficha) y, junto con «job», sus cruces contra cada rival. Los números dependen del bot y del motor: no predicen partidas reales y nunca se combinan con torneos ni con partidas propias.',
    input: z.object({
      job: z.number().int().positive().optional().describe('Número de la simulación («#12» → 12)'),
      deck: deckRef.optional(),
      limit: z.number().int().min(1).max(50).optional().describe('Filas a devolver (por defecto 15)'),
    }),
  },
  collectionPackLuck: {
    name: 'collection_pack_luck',
    title: 'Suerte de los sobres',
    description:
      'Qué entró a la colección entre dos importaciones del CSV (y desde la primera), por rareza, contra lo que dan los sobres: cuántas cartas ☆ o más y ◊◊◊◊ salieron y cuántas se esperaban, con una prueba binomial («mejor de lo normal», «dentro de lo normal», «peor»). Aproximado: el CSV dice qué tenés, no de dónde vino (cuenta intercambios, Wonder Pick y premios); las promos no cuentan.',
    input: z.object({}),
  },
  collectionTrades: {
    name: 'collection_trades',
    title: 'Lista de intercambio',
    description:
      'Para intercambiar en el juego (una carta por otra de la misma rareza; solo ◊ a ◊◊◊◊, ☆, ☆☆, ✵ y ✵✵ de expansiones que se intercambian): «Busco», las cartas que les faltan a los mazos sin archivar, con las ediciones que se pueden pedir (la rareza más común primero) y qué mazos las usan; «Doy», las copias que sobran en la colección (se guarda una de cada edición y al menos 2 de cada carta, lo que sea más; una carta con un ajuste activo no se ofrece); lo que falta y no se puede intercambiar; y el texto para pegar en un chat. Con «rarities» el texto y las filas se acotan a esas rarezas (por defecto: las que tienen algo para buscar, o de ◊◊◊ para arriba).',
    input: z.object({
      rarities: z.array(z.enum(RARITIES)).max(11).optional().describe('Rarezas («◊◊◊◊», «☆»…)'),
      limit: z.number().int().min(1).max(100).optional().describe('Filas de «Doy» por rareza (por defecto 15)'),
    }),
  },
  collectionMissions: {
    name: 'collection_missions',
    title: 'Misiones de colección',
    description:
      'Las misiones de colección del juego (themed collections, datos del tracker al commit fijado) contra la colección: por misión, cuántas copias pide cada casilla, cuántas tiene Santi entre las cartas que valen (reimpresiones y otras artes cuentan) y qué falta; la recompensa. Nombres de misiones y recompensas en inglés, como los datos del juego. Con «incomplete» solo las que faltan.',
    input: z.object({
      expansion: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9-]{1,8}$/)
        .optional()
        .describe('Expansión («B4a»); por defecto todas'),
      incomplete: z.boolean().optional().describe('Solo las misiones sin completar'),
      limit: z.number().int().min(1).max(100).optional().describe('Misiones a devolver (por defecto 20)'),
    }),
  },
  playGames: {
    name: 'play_games',
    title: 'Partidas contra el bot',
    description:
      'Las partidas de Santi contra un bot del motor deckgym (Más → Jugar contra un bot), las más nuevas primero: número, estado, su mazo, el rival, el bot, si tenía entrenador, el resultado, los turnos y, con entrenador, qué parte de sus jugadas fueron tan buenas como las del entrenador. Para analizar una, play_game_review con su número. Son partidas de práctica contra un bot: nunca se mezclan con las partidas registradas.',
    input: z.object({
      limit: z.number().int().min(1).max(30).optional().describe('Partidas a devolver (por defecto 15)'),
    }),
  },
  playGameReview: {
    name: 'play_game_review',
    title: 'Analizar una partida contra el bot',
    description:
      'Una partida de Santi contra el bot contada turno por turno en español: el tablero al empezar cada turno (puntos, activo y banca con PS, energías, herramientas y estados, la mano de Santi y la del bot, que en la partida no veía, mazo y descarte), cada acción de los dos y, si jugó con entrenador, qué le pareció cada decisión de Santi (veredicto, cuánto valor perdió y la opción del entrenador) más los momentos más caros con su tablero y las tres mejores opciones. «detail: full» agrega todas las opciones de cada decisión con su valor; «fromTurn»/«toTurn» acotan los turnos. Una partida sin terminar devuelve lo que dijo el entrenador hasta ahora. Para explicar por qué se ganó o se perdió y qué conviene practicar: basate en el tablero y en lo que pasó, y aclarar que el entrenador mira solo el turno.',
    input: z.object({
      id: z.number().int().positive().describe('Número de la partida («#12» → 12; ver play_games)'),
      detail: z
        .enum(['summary', 'full'])
        .optional()
        .describe('summary (por defecto): la jugada elegida y el veredicto; full: además todas las opciones'),
      fromTurn: z.number().int().min(0).max(200).optional().describe('Desde este turno (0 = preparación)'),
      toTurn: z.number().int().min(0).max(200).optional().describe('Hasta este turno'),
    }),
  },
  labMetaBank: {
    name: 'lab_meta_bank',
    title: 'Banco del meta (laboratorio)',
    description: `El rival estándar del laboratorio de mazos: los arquetipos más jugados de la era, cada uno con su lista representativa (la misma que la «versión de torneo»: entre las repetidas 5 veces o más, la de mejor piso del intervalo) y su peso, la cuota de listas de la era normalizada sobre el banco. lab_test y lab_explore juegan contra este banco y ponderan con estos pesos. Una lista que el motor no puede simular cede su lugar a la siguiente del arquetipo, o el arquetipo se saltea (se dice por qué). ${TOURNAMENT_NOTE}`,
    input: z.object({
      ...tournamentScope,
      size: z.number().int().min(1).max(20).optional().describe('Arquetipos del banco (por defecto 15)'),
    }),
  },
  labBuildFromCore: {
    name: 'lab_build_from_core',
    title: 'Armar desde un núcleo',
    description: `Una primera lista alrededor de 1 a 4 cartas que Santi quiere jugar juntas: el resto sale de lo que juegan las listas de torneo de la era que llevan esas cartas juntas (las más jugadas primero, con las copias que suelen llevar), con la línea evolutiva de cada Pokémon (Caramelo Raro en vez de la Fase 1 cuando esas listas lo hacen), solo cartas que el motor juega y Pokémon cuyos ataques pagan las energías. Si casi ninguna lista juega el núcleo junto, las que juegan alguna de esas cartas; si ninguna, lo más jugado de la era. Por defecto solo con lo que tiene la colección («pool»: «all» para cualquier carta). Devuelve la lista con el porqué de cada carta y si valida; no guarda nada. Es un punto de partida para lab_test o lab_explore, no un mazo probado. ${TOURNAMENT_NOTE}`,
    input: z.object({
      ...tournamentScope,
      cards: z
        .array(z.string().trim().min(1).max(80))
        .min(1)
        .max(4)
        .describe('Las cartas del núcleo: nombre en español o inglés, o código de edición («B3-77»)'),
      energies: z
        .array(z.enum(SELECTABLE_ENERGIES))
        .max(3)
        .optional()
        .describe('Energías; por defecto las que piden los ataques del núcleo'),
      pool: z
        .enum(['collection', 'all'])
        .optional()
        .describe('collection (por defecto): solo lo que tiene la colección; all: cualquier carta'),
      event: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('Nombre o id de un evento cargado: solo cartas que sus reglas permiten'),
    }),
  },
  labResults: {
    name: 'lab_results',
    title: 'Resultados del laboratorio',
    description:
      'Sin «job»: las pruebas contra el meta y las búsquedas automáticas recientes, con estado y progreso. Con «job»: cada mazo con su puntaje contra el meta (% de victorias ponderado por la cuota de cada arquetipo del banco, con n e intervalo), su resultado contra cada rival, los cambios de cartas respecto de la lista de partida y su novedad («jugada en torneo», «conocida»: a 6 cambios o menos de una lista de la era, o «nueva»). En una búsqueda: cada ronda, qué variante ganó y la ronda de confirmación (partidas nuevas para la lista de partida y la encontrada, sin la suerte que eligió al ganador). Juegan bots, no personas: es una pista para probar en el juego, no un veredicto, y nunca se mezcla con torneos ni con partidas propias.',
    input: z.object({
      job: z.number().int().positive().optional().describe('Número de la simulación («#12» → 12)'),
      limit: z.number().int().min(1).max(60).optional().describe('Mazos a devolver (por defecto 10)'),
    }),
  },
} as const

export type McpReadToolKey = keyof typeof MCP_READ_TOOLS

/** What the model reads before using the tools (MCP `instructions`). */
export const MCP_SERVER_INSTRUCTIONS = [
  'Datos personales de Pokémon TCG Pocket de un solo jugador: colección, mazos y partidas registradas, resultados de torneo de Limitless por era y simulaciones entre mazos con el motor deckgym.',
  'Una carta funcional agrupa las ediciones con el mismo nombre y el mismo texto; sus copias se suman. Cartas con el mismo nombre y distinto texto (Riolu A2-91 y Riolu B3-79) son cartas funcionales distintas. Las copias no se reparten entre mazos: cada mazo se compara contra la colección entera.',
  'Los códigos de edición tienen la forma B4-103. Mostrá los nombres de cartas en español.',
  'Los mazos se nombran por número («mazo 13»): es el id del mazo (las 40 listas se importaron en orden) y las tools lo aceptan así. Al responder, nombrá cada mazo por su número y su nombre.',
  'Todo porcentaje va con su n y su intervalo de confianza (citá el campo `text`); con menos de 30 partidas es orientativo. Mis partidas, los torneos y las simulaciones son fuentes distintas: nunca las combines en un número.',
  'Responder solo con lo que devuelven las tools; si una tool dice que un módulo no está disponible, decilo.',
].join('\n')
