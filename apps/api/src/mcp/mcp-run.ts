/** How the MCP tool handlers run (Fase 43): reads just run; writes are also recorded in the audit log. */
import type { CallToolResult } from '@modelcontextprotocol/server'
import type { AuditNote } from './mcp-audit.service.js'

type Json = Record<string, unknown>

export type ReadRun = (name: string, work: () => Promise<Json>) => Promise<CallToolResult>

/** `args` are what the model sent (recorded); `note.undo` keeps what reverts the write, when something is lost. */
export type WriteRun = (
  name: string,
  args: unknown,
  work: (note: AuditNote) => Promise<Json>,
) => Promise<CallToolResult>
