/**
 * API tokens for the worker and the MCP connector (docs/PLAN.md §2): `<prefix><32 random bytes base64url>`,
 * stored as SHA-256, shown once. Scopes are fixed per kind.
 */
import { createHash, randomBytes } from 'node:crypto'

export type ApiTokenKind = 'worker' | 'mcp'

export const TOKEN_PREFIX: Record<ApiTokenKind, string> = { worker: 'tcg_wk_', mcp: 'tcg_mcp_' }

/** The bridge of the session chat (D-021): the coordinator's `chat.mjs` on the PC. Goes alone in its token. */
export const CHAT_RELAY_SCOPE = 'chat:relay'

export const SCOPES_BY_KIND: Record<ApiTokenKind, readonly string[]> = {
  worker: ['worker:claim'],
  mcp: ['mcp:read', 'mcp:write', CHAT_RELAY_SCOPE],
}

/** Characters of the token kept in clear for display, e.g. "tcg_wk_AbCdEf". */
const DISPLAY_RANDOM_CHARS = 6

export interface GeneratedToken {
  token: string
  hash: string
  prefix: string
  kind: ApiTokenKind
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function generateApiToken(kind: ApiTokenKind): GeneratedToken {
  const token = `${TOKEN_PREFIX[kind]}${randomBytes(32).toString('base64url')}`
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, TOKEN_PREFIX[kind].length + DISPLAY_RANDOM_CHARS),
    kind,
  }
}

export function tokenKindOf(token: string): ApiTokenKind | null {
  if (token.startsWith(TOKEN_PREFIX.worker)) return 'worker'
  if (token.startsWith(TOKEN_PREFIX.mcp)) return 'mcp'
  return null
}

/** `Authorization: Bearer <token>` → token, or null when absent or malformed. */
export function parseBearer(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match?.[1] ?? null
}

/** Validates requested scopes against the kind; returns the invalid ones. */
export function invalidScopes(kind: ApiTokenKind, scopes: readonly string[]): string[] {
  const allowed = new Set(SCOPES_BY_KIND[kind])
  return scopes.filter((scope) => !allowed.has(scope))
}

/**
 * The bridge's token writes as the PC's sessions in the chat: mixed with the connector's scopes, a cloud session
 * holding it could do the same.
 */
export function relayScopeMixed(scopes: readonly string[]): boolean {
  return scopes.includes(CHAT_RELAY_SCOPE) && scopes.some((scope) => scope !== CHAT_RELAY_SCOPE)
}

export function hasScopes(granted: readonly string[], required: readonly string[]): boolean {
  const set = new Set(granted)
  return required.every((scope) => set.has(scope))
}
