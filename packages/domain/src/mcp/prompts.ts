/**
 * MCP prompts (Fase 43): ready-made requests the Claude apps offer in their prompt menu. Each one only says which
 * tools to chain and how to present the answer; the numbers still come from the tools. Arguments are strings (the
 * MCP prompt contract).
 */
import { z } from 'zod'

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe('Cualquier día de la semana, «2026-10-05»; por defecto la última semana completa')

const deck = z.string().trim().min(1).max(200).describe('Mazo: su número («13») o parte del nombre')

const PRESENTATION =
  'Respondé en español, corto y en secciones. Citá cada porcentaje con su campo `text` (n e intervalo) y no mezcles fuentes (mis partidas, torneos, simulaciones) en un número. Nombrá los mazos por número y nombre.'

export const MCP_PROMPTS = {
  weeklyReview: {
    name: 'repaso_semanal',
    title: 'Repaso semanal',
    description: 'La semana de Santi en un repaso: partidas, rachas, cómo se movió el meta y qué sobres abrir.',
    args: z.object({ week: day }),
    text: (args: { week?: string | undefined }) =>
      [
        `Haceme el repaso de la semana${args.week ? ` que incluye el ${args.week}` : ' pasada'}.`,
        `1. week_summary${args.week ? ` con week «${args.week}»` : ''}: récord, mazos más jugados, mejor y peor rival.`,
        '2. Para cada mazo con 2 derrotas o más en la semana, matches_luck: ¿mala racha o mal matchup?',
        '3. tournaments_trends: qué arquetipos y cartas suben o bajan en torneos.',
        '4. packs_recommend: los 3 sobres que más convienen y si algún sobre limitado termina pronto.',
        `Cerrá con una recomendación para la semana que viene. ${PRESENTATION}`,
      ].join('\n'),
  },
  pickToday: {
    name: 'que_llevo_hoy',
    title: '¿Qué mazo llevo hoy?',
    description: 'Qué mazo armado conviene jugar hoy según mis partidas, el meta de torneos y el laboratorio.',
    args: z.object({}),
    text: () =>
      [
        '¿Qué mazo llevo hoy?',
        '1. decks_pick_today: los mazos armados con sus tres números (mis partidas, torneo contra el meta, laboratorio).',
        '2. tournaments_trends con days 7: qué está subiendo en el meta.',
        '3. Para los dos mejores candidatos, rivals_notes de los arquetipos que más suben, si Santi tiene notas.',
        `Proponé uno o dos mazos y explicá qué dice cada fuente y dónde coinciden. ${PRESENTATION}`,
      ].join('\n'),
  },
  deckCheckup: {
    name: 'revisar_mazo',
    title: 'Revisar un mazo',
    description: 'Todo sobre un mazo: lista, cómo me va, cómo le va en torneos, consistencia y qué le falta.',
    args: z.object({ deck }),
    text: (args: { deck: string }) =>
      [
        `Revisá el mazo «${args.deck}».`,
        '1. decks_get: la lista, su validación y su versión de torneo.',
        '2. matches_stats con ese mazo: mi récord, por rival y por quién empieza.',
        '3. tournaments_matchups con su arquetipo (el de decks_get), si tiene: contra qué rivales gana y pierde en torneos.',
        '4. decks_consistency: en qué turno está listo según el motor.',
        '5. decks_missing si no está completo.',
        `Terminá con dos o tres cambios concretos para probar (con lab_test si Santi quiere). ${PRESENTATION}`,
      ].join('\n'),
  },
} as const

export type McpPromptKey = keyof typeof MCP_PROMPTS
