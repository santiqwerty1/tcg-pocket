import { ChatService } from './chat.service.js'

describe('chat between sessions (D-021)', () => {
  it('a message already sent is not turned into an error by the retention clean-up', async () => {
    const row = {
      id: 7,
      at: new Date('2026-10-09T19:00:00Z'),
      fromName: 'Nube 2',
      fromKey: 'nube2',
      toNames: ['Santi'],
      toKeys: ['santi'],
      topic: 'Hola',
      body: 'x',
      tokenId: 1,
      via: 'nube',
      relayRef: null,
    }
    const upserts: string[] = []
    const tx = {
      $executeRaw: async () => 1,
      sessionChatMessage: { create: async () => row },
      sessionChatParticipant: {
        upsert: async ({ where }: { where: { key: string } }) => {
          upserts.push(where.key)
          return {}
        },
      },
    }
    const prisma = {
      $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx),
      sessionChatParticipant: { findMany: async () => [] },
      sessionChatMessage: {
        deleteMany: async () => {
          throw new Error('connection reset')
        },
      },
    }
    const warnings: unknown[] = []
    const logger = { setContext: () => undefined, warn: (...args: unknown[]) => warnings.push(args) }
    const chat = new ChatService(prisma as never, logger as never)
    const sent = await chat.write({ from: 'Nube 2', to: 'Santi', topic: 'Hola', text: 'x', via: 'nube', tokenId: 1 })
    expect(sent.message).toMatchObject({ id: 7, from: 'Nube 2', to: ['Santi'], via: 'nube' })
    // The sender is known in the same transaction as its message.
    expect(upserts).toEqual(['nube2'])
    expect(warnings).toHaveLength(1)
  })
})
