import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { MCP_READ_TOOLS, MCP_SERVER_INSTRUCTIONS } from '../../src/mcp/index.js'

const tools = Object.values(MCP_READ_TOOLS)

describe('MCP read tools', () => {
  it('have unique names that Claude accepts ([a-zA-Z0-9_-], ≤ 64 characters)', () => {
    const names = tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  })

  it('cover Apéndice D read tools (dots as underscores) plus decks_closest, decks_random and the lab', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        'cards_search',
        'collection_editions',
        'collection_missions',
        'collection_playable_copies',
        'collection_summary',
        'decks_closest',
        'decks_draw_odds',
        'decks_find_by_card',
        'decks_get',
        'decks_list',
        'decks_missing',
        'decks_random',
        'decks_validate',
        'lab_meta_bank',
        'lab_results',
        'matches_list',
        'matches_luck',
        'matches_stats',
        'packs_recommend',
        'rivals_notes',
        'simulations_results',
        'tournaments_buildable',
        'tournaments_stats',
        'tournaments_trends',
        'tournaments_matchups',
        'tournaments_unlock_cards',
      ].sort(),
    )
  })

  it('have a title, a Spanish description and an object input schema convertible to JSON Schema', () => {
    for (const tool of tools) {
      expect(tool.title.length).toBeGreaterThan(3)
      expect(tool.description.length).toBeGreaterThan(30)
      const schema = z.toJSONSchema(tool.input) as { type?: string }
      expect(schema.type).toBe('object')
    }
    expect(MCP_READ_TOOLS.packsRecommend.description).toContain('puntaje')
    expect(MCP_READ_TOOLS.tournamentsStats.description).toContain('media de la era')
    expect(MCP_READ_TOOLS.tournamentsStats.input.safeParse({ era: 'B4a', by: 'list' }).success).toBe(true)
    expect(MCP_READ_TOOLS.tournamentsStats.input.safeParse({ format: 'CUSTOM' }).success).toBe(false)
    expect(MCP_READ_TOOLS.simulationsResults.description).toContain('dependen del bot')
    expect(MCP_READ_TOOLS.simulationsResults.input.safeParse({ job: 3, deck: '13' }).success).toBe(true)
    expect(MCP_READ_TOOLS.simulationsResults.input.safeParse({ job: 0 }).success).toBe(false)
    expect(MCP_READ_TOOLS.labResults.description).toContain('Juegan bots')
    expect(MCP_READ_TOOLS.labMetaBank.input.safeParse({ size: 21 }).success).toBe(false)
  })

  it('validate their inputs', () => {
    expect(MCP_READ_TOOLS.collectionPlayableCopies.input.safeParse({ query: ' Hoopa ex ' }).data).toEqual({
      query: 'Hoopa ex',
    })
    expect(MCP_READ_TOOLS.collectionPlayableCopies.input.safeParse({ query: '' }).success).toBe(false)
    expect(MCP_READ_TOOLS.cardsSearch.input.safeParse({ q: 'Copiona', limit: 26 }).success).toBe(false)
    expect(MCP_READ_TOOLS.matchesStats.input.safeParse({ mode: 'ranked' }).success).toBe(false)
    expect(MCP_READ_TOOLS.decksValidate.input.safeParse({ energies: ['dragon'] }).success).toBe(false)
  })

  it('instructions state the rules the model must keep', () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain('carta funcional')
    expect(MCP_SERVER_INSTRUCTIONS).toContain('nunca las combines')
    expect(MCP_SERVER_INSTRUCTIONS).toContain('«mazo 13»')
  })
})
