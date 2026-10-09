import { NotFoundException } from '@nestjs/common'
import { clientFromUserAgent } from '../tokens/tokens.service.js'
import { clipForAudit } from './mcp-audit.service.js'
import { McpToolsService } from './mcp-tools.service.js'

describe('Fase 43: MCP audit helpers', () => {
  it('names the client from its User-Agent, without versions', () => {
    expect(clientFromUserAgent('Claude-User/1.0')).toBe('Claude-User')
    expect(clientFromUserAgent('Mozilla/5.0 (compatible; Claude-User/1.0; +https://claude.ai)')).toBe('Claude-User')
    expect(clientFromUserAgent('python-httpx/0.28.1')).toBe('python-httpx')
    expect(clientFromUserAgent('node')).toBe('node')
    expect(clientFromUserAgent('')).toBe('desconocido')
    expect(clientFromUserAgent(undefined)).toBe('desconocido')
    expect(clientFromUserAgent('<script>/1')).toBe('script')
  })

  it('cuts long texts in the recorded arguments and keeps huge ones as a preview', () => {
    const text = 'x'.repeat(5000)
    const clipped = clipForAudit({ text, cards: [{ cardId: 'B4-103', count: 2 }], energies: ['darkness'] }) as {
      text: string
      cards: unknown[]
    }
    expect(clipped.text).toHaveLength(2000 + '… (+3000)'.length)
    expect(clipped.cards).toEqual([{ cardId: 'B4-103', count: 2 }])
    const huge = clipForAudit({ items: Array.from({ length: 2000 }, (_, at) => ({ at, name: 'carta' })) }) as {
      truncated?: boolean
      preview?: string
    }
    expect(huge.truncated).toBe(true)
    expect(huge.preview).toHaveLength(16_000)
    expect(clipForAudit(undefined)).toEqual({})
  })

  it('an unexpected error answers a reference that is also in the log; an expected one, its message', async () => {
    const logged: Record<string, unknown>[] = []
    const service = Object.create(McpToolsService.prototype) as McpToolsService
    Object.assign(service, {
      logger: { info: () => undefined, error: (entry: Record<string, unknown>) => logged.push(entry) },
    })
    const caller = { tokenId: 1, tokenName: 'claude', client: 'Claude-User', requestId: '7' }
    const run = (service as unknown as { run: McpToolsService['run'] }).run.bind(service) as (
      name: string,
      who: typeof caller,
      work: () => Promise<Record<string, unknown>>,
    ) => Promise<{ isError?: boolean; content: { text: string }[] }>
    const failed = await run('decks_get', caller, async () => {
      throw new Error('boom')
    })
    expect(failed.isError).toBe(true)
    const ref = /referencia ([0-9a-f]{8})/.exec(failed.content[0]?.text ?? '')?.[1]
    expect(ref).toBeDefined()
    expect(logged[0]).toMatchObject({ tool: 'decks_get', ref, reqId: '7', caller: 'claude (Claude-User)' })
    const expected = await run('decks_get', caller, async () => {
      throw new NotFoundException('Mazo 99 no encontrado.')
    })
    expect(expected.content[0]?.text).toBe('Mazo 99 no encontrado.')
  })
})

describe('Fase 43: edition codes as typed', () => {
  it('tries the code as typed and as the catalog writes it', async () => {
    const { codeCandidates } = await import('./mcp-write-tools.service.js')
    expect(codeCandidates('b4 103')).toContain('B4-103')
    expect(codeCandidates('a4b-1')).toContain('A4b-1')
    expect(codeCandidates('A4B-1')).toContain('A4b-1')
    expect(codeCandidates('P-A 5')).toEqual(['P-A 5'])
    expect(codeCandidates('Hoopa ex')).toEqual(['Hoopa ex'])
  })
})

describe('Fase 43: a write is recorded before it runs', () => {
  type WriteFn = (
    name: string,
    caller: { tokenId: number; tokenName: string; client: string; requestId: string },
    args: unknown,
    work: (note: { keep(undo: unknown): Promise<void> }) => Promise<Record<string, unknown>>,
  ) => Promise<{ isError?: boolean; content: { text: string }[] }>
  const caller = { tokenId: 1, tokenName: 'claude', client: 'Claude-User', requestId: '7' }

  function service(audit: Record<string, unknown>) {
    const instance = Object.create(McpToolsService.prototype) as McpToolsService
    Object.assign(instance, { audit, logger: { info: () => undefined, error: () => undefined } })
    return (instance as unknown as { runWrite: WriteFn }).runWrite.bind(instance) as WriteFn
  }

  it('does nothing when the entry cannot be opened', async () => {
    let ran = false
    const runWrite = service({
      start: async () => {
        throw new Error('db down')
      },
    })
    const result = await runWrite('matches_delete', caller, { id: '1' }, async () => {
      ran = true
      return {}
    })
    expect(ran).toBe(false)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('no hice nada')
  })

  it('keeps the undo before the write and closes the entry after it', async () => {
    const calls: string[] = []
    const runWrite = service({
      start: async () => {
        calls.push('start')
        return 42
      },
      keepUndo: async (id: number) => {
        calls.push(`keep ${id}`)
      },
      finish: async (id: number, outcome: { ok: boolean }) => {
        calls.push(`finish ${id} ${outcome.ok}`)
      },
    })
    const result = await runWrite('matches_delete', caller, { id: '1' }, async (note) => {
      await note.keep({ kind: 'match_delete' })
      calls.push('delete')
      return { deleted: true }
    })
    expect(result.isError).toBeUndefined()
    expect(calls).toEqual(['start', 'keep 42', 'delete', 'finish 42 true'])
  })
})
