import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CHAT_EVERYONE,
  chatKey,
  isReservedChatName,
  MCP_CHAT_TOOLS,
  MCP_READ_TOOLS,
  MCP_WRITE_TOOLS,
  parseRecipients,
} from '../../src/mcp/index.js'

describe('chat between sessions (D-021)', () => {
  it('folds case, accents and separators in the names', () => {
    expect(chatKey('Nube 2')).toBe('nube2')
    expect(chatKey('nube-2')).toBe('nube2')
    expect(chatKey('NUBE·2')).toBe('nube2')
    expect(chatKey('Selección')).toBe('seleccion')
    expect(chatKey('TCG · Principal')).toBe('tcgprincipal')
  })

  it("reserves the PC sessions' names, folded", () => {
    for (const name of ['Santi', 'coordinador', 'PRINCIPAL', 'Laboratorio', 'in-fra']) {
      expect(isReservedChatName(name)).toBe(true)
    }
    for (const name of ['Nube-2', 'Nube Mejoras', 'Santiago', 'todos']) expect(isReservedChatName(name)).toBe(false)
  })

  it('parses recipients: comma lists, duplicates out, «todos» swallows the rest', () => {
    expect(parseRecipients('Principal, Laboratorio')).toEqual(['Principal', 'Laboratorio'])
    expect(parseRecipients(['Principal', 'principal', 'Infra'])).toEqual(['Principal', 'Infra'])
    expect(parseRecipients('Principal, Todos')).toEqual([CHAT_EVERYONE])
    expect(parseRecipients(' , ')).toEqual([])
  })

  it('defines two tools with object inputs, names apart from the others', () => {
    const others = new Set<string>(
      [...Object.values(MCP_READ_TOOLS), ...Object.values(MCP_WRITE_TOOLS)].map((tool) => tool.name),
    )
    for (const tool of Object.values(MCP_CHAT_TOOLS)) {
      expect(others.has(tool.name)).toBe(false)
      expect((z.toJSONSchema(tool.input) as { type?: string }).type).toBe('object')
    }
    const read = MCP_CHAT_TOOLS.chatRead.input
    expect(read.safeParse({ as: 'Nube2', waitSeconds: 40 }).success).toBe(true)
    expect(read.safeParse({ as: 'Nube2', waitSeconds: 41 }).success).toBe(false)
    expect(read.safeParse({ as: 'Nube<2>' }).success).toBe(false)
    const write = MCP_CHAT_TOOLS.chatWrite.input
    expect(write.safeParse({ from: 'Nube2', to: ['Coordinador'], topic: 'hola', text: 'listo' }).success).toBe(true)
    expect(write.safeParse({ from: 'Nube2', to: 'Coordinador', topic: '', text: 'x' }).success).toBe(false)
    // Each comma-separated recipient is checked like a name chat_read accepts.
    expect(write.safeParse({ from: 'Nube2', to: 'Principal, Laboratorio', topic: 't', text: 'x' }).success).toBe(true)
    expect(write.safeParse({ from: 'Nube2', to: 'Principal, Nube<2>', topic: 't', text: 'x' }).success).toBe(false)
    expect(write.safeParse({ from: 'Nube2', to: 'x'.repeat(41), topic: 't', text: 'x' }).success).toBe(false)
  })
})
