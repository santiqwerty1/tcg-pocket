-- Fase 43 (R-010): every write Claude makes through the MCP is recorded (token, client, tool, arguments, result and,
-- for a deleted match or a collection edit, what is needed to undo it). Operational log: not in the backup.
CREATE TABLE "mcp_audit" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token_id" INTEGER,
    "token_name" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT '',
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "ms" INTEGER NOT NULL,
    "undo" JSONB,
    "undone_at" TIMESTAMPTZ(3),

    CONSTRAINT "mcp_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mcp_audit_at_idx" ON "mcp_audit"("at");
CREATE INDEX "mcp_audit_token_id_at_idx" ON "mcp_audit"("token_id", "at");

-- Fase 43 (R-010): the clients seen with each token; a new one is an alert («¿lo usa alguien más?»).
CREATE TABLE "api_token_clients" (
    "token_id" INTEGER NOT NULL,
    "client" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_token_clients_pkey" PRIMARY KEY ("token_id", "client")
);
CREATE INDEX "api_token_clients_first_seen_at_idx" ON "api_token_clients"("first_seen_at");
