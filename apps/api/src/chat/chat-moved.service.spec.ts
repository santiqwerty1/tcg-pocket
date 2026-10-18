import { chatMovedFrom, hubOrigin } from './chat-moved.service.js'
import { hubAnswerFrom } from './hub-forward.service.js'

/** The move to the hub (D-030, T1b): the hub's URL as Santi types it, what is stored, and the hub's answers. */
describe('the moved rooms of the chat', () => {
  it('takes the hub as an https origin with a public name, without user, path, query or fragment', () => {
    expect(hubOrigin('https://hub.example.dev')).toBe('https://hub.example.dev')
    expect(hubOrigin(' https://hub.example.dev/ ')).toBe('https://hub.example.dev')
    // This machine over http only outside production (allowLocal), for trying it locally.
    expect(hubOrigin('http://127.0.0.1:4100', { allowLocal: true })).toBe('http://127.0.0.1:4100')
    expect(hubOrigin('http://localhost:4100', { allowLocal: true })).toBe('http://localhost:4100')
    expect(hubOrigin('http://127.0.0.1:4100')).toBeNull()
    expect(hubOrigin('https://localhost')).toBeNull()
    // 127.0.0.1 written as a number is still this machine: only with allowLocal.
    expect(hubOrigin('https://2130706433')).toBeNull()
    // No IP literal or internal name, with or without allowLocal: the token would go to whatever answers there.
    for (const bad of ['https://169.254.169.254', 'https://10.0.0.5', 'https://[fdaa::3]']) {
      expect(hubOrigin(bad, { allowLocal: true }), bad).toBeNull()
    }
    for (const bad of [
      'https://chat-hub.internal',
      'https://printer.local',
      'https://metadata',
      'https://x.localhost',
    ]) {
      expect(hubOrigin(bad, { allowLocal: true }), bad).toBeNull()
    }
    // The same names with their final dot are the same names (the Coordinator on #129).
    for (const bad of [
      'https://localhost.',
      'https://chat-hub.internal.',
      'https://printer.local.',
      'https://metadata.',
      'https://hub.example.dev.',
    ]) {
      expect(hubOrigin(bad), bad).toBeNull()
      expect(hubOrigin(bad, { allowLocal: true }), bad).toBeNull()
    }
    for (const bad of [
      'http://hub.example.dev',
      'https://hub.example.dev/api/mcp',
      // A user and a password before the host (written in two parts so it does not read as a mail address).
      ['https://user:pass', 'hub.example.dev'].join('@'),
      'https://hub.example.dev/?x=1',
      'https://hub.example.dev/#x',
      'ftp://hub.example.dev',
      'hub.example.dev',
      '',
    ]) {
      expect(hubOrigin(bad), bad).toBeNull()
    }
  })

  it('reads only the rooms tcg-pocket has, with a valid origin, from what is stored', () => {
    const since = '2026-10-18T09:00:00.000Z'
    const moved = chatMovedFrom({
      posta: { url: 'https://hub.example.dev', since },
      otra: { url: 'https://hub.example.dev', since },
      tcg: { url: 'https://hub.example.dev/api', since },
    })
    expect([...moved.values()]).toEqual([{ room: 'posta', url: 'https://hub.example.dev', since }])
    expect(chatMovedFrom(null).size).toBe(0)
    // Room by room: a bad entry is left out (and told), the others stay moved.
    const ignored: string[] = []
    const some = chatMovedFrom(
      { tcg: null, posta: { url: 'https://hub.example.dev', since }, otra: { url: 'https://hub.example.dev', since } },
      { ignored: (key) => ignored.push(key) },
    )
    expect([...some.keys()]).toEqual(['posta'])
    expect(ignored).toEqual(['tcg', 'otra'])
    // By production's rules, http to this machine is not a hub.
    expect(chatMovedFrom({ posta: { url: 'http://127.0.0.1:4100', since } }).size).toBe(0)
    expect(chatMovedFrom({ posta: { url: 'http://127.0.0.1:4100', since } }, { allowLocal: true }).size).toBe(1)
    // A date that is not one (a hand edit) keeps the room moved, without a date.
    expect(chatMovedFrom({ posta: { url: 'https://hub.example.dev', since: 'ayer' } }).get('posta')?.since).toBeNull()
    expect(chatMovedFrom([1, 2]).size).toBe(0)
  })

  it('finds the answer with its id in plain JSON or in the data lines of an event stream', () => {
    const result = { content: [{ type: 'text', text: '{"sent":true}' }], structuredContent: { sent: true } }
    expect(hubAnswerFrom(JSON.stringify({ jsonrpc: '2.0', id: 7, result }), 'application/json', 7)?.result).toEqual(
      result,
    )
    expect(hubAnswerFrom(JSON.stringify({ jsonrpc: '2.0', id: 8, result }), 'application/json', 7)).toBeNull()
    const stream = [
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: {} })}`,
      '',
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 7, result })}`,
      '',
      '',
    ].join('\n')
    expect(hubAnswerFrom(stream, 'text/event-stream; charset=utf-8', 7)?.result).toEqual(result)
    expect(hubAnswerFrom('data: {no es json', 'text/event-stream', 7)).toBeNull()
    expect(hubAnswerFrom(JSON.stringify({ jsonrpc: '2.0', id: 7, error: { message: 'x' } }), null, 7)?.error).toEqual({
      message: 'x',
    })
  })
})
