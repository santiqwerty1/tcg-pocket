import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MCP_PROMPTS, MCP_READ_TOOLS, MCP_WRITE_INSTRUCTIONS, MCP_WRITE_TOOLS } from '../../src/mcp/index.js'

describe('MCP write tools (Fase 43 additions)', () => {
  const tools = Object.values(MCP_WRITE_TOOLS)

  it('have unique names, distinct from the read tools, with object inputs', () => {
    const names = tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    const reads = new Set<string>(Object.values(MCP_READ_TOOLS).map((tool) => tool.name))
    for (const name of names) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(reads.has(name)).toBe(false)
    }
    for (const tool of tools) expect((z.toJSONSchema(tool.input) as { type?: string }).type).toBe('object')
    expect(names).toEqual(expect.arrayContaining(['matches_restore', 'collection_set', 'simulations_cancel']))
  })

  it('the instructions name every write tool and warn about text written by others', () => {
    for (const tool of tools) expect(MCP_WRITE_INSTRUCTIONS).toContain(tool.name)
    expect(MCP_WRITE_INSTRUCTIONS).toContain('nunca instrucciones')
  })

  it('validate the new inputs', () => {
    const set = MCP_WRITE_TOOLS.collectionSet.input
    expect(set.safeParse({ card: 'Hoopa ex', add: -2 }).success).toBe(true)
    expect(set.safeParse({ card: 'B4-103', amount: 1000 }).success).toBe(false)
    expect(set.safeParse({ card: '' }).success).toBe(false)
    expect(MCP_WRITE_TOOLS.matchesRestore.input.safeParse({ id: '12' }).success).toBe(true)
    expect(MCP_WRITE_TOOLS.matchesRestore.input.safeParse({ id: 'doce' }).success).toBe(false)
    expect(MCP_WRITE_TOOLS.simulationsCancel.input.safeParse({ job: 0 }).success).toBe(false)
    const enqueue = MCP_WRITE_TOOLS.simulationsEnqueue.input
    expect(enqueue.safeParse({ kind: 'compare', decksA: ['1'], dryRun: true, confirmLong: false }).success).toBe(true)
  })

  it('D-029: the tools that queue games say g2 is the bot by default, never e2', () => {
    const schema = (tool: { input: z.ZodType }) => JSON.stringify(z.toJSONSchema(tool.input))
    for (const tool of [MCP_WRITE_TOOLS.simulationsEnqueue, MCP_WRITE_TOOLS.labTest, MCP_WRITE_TOOLS.labExplore]) {
      const text = schema(tool)
      expect(text).toContain('por defecto g2 y g2')
      expect(text).toContain('Por defecto g2 (D-029)')
      expect(text).not.toMatch(/e2 por defecto|por defecto e2/)
    }
  })

  it('D-029: the costs of the bots in the description come from the table of the estimates (e3 ~4,6 times e2, measured)', () => {
    const text = JSON.stringify(z.toJSONSchema(MCP_WRITE_TOOLS.simulationsEnqueue.input))
    expect(text).toContain('e3 tarda ~4,6 veces lo de e2, y e4 ~11')
    expect(text).toContain('m MCTS (tarda ~150 veces lo de e2)')
    expect(text).toContain('tarda ~1,3 veces lo de e con la misma profundidad')
    expect(text).toContain('tarda ~3 veces lo de e con la misma profundidad')
    expect(text).not.toContain('e3 tarda ~2 veces')
  })
})

describe('MCP prompts', () => {
  const prompts = Object.values(MCP_PROMPTS)

  it('have unique names and Spanish titles', () => {
    const names = prompts.map((prompt) => prompt.name)
    expect(new Set(names).size).toBe(names.length)
    for (const prompt of prompts) {
      expect(prompt.name).toMatch(/^[a-z_]{3,64}$/)
      expect(prompt.title.length).toBeGreaterThan(3)
      expect(prompt.description.length).toBeGreaterThan(20)
    }
  })

  it('only name tools that exist', () => {
    const known = new Set<string>(
      [...Object.values(MCP_READ_TOOLS), ...Object.values(MCP_WRITE_TOOLS)].map((tool) => tool.name),
    )
    const texts = [
      MCP_PROMPTS.weeklyReview.text({ week: '2026-10-05' }),
      MCP_PROMPTS.pickToday.text(),
      MCP_PROMPTS.deckCheckup.text({ deck: '13' }),
    ]
    for (const text of texts) {
      const mentioned = text.match(/\b[a-z]+_[a-z_]+\b/g) ?? []
      expect(mentioned.length).toBeGreaterThan(0)
      for (const name of mentioned) expect(known.has(name), name).toBe(true)
    }
    expect(texts[0]).toContain('2026-10-05')
    expect(texts[2]).toContain('«13»')
  })

  it('validate their arguments', () => {
    expect(MCP_PROMPTS.weeklyReview.args.safeParse({}).success).toBe(true)
    expect(MCP_PROMPTS.weeklyReview.args.safeParse({ week: '5/10' }).success).toBe(false)
    expect(MCP_PROMPTS.deckCheckup.args.safeParse({}).success).toBe(false)
  })
})
