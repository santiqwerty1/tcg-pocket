import { ChatImportArgsError, parseChatImportArgs } from './chat-import-args.js'

/** `chat-import` (D-030, T1a): the way back of the chat's move, only with its token in IMPORT_TOKEN. */
describe('the arguments of chat-import', () => {
  const env = { IMPORT_TOKEN: 'hub_ex_secreto' }

  it('takes the URL, the rooms, where to start and --aplicar; a preview by default', () => {
    expect(parseChatImportArgs(['https://hub.example.dev/api/export'], env)).toEqual({
      url: 'https://hub.example.dev/api/export',
      token: 'hub_ex_secreto',
      rooms: [],
      after: 0,
      apply: false,
    })
    expect(
      parseChatImportArgs(
        ['https://hub.example.dev/api/export', '--salas', 'posta, tcg', '--despues', '1000020', '--aplicar'],
        env,
      ),
    ).toMatchObject({ rooms: ['posta', 'tcg'], after: 1_000_020, apply: true })
  })

  it('https only, except http to this machine', () => {
    expect(parseChatImportArgs(['http://127.0.0.1:3000/api/export'], env).url).toBe('http://127.0.0.1:3000/api/export')
    expect(() => parseChatImportArgs(['http://hub.example.dev/api/export'], env)).toThrow('https')
    expect(() => parseChatImportArgs(['ftp://hub.example.dev/x'], env)).toThrow('https')
  })

  it('without IMPORT_TOKEN, a URL, or with a flag without its value, it refuses', () => {
    expect(() => parseChatImportArgs(['https://hub.example.dev/api/export'], {})).toThrow('Falta IMPORT_TOKEN')
    expect(() => parseChatImportArgs([], env)).toThrow(ChatImportArgsError)
    expect(() => parseChatImportArgs(['no es una url'], env)).toThrow('no es una URL')
    expect(() => parseChatImportArgs(['https://h.example.dev/e', '--despues', 'x'], env)).toThrow('un número')
    expect(() => parseChatImportArgs(['https://h.example.dev/e', '--salas', ' , '], env)).toThrow('va con un valor')
    expect(() => parseChatImportArgs(['https://h.example.dev/e', '--salas'], env)).toThrow(ChatImportArgsError)
    expect(() => parseChatImportArgs(['https://h.example.dev/e', '--token', 'x'], env)).toThrow(ChatImportArgsError)
    expect(() => parseChatImportArgs(['https://h.example.dev/e', 'otra'], env)).toThrow(ChatImportArgsError)
  })
})
