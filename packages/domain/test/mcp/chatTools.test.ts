import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CHAT_DEFAULT_PARTICIPANTS,
  CHAT_EVERYONE,
  CHAT_OWNER,
  chatKey,
  chatParticipantName,
  MCP_CHAT_TOOLS,
  MCP_READ_TOOLS,
  MCP_WRITE_TOOLS,
  parseRecipients,
} from '../../src/mcp/index.js'

describe('chat between sessions (D-021)', () => {
  it('compares names exactly, only without case: no look-alike letter or variant passes', () => {
    expect(chatKey(' Santi ')).toBe('santi')
    expect(chatKey('SANTI')).toBe(chatKey('santi'))
    for (const variant of ['Sаnti', 'Ｓａｎｔｉ', 'Santi 2', 'Sánti', 'San-ti']) {
      expect(chatKey(variant)).not.toBe(chatKey('Santi'))
    }
    expect(chatKey('Coordınador')).not.toBe(chatKey('Coordinador'))
    expect(chatKey('Nube 2')).not.toBe(chatKey('Nube-2'))
  })

  it('takes ASCII names only: no letter of another alphabet that looks Latin', () => {
    for (const name of ['Santi', 'Nube-2', 'Nube Mejoras', 'lab_3', 'v1.2']) {
      expect(chatParticipantName.safeParse(name).success).toBe(true)
    }
    for (const name of ['Sаnti', 'Ｓａｎｔｉ', 'Coordınador', 'Ιnfra', 'Kelvin\u212A', 'Selección', '-Nube', ' ']) {
      expect(chatParticipantName.safeParse(name).success).toBe(false)
    }
    expect(CHAT_OWNER).toBe('Santi')
  })

  it('starts with the PC sessions, Santi and the two cloud sessions, each with its channel', () => {
    expect(CHAT_DEFAULT_PARTICIPANTS.map((participant) => `${participant.name}:${participant.channel}`)).toEqual([
      'Santi:owner',
      'Coordinador:relay',
      'Principal:relay',
      'Laboratorio:relay',
      'Infra:relay',
      'Nube-Mejoras:connector',
      'Nube-2:connector',
    ])
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
