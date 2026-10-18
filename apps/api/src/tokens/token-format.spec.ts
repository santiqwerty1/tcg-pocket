import {
  generateApiToken,
  hashApiToken,
  hasScopes,
  invalidScopes,
  parseBearer,
  SCOPES_BY_KIND,
  soloScopeMixed,
  tokenKindOf,
} from './token-format.js'

describe('api token format', () => {
  it('generates prefixed tokens with 32 random bytes and a sha256 hash', () => {
    const worker = generateApiToken('worker')
    expect(worker.token).toMatch(/^tcg_wk_[A-Za-z0-9_-]{43}$/)
    expect(worker.prefix).toBe(worker.token.slice(0, 'tcg_wk_'.length + 6))
    expect(worker.hash).toBe(hashApiToken(worker.token))
    expect(worker.hash).toMatch(/^[0-9a-f]{64}$/)
    const mcp = generateApiToken('mcp')
    expect(mcp.token).toMatch(/^tcg_mcp_[A-Za-z0-9_-]{43}$/)
    expect(mcp.token).not.toBe(worker.token)
    expect(generateApiToken('worker').token).not.toBe(worker.token)
  })

  it('recognizes the kind from the prefix', () => {
    expect(tokenKindOf('tcg_wk_abc')).toBe('worker')
    expect(tokenKindOf('tcg_mcp_abc')).toBe('mcp')
    expect(tokenKindOf('tcg_x_abc')).toBeNull()
  })

  it('parses the Authorization header', () => {
    expect(parseBearer('Bearer tcg_wk_abc')).toBe('tcg_wk_abc')
    expect(parseBearer('bearer tcg_wk_abc')).toBe('tcg_wk_abc')
    expect(parseBearer('Basic abc')).toBeNull()
    expect(parseBearer('Bearer')).toBeNull()
    expect(parseBearer('Bearer a b')).toBeNull()
    expect(parseBearer(undefined)).toBeNull()
    expect(parseBearer(['Bearer a'])).toBeNull()
  })

  it('validates scopes per kind', () => {
    expect(invalidScopes('worker', ['worker:claim'])).toEqual([])
    expect(invalidScopes('worker', ['mcp:read'])).toEqual(['mcp:read'])
    expect(invalidScopes('mcp', [...SCOPES_BY_KIND.mcp])).toEqual([])
    expect(hasScopes(['mcp:read', 'mcp:write'], ['mcp:read'])).toBe(true)
    expect(hasScopes(['mcp:read'], ['mcp:write'])).toBe(false)
    expect(hasScopes([], [])).toBe(true)
  })

  it('keeps the chat bridge and the chat export scopes alone in their token', () => {
    expect(soloScopeMixed(['chat:relay'])).toBeNull()
    expect(soloScopeMixed(['chat:export', 'chat:export'])).toBeNull()
    expect(soloScopeMixed(['mcp:read', 'mcp:write'])).toBeNull()
    expect(soloScopeMixed(['mcp:write', 'chat:relay'])).toBe('chat:relay')
    expect(soloScopeMixed(['mcp:read', 'chat:export'])).toBe('chat:export')
    expect(soloScopeMixed(['chat:relay', 'chat:export'])).not.toBeNull()
  })
})
