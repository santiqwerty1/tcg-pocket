/**
 * MCP tools of M8 (PLAN §3.8, Apéndice D), defined once: name, title, Spanish description and zod input schema.
 * The API registers them with handlers that call the same services as the REST endpoints. Read tools only
 * (Fase 3); the write tools arrive in Fase 7.
 *
 * Names use `_` instead of the `.` of the plan: Claude's API only accepts `[a-zA-Z0-9_-]` in tool names, and
 * Claude Code and the Claude apps expose MCP tools under those names (DECISIONES 3.2).
 */
import { z } from 'zod'
import { RARITIES } from '../catalog/types.js'
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
      'Qué sobres conviene abrir. Por sobre: probabilidad de al menos una carta buscada, cartas buscadas esperadas, puntaje de 0 a 1 según los objetivos (cada objetivo medido contra su mejor sobre) y sobres para 50 % y 90 %. Objetivos: los mazos con prioridad de sobres (1 a 3, se marca en cada mazo) y la colección con filtro de rarezas, pesados con alpha. Incluye las cartas que faltan con su costo en puntos, si son intercambiables y si conviene comprarlas, abrir o intercambiarlas (cuando ningún sobre a la venta las da), y los sobres esperados para completar cada mazo objetivo. Los sobres por tiempo limitado (el Deluxe Mega, hasta el 28/10/2026) dicen su último día, los días que quedan y qué cartas solo dan ellos: para los mazos cuenta la carta funcional (cualquier versión sirve), para la colección cada versión (arte u holo nuevo; dos números con el mismo internal_id son la misma versión); esas exclusivas pesan limitedBoost veces más mientras dure. Modelo «corrected» por defecto; «tracker» reproduce los números de la web del tracker. Sin parámetros usa lo guardado en la app.',
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
        .describe('Peso de lo que solo da un sobre por tiempo limitado (1 a 5; por defecto el guardado, 2)'),
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
  tournamentsBuildable: {
    name: 'tournaments_buildable',
    title: 'Listas de torneo que puedo armar',
    description: `Listas exactas de torneo de la era que se pueden armar hoy con la colección (por carta funcional, cada lista contra la colección entera), las más jugadas primero, y las que quedan a 1 o 2 copias. ${TOURNAMENT_NOTE}`,
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
