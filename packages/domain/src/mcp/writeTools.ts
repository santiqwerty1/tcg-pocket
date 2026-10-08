/**
 * Write tools of M8 (PLAN §7 Fase 7, Apéndice D): creating and editing decks, logging matches and queueing
 * simulations. Same shape as the read tools; the API registers them only for tokens with the `mcp:write` scope, so a
 * read-only connector never sees them.
 */
import { z } from 'zod'
import { SELECTABLE_ENERGIES } from '../catalog/types.js'
import { MATCH_MODES, MATCH_RESULTS } from '../matches/types.js'
import { TOURNAMENT_FORMATS } from '../tournaments/eras.js'

const deckRef = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    'Mazo: su número («13» o «mazo 13»: el número con que empieza el nombre o, si no, el id) o parte del nombre',
  )

const energies = z
  .array(z.enum(SELECTABLE_ENERGIES))
  .max(3)
  .describe('Energías de la Zona de Energía (grass, fire, water, lightning, psychic, fighting, darkness, metal)')

const cardList = z
  .array(z.object({ cardId: z.string().trim().min(1).max(20), count: z.number().int().min(1).max(60) }))
  .max(60)
  .describe('Cartas con su código de edición («B4-103») y copias')

const deckText = z
  .string()
  .max(200_000)
  .describe(
    'La lista pegada en cualquier formato: español de mazos_40_listas.md («- Pokémon: 2 Riolu (A2-91), …»), Limitless o deckgym («2 Riolu A2 91») o JSON',
  )

const bot = z
  .string()
  .regex(/^(r|w|aa|et|v|er|m|e[1-9])$/)
  .describe(
    'Bot de deckgym: r al azar, w al azar ponderado, aa adjunta y ataca, et termina el turno, v función de valor, er evoluciona primero, m MCTS, e1…e9 expectiminimax (e2 por defecto; e3 tarda ~2 veces más)',
  )

const tournamentList = z.object({
  key: z
    .string()
    .regex(/^[0-9a-f]{14}$/)
    .describe('Clave de la lista exacta de torneo (la devuelve tournaments_stats con by «list»)'),
  era: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional()
    .describe('Era (por defecto la vigente)'),
  format: z.enum(TOURNAMENT_FORMATS).optional().describe('STANDARD (por defecto) o NOEX'),
  energies: energies.optional().describe('Energía para simularla: obligatoria en listas NOEX, que no la traen'),
})

export const MCP_WRITE_TOOLS = {
  decksCreate: {
    name: 'decks_create',
    title: 'Crear un mazo',
    description:
      'Guarda un mazo nuevo en la app, desde texto (cualquier formato de decks_validate) o desde una lista de cartas con códigos, y devuelve su validación y qué falta contra la colección. Si la lista no es válida no se guarda (salvo saveInvalid: true): mostrale a Santi los errores. Si el texto trae varios mazos, se usa el primero.',
    input: z.object({
      text: deckText.optional(),
      cards: cardList.optional(),
      energies: energies.optional().describe('Energías; con texto, por defecto las que declara el texto'),
      name: z.string().trim().min(1).max(120).optional().describe('Nombre; por defecto el título del texto'),
      tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
      notes: z.string().max(4000).optional().describe('Notas del mazo'),
      saveInvalid: z.boolean().optional().describe('Guardarlo aunque no valide (por defecto false)'),
    }),
  },
  decksUpdate: {
    name: 'decks_update',
    title: 'Editar un mazo',
    description:
      'Cambia un mazo guardado: cartas (texto o lista; crea una revisión nueva y valida antes de guardar), energías, nombre, etiquetas, notas, prioridad de sobres, arquetipo de torneo, «armado en el juego» o archivado. Devuelve el mazo con su validación y la revisión actual. No borra mazos.',
    input: z.object({
      deck: deckRef,
      text: deckText
        .optional()
        .describe('Lista nueva completa (reemplaza las 20 cartas y, si las declara, las energías)'),
      cards: cardList.optional().describe('Lista nueva completa con códigos (reemplaza las 20 cartas)'),
      energies: energies.optional(),
      name: z.string().trim().min(1).max(120).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
      notes: z.string().max(4000).optional(),
      revisionNote: z.string().max(300).optional().describe('Por qué cambian las cartas (queda en la revisión)'),
      packPriority: z.number().int().min(0).max(3).optional().describe('Prioridad en Sobres: 0 (no) a 3 (alta)'),
      tournamentArchetype: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .nullable()
        .optional()
        .describe('Arquetipo de Limitless del mazo (nombre o id); null vuelve al sugerido'),
      builtInGame: z.boolean().optional().describe('Si está armado en el juego (hay un límite de mazos armados)'),
      archived: z.boolean().optional(),
      saveInvalid: z.boolean().optional().describe('Guardar cartas que no validan (por defecto false)'),
    }),
  },
  matchesLog: {
    name: 'matches_log',
    title: 'Registrar una partida',
    description:
      'Registra una partida jugada con uno de mis mazos: resultado, rival (arquetipo o descripción, por ejemplo «Mega-Blaziken»), si empecé yo y modalidad. Registrá cada partida una sola vez: si no estás seguro de algún dato, preguntá antes. Devuelve la partida y el récord actualizado del mazo.',
    input: z.object({
      deck: deckRef,
      result: z.enum(MATCH_RESULTS).describe('win (victoria), loss (derrota) o tie (empate)'),
      opponent: z.string().trim().min(1).max(120).optional().describe('Rival: arquetipo o lo que se vio'),
      wentFirst: z.boolean().optional().describe('true si empecé yo, false si empezó el rival'),
      mode: z
        .enum(MATCH_MODES)
        .optional()
        .describe('competitive, casual (distendida), beginner, event o friend; por defecto la de la última partida'),
      note: z.string().max(1000).optional(),
      playedAt: z.iso.datetime({ offset: true }).optional().describe('Cuándo se jugó (ISO 8601); por defecto ahora'),
    }),
  },
  matchesUpdate: {
    name: 'matches_update',
    title: 'Corregir una partida',
    description:
      'Corrige una partida registrada (por ejemplo «no, era derrota»): cualquier campo de matches_log. El id lo devuelven matches_log y matches_list.',
    input: z.object({
      id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe('Id de la partida'),
      deck: deckRef.optional(),
      result: z.enum(MATCH_RESULTS).optional(),
      opponent: z.string().trim().min(1).max(120).nullable().optional(),
      wentFirst: z.boolean().nullable().optional(),
      mode: z.enum(MATCH_MODES).optional(),
      note: z.string().max(1000).optional(),
      playedAt: z.iso.datetime({ offset: true }).optional(),
    }),
  },
  matchesDelete: {
    name: 'matches_delete',
    title: 'Borrar una partida',
    description: 'Borra una partida registrada por error. Confirmá con Santi cuál antes de borrar.',
    input: z.object({
      id: z
        .string()
        .regex(/^\d{1,10}$/)
        .describe('Id de la partida'),
    }),
  },
  simulationsEnqueue: {
    name: 'simulations_enqueue',
    title: 'Encolar una simulación',
    description:
      'Encola partidas entre mazos con el motor deckgym, que juega el worker de la PC de Santi. kind «compare»: cada mazo de A contra cada uno de B; «matrix»: todos contra todos dentro de A (o A contra B); «optimize»: un mazo de A sin las cartas de remove, probando las combinaciones de candidates contra los rivales de B. Los mazos pueden ser míos (decksA/decksB) o listas exactas de torneo (listsA/listsB). Antes de encolar dice qué no es simulable y por qué; con skipNotSimulable los saltea. Devuelve el número de simulación, cruces, partidas, la estimación de tiempo y si el worker está en línea; los resultados se leen con simulations_results. Juegan bots: el porcentaje depende del bot.',
    input: z.object({
      kind: z.enum(['compare', 'matrix', 'optimize']).describe('compare (por defecto), matrix u optimize'),
      decksA: z.array(deckRef).max(150).optional().describe('Mis mazos del lado A'),
      listsA: z.array(tournamentList).max(150).optional().describe('Listas de torneo del lado A'),
      decksB: z.array(deckRef).max(150).optional().describe('Mis mazos del lado B (rivales)'),
      listsB: z.array(tournamentList).max(150).optional().describe('Listas de torneo del lado B (rivales)'),
      games: z.number().int().min(1).max(20_000).optional().describe('Partidas por cruce (por defecto 200)'),
      bots: z.tuple([bot, bot]).optional().describe('Bot del lado A y del lado B (por defecto e2 y e2)'),
      seed: z
        .number()
        .int()
        .min(0)
        .max(2 ** 52)
        .optional()
        .describe('Semilla (por defecto al azar): la misma semilla repite el mismo resultado'),
      replaySample: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe('Repeticiones guardadas por cruce (por defecto 2)'),
      bothOrders: z.boolean().optional().describe('matrix: cada cruce en los dos sentidos'),
      label: z.string().trim().max(200).optional().describe('Nombre de la simulación'),
      skipNotSimulable: z.boolean().optional().describe('Saltear los mazos no simulables en vez de rechazar'),
      remove: z
        .array(z.object({ card: z.string().trim().min(1).max(100), count: z.number().int().min(1).max(2) }))
        .max(20)
        .optional()
        .describe('optimize: cartas a sacar del mazo (nombre o código) y cuántas'),
      candidates: z
        .array(z.string().trim().min(1).max(100))
        .max(30)
        .optional()
        .describe('optimize: cartas candidatas para los huecos (nombre o código)'),
    }),
  },
} as const

export type McpWriteToolKey = keyof typeof MCP_WRITE_TOOLS

/** Added to the server instructions when the token can write. */
export const MCP_WRITE_INSTRUCTIONS = [
  'Con permiso de escritura: decks_create, decks_update, matches_log, matches_update, matches_delete y simulations_enqueue cambian datos de Santi.',
  'Registrá cada partida una sola vez y solo cuando Santi la cuente; si falta el mazo o el resultado, preguntá. Para corregir, matches_update; para borrar, confirmá antes.',
  'Un mazo que no valida no se guarda: mostrá los errores y proponé el arreglo.',
].join('\n')
