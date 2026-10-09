import { ChatService } from './chat.service.js'

const LIST = [
  { key: 'santi', name: 'Santi', channel: 'owner', createdAt: new Date() },
  { key: 'nube-2', name: 'Nube-2', channel: 'connector', createdAt: new Date() },
]

describe('chat between sessions (D-021)', () => {
  it('a message already sent is not turned into an error by the retention clean-up', async () => {
    const row = {
      id: 7,
      at: new Date('2026-10-09T19:00:00Z'),
      fromName: 'Nube-2',
      fromKey: 'nube-2',
      toNames: ['Santi'],
      toKeys: ['santi'],
      topic: 'Hola',
      body: 'x',
      tokenId: 1,
      via: 'nube',
      relayRef: null,
    }
    const created: unknown[] = []
    const tx = {
      $executeRaw: async () => 1,
      sessionChatMessage: {
        create: async ({ data }: { data: unknown }) => {
          created.push(data)
          return row
        },
      },
    }
    const prisma = {
      $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => work(tx),
      sessionChatParticipant: { findMany: async () => LIST },
      sessionChatMessage: {
        deleteMany: async () => {
          throw new Error('connection reset')
        },
      },
    }
    const warnings: unknown[] = []
    const logger = { setContext: () => undefined, warn: (...args: unknown[]) => warnings.push(args) }
    const chat = new ChatService(prisma as never, logger as never)
    const sent = await chat.write({
      from: 'nube-2',
      to: 'SANTI',
      topic: 'Hola',
      text: 'x',
      via: 'nube',
      tokenId: 1,
      caller: 'connector',
    })
    expect(sent.message).toMatchObject({ id: 7, from: 'Nube-2', to: ['Santi'], via: 'nube' })
    // Stored with the list's spelling of each name.
    expect(created).toEqual([expect.objectContaining({ fromName: 'Nube-2', toNames: ['Santi'], toKeys: ['santi'] })])
    expect(warnings).toHaveLength(1)
  })
})
