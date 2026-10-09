-- Chat between the Claude sessions that work on the app's code (D-021): the cloud sessions only reach the app
-- through its MCP. Development chatter, not Santi's data: not in the backup.
CREATE TABLE "session_chat_messages" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from_name" TEXT NOT NULL,
    "from_key" TEXT NOT NULL,
    "to_names" TEXT[],
    "to_keys" TEXT[],
    "topic" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "token_id" INTEGER,

    CONSTRAINT "session_chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "session_chat_messages_at_idx" ON "session_chat_messages"("at");
CREATE INDEX "session_chat_messages_to_keys_idx" ON "session_chat_messages" USING GIN ("to_keys");

-- How far each participant has read (by its key: «Nube 2» and «nube2» are the same).
CREATE TABLE "session_chat_reads" (
    "participant" TEXT NOT NULL,
    "last_read_id" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_chat_reads_pkey" PRIMARY KEY ("participant")
);
